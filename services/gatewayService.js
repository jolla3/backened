const crypto = require('crypto');
const semver = require('semver');
const SmsGateway = require('../models/SmsGateway');
const Device = require('../models/device');
const OutboundSms = require('../models/OutboundSms');
const smsService = require('./smsService');
const smsConfig = require('../config/smsConfig');
const logger = require('../utils/logger');

const generateSecret = () => crypto.randomBytes(32).toString('hex');
const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');
const SECRET_TTL = 15 * 60 * 1000; // 15 minutes

// ─── Token cache ────────────────────────────────────────────
const tokenCache = new Map();
const CACHE_TTL = 5 * 60 * 1000;

const invalidateTokenCache = (gatewayId) => {
  for (const [key] of tokenCache) {
    if (key.startsWith(`${gatewayId}:`)) tokenCache.delete(key);
  }
};

// Read-time eviction (in verifyGatewayToken) only cleans an entry when
// that exact key is looked up again. A flood of distinct invalid tokens —
// each a different cache key — would never be looked up a second time, so
// the map would just grow. This sweeps everything expired on a fixed
// schedule regardless of read pattern.
const cacheCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenCache) {
    if (value.expires <= now) tokenCache.delete(key);
  }
}, 60000);
// Doesn't keep the process alive on its own — otherwise any test, script,
// migration, or CLI tool that merely imports this module would hang on exit.
cacheCleanupTimer.unref();

// ─── Gateway lifecycle ─────────────────────────────────────
const ensureGatewayForDevice = async (device, audit = {}) => {
  let gateway = await SmsGateway.findOne({ deviceId: device._id });
  if (gateway) {
    if (!gateway.gatewayId) {
      gateway.gatewayId = device.uuid;
    }
    gateway.deviceName = device.deviceName || gateway.deviceName;
    gateway.cooperativeId = device.cooperativeId;
    gateway.deviceModel = device.deviceModel || gateway.deviceModel;
    gateway.manufacturer = device.manufacturer || gateway.manufacturer;
    gateway.androidVersion = device.androidVersion || gateway.androidVersion;
    if (gateway.status === 'revoked') {
      gateway.status = 'pending';
    }
    gateway.updatedAt = new Date();
    await gateway.save();
    return { gateway, secretToken: null };
  }

  const secretToken = generateSecret();
  const hashedToken = hashSecret(secretToken);
  gateway = new SmsGateway({
    deviceId: device._id,
    gatewayId: device.uuid,
    secretToken: hashedToken,
    plainSecret: secretToken,
    secretIssuedAt: new Date(),
    secretVersion: 1,
    secretRetrievedAt: null,
    provisionState: 'secret_issued',
    cooperativeId: device.cooperativeId,
    deviceName: device.deviceName || null,
    deviceModel: device.deviceModel || null,
    manufacturer: device.manufacturer || null,
    androidVersion: device.androidVersion || null,
    status: 'pending',
    registeredBy: audit.userId,
    registrationIp: audit.ip,
    registeredAt: new Date(),
    updatedAt: new Date(),
  });
  await gateway.save();
  logger.info('SmsGateway auto‑created', { deviceId: device._id, gatewayId: device.uuid });
  return { gateway, secretToken };
};

const revokeGatewayForDevice = async (deviceId) => {
  const gateway = await SmsGateway.findOne({ deviceId });
  if (gateway) {
    await OutboundSms.updateMany(
      { gatewayId: gateway._id, status: 'processing' },
      { status: 'queued', gatewayId: null, updatedAt: new Date() }
    );
    gateway.status = 'revoked';
    gateway.secretToken = null;
    gateway.plainSecret = null;
    gateway.provisionState = 'revoked';
    gateway.updatedAt = new Date();
    await gateway.save();
    invalidateTokenCache(gateway.gatewayId);
    logger.info('SmsGateway revoked', { deviceId, gatewayId: gateway.gatewayId });
  }
  return gateway;
};

// ─── Token rotation (two‑phase, now atomic) ────────────────
const rotateToken = async (gatewayId, audit = {}) => {
  const newSecret = generateSecret();
  const hashed = hashSecret(newSecret);
  const existing = await SmsGateway.findOne({ gatewayId });
  if (!existing) throw new Error('Gateway not found');
  if (existing.status === 'revoked') throw new Error('Gateway is revoked');

  const stagedVersion = (existing.secretVersion || 0) + 1;
  const gateway = await SmsGateway.findOneAndUpdate(
    {
      gatewayId,
      status: { $ne: 'revoked' },
      secretVersion: existing.secretVersion,
    },
    {
      $set: {
        stagedSecretToken: hashed,
        stagedPlainSecret: newSecret,
        stagedSecretIssuedAt: new Date(),
        stagedSecretVersion: stagedVersion,
        lastRotatedBy: audit.userId,
        lastRotatedIp: audit.ip,
        lastRotatedAt: new Date(),
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );
  if (!gateway) {
    throw new Error('Token rotation failed — gateway was modified concurrently, please retry');
  }
  invalidateTokenCache(gatewayId);
  return { secretToken: newSecret, version: gateway.stagedSecretVersion };
};

const confirmRotation = async (gatewayId, expectedVersion) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');
  if (!gateway.stagedSecretToken) throw new Error('No staged token to confirm');

  if (expectedVersion !== undefined && gateway.stagedSecretVersion !== expectedVersion) {
    throw new Error(
      `Staged secret version mismatch: expected ${expectedVersion}, found ${gateway.stagedSecretVersion}`
    );
  }

  const updated = await SmsGateway.findOneAndUpdate(
    {
      gatewayId,
      stagedSecretToken: gateway.stagedSecretToken,
      stagedSecretVersion: gateway.stagedSecretVersion,
    },
    {
      $set: {
        secretToken: gateway.stagedSecretToken,
        plainSecret: gateway.stagedPlainSecret,
        secretIssuedAt: gateway.stagedSecretIssuedAt,
        secretVersion: gateway.stagedSecretVersion,
        updatedAt: new Date(),
      },
      $unset: {
        stagedSecretToken: '',
        stagedPlainSecret: '',
        stagedSecretIssuedAt: '',
        stagedSecretVersion: '',
      },
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    throw new Error('Confirm rotation failed — a newer rotation occurred concurrently, please retry');
  }

  invalidateTokenCache(gatewayId);
  return updated;
};

// ─── Provisioning (Two-Phase) ──────────────────────────────
const prepareProvision = async (deviceId, cooperativeId) => {
  const device = await Device.findOne({ uuid: deviceId, cooperativeId });
  if (!device) {
    return { approved: false, revoked: false, provisioned: false, secret: null, gatewayId: null };
  }

  let gateway = await SmsGateway.findOne({ deviceId: device._id });
  if (!gateway) {
    return { approved: device.approved, revoked: device.revoked, provisioned: false, secret: null, gatewayId: null };
  }

  if (String(gateway.cooperativeId) !== String(cooperativeId)) {
    logger.error('Cooperative mismatch during provisioning', {
      deviceId,
      gatewayCoop: gateway.cooperativeId,
      requestCoop: cooperativeId,
    });
    throw new Error('Cooperative mismatch between gateway and device');
  }

  if (gateway.provisionState === 'confirmed') {
    return {
      approved: device.approved,
      revoked: device.revoked,
      provisioned: true,
      secret: null,
      gatewayId: gateway.gatewayId,
      version: gateway.secretVersion || 1,
    };
  }

  const now = Date.now();
  const isExpired =
    !!gateway.secretIssuedAt &&
    now - gateway.secretIssuedAt.getTime() > SECRET_TTL &&
    gateway.provisionState !== 'confirmed';
  const needsFreshSecret = !gateway.plainSecret && gateway.provisionState !== 'confirmed';

  if (isExpired || needsFreshSecret) {
    const secret = generateSecret();
    const hashed = hashSecret(secret);
    const updated = await SmsGateway.findOneAndUpdate(
      {
        _id: gateway._id,
        secretIssuedAt: gateway.secretIssuedAt,
        provisionState: { $ne: 'confirmed' },
      },
      {
        $set: {
          secretToken: hashed,
          plainSecret: secret,
          secretIssuedAt: new Date(),
          secretRetrievedAt: null,
          provisionState: 'secret_issued',
          updatedAt: new Date(),
        },
      },
      { returnDocument: 'after' }
    );
    gateway = updated || (await SmsGateway.findOne({ _id: gateway._id }));
  }

  if (gateway.plainSecret && !gateway.secretRetrievedAt && gateway.provisionState === 'secret_issued') {
    return {
      approved: device.approved,
      revoked: device.revoked,
      provisioned: false,
      secret: gateway.plainSecret,
      gatewayId: gateway.gatewayId,
      version: gateway.secretVersion || 1,
    };
  }

  if (gateway.secretRetrievedAt && gateway.provisionState === 'secret_issued') {
    return {
      approved: device.approved,
      revoked: device.revoked,
      provisioned: false,
      secret: null,
      gatewayId: gateway.gatewayId,
      version: gateway.secretVersion || 1,
      state: 'awaiting_confirmation',
    };
  }

  return {
    approved: device.approved,
    revoked: device.revoked,
    provisioned: false,
    secret: null,
    gatewayId: gateway.gatewayId,
  };
};

// Phase 2: Confirm – client has stored the secret
const confirmProvision = async (gateway) => {
  // gateway must be the Mongoose document, with deviceId populated
  if (!gateway) throw new Error('Gateway not provided');
  const device = gateway.deviceId;
  if (!device) throw new Error('Device not found in gateway');

  // Cooperative mismatch check
  if (String(gateway.cooperativeId) !== String(device.cooperativeId)) {
    logger.error('Cooperative mismatch during confirm', {
      gatewayId: gateway.gatewayId,
      gatewayCoop: gateway.cooperativeId,
      deviceCoop: device.cooperativeId,
    });
    throw new Error('Cooperative mismatch between gateway and device');
  }

  // Idempotent: already confirmed
  if (gateway.provisionState === 'confirmed') {
    return { success: true, provisioned: true };
  }

  if (gateway.provisionState !== 'secret_issued') {
    throw new Error('No secret issued to confirm');
  }
  if (!gateway.plainSecret) {
    throw new Error('Secret already consumed');
  }

  // Atomic update using the gateway's own _id and conditions
  const updated = await SmsGateway.findOneAndUpdate(
    {
      _id: gateway._id,
      plainSecret: gateway.plainSecret,
      secretRetrievedAt: null,
      provisionState: 'secret_issued',
    },
    {
      $set: {
        plainSecret: null,
        secretRetrievedAt: new Date(),
        provisionState: 'confirmed',
        status: 'offline',
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!updated) throw new Error('Provision confirmation failed – secret already consumed');

  // Invalidate token cache (stale entries for this gateway)
  invalidateTokenCache(gateway.gatewayId);

  logger.info('Gateway provision confirmed', { deviceId: device.uuid, gatewayId: gateway.gatewayId });
  return { success: true, provisioned: true };
};
// ─── Legacy compatibility ──────────────────────────────────
const getProvisionData = async (deviceId, cooperativeId) => {
  return prepareProvision(deviceId, cooperativeId);
};

// ─── Token verification (with cache) ──────────────────────
const verifyGatewayToken = async (gatewayId, token) => {
  if (typeof token !== 'string' || token.length !== 64) {
    return false;
  }

  const cacheKey = `${gatewayId}:${token}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) {
    if (cached.expires > Date.now()) {
      return cached.valid;
    }
    tokenCache.delete(cacheKey);
  }

  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) return false;
  if (!gateway.secretToken) return false;
  if (gateway.status === 'revoked') return false;

  const hashedInput = hashSecret(token);
  let valid = false;
  try {
    valid = crypto.timingSafeEqual(Buffer.from(gateway.secretToken), Buffer.from(hashedInput));
  } catch {
    valid = false;
  }

  if (valid) {
    tokenCache.set(cacheKey, { valid: true, expires: Date.now() + CACHE_TTL });
  }
  return valid;
};

// ─── Heartbeat & polling ───────────────────────────────────
const processHeartbeat = async (gatewayId, data = {}) => {
  const {
    appVersion,
    batteryLevel,
    networkType,
    signalStrength,
    isCharging,
    simOperator,
    simSerial,
    androidVersion,
    publicIp,
    tunnelConnected,
    lastSmsSentAt,
    lastSmsFailedAt,
    queueLength,
    storageFree,
    ramUsage,
    batteryTemperature,
    appState,
    cloudflareTunnelVersion,
    lastTunnelReconnect,
    tunnelLatency,
  } = data;

  const gateway = await SmsGateway.findOne({ gatewayId }).populate('deviceId');
  if (!gateway) throw new Error('Gateway not found');

  if (gateway.status === 'revoked') {
    gateway.lastHeartbeat = new Date();
    gateway.updatedAt = new Date();
    await gateway.save();
    return gateway;
  }

  let status = 'online';
  const minVersion = smsConfig.minGatewayVersion || '1.0.0';
  if (appVersion && semver.lt(appVersion, minVersion)) {
    status = 'needs_update';
  } else if (tunnelConnected === false) {
    status = 'degraded';
  }

  if (gateway.deviceId && String(gateway.cooperativeId) !== String(gateway.deviceId.cooperativeId)) {
    logger.error('Cooperative mismatch', { gatewayId, gatewayCoop: gateway.cooperativeId, deviceCoop: gateway.deviceId.cooperativeId });
    throw new Error('Cooperative mismatch');
  }

  const set = { status, lastHeartbeat: new Date(), updatedAt: new Date() };
  if (appVersion) set.appVersion = appVersion;
  if (batteryLevel != null) set.batteryLevel = batteryLevel;
  if (networkType) set.networkType = networkType;
  if (signalStrength != null) set.signalStrength = signalStrength;
  if (isCharging != null) set.isCharging = isCharging;
  if (simOperator) set.simOperator = simOperator;
  if (simSerial) set.simSerial = simSerial;
  if (androidVersion) set.androidVersion = androidVersion;
  if (publicIp) set.publicIp = publicIp;
  if (tunnelConnected != null) set.tunnelConnected = tunnelConnected;
  if (lastSmsSentAt) set.lastSmsSentAt = lastSmsSentAt;
  if (lastSmsFailedAt) set.lastSmsFailedAt = lastSmsFailedAt;
  if (queueLength != null) set.queueLength = queueLength;
  if (storageFree != null) set.storageFree = storageFree;
  if (ramUsage != null) set.ramUsage = ramUsage;
  if (batteryTemperature != null) set.batteryTemperature = batteryTemperature;
  if (appState) set.appState = appState;
  if (cloudflareTunnelVersion) set.cloudflareTunnelVersion = cloudflareTunnelVersion;
  if (lastTunnelReconnect) set.lastTunnelReconnect = lastTunnelReconnect;
  if (tunnelLatency != null) set.tunnelLatency = tunnelLatency;

  const updatedGateway = await SmsGateway.findOneAndUpdate(
    { _id: gateway._id },
    { $set: set },
    { returnDocument: 'after' }
  );

  if (gateway.deviceId) {
    try {
      await Device.findByIdAndUpdate(gateway.deviceId._id, { last_seen: new Date() });
    } catch (err) {
      logger.warn('Failed to update Device.last_seen after heartbeat', {
        gatewayId,
        deviceId: gateway.deviceId._id,
        error: err.message,
      });
    }
  }

  return updatedGateway;
};

const tryClaimPoll = async (gatewayId) => {
  const pollInterval = smsConfig.gatewayPollIntervalSeconds || 3;
  const cutoff = new Date(Date.now() - pollInterval * 1000);
  const result = await SmsGateway.findOneAndUpdate(
    {
      gatewayId,
      status: { $ne: 'revoked' },
      $or: [{ lastPoll: { $exists: false } }, { lastPoll: { $lte: cutoff } }],
    },
    { $set: { lastPoll: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return result !== null;
};

// ─── Job operations ────────────────────────────────────────
const claimJobs = async (gatewayId, limit = 10) => smsService.claimJobs(gatewayId, limit);
const markJobSent = async (jobId, gatewayId, providerResponse) => smsService.markSent(jobId, gatewayId, providerResponse);
const markJobFailed = async (jobId, gatewayId, error, providerResponse) => smsService.markFailed(jobId, gatewayId, error, providerResponse);
const retryFailedJob = async (jobId) => smsService.retryFailedJob(jobId);

// ─── Status & admin ────────────────────────────────────────
const getGatewayStatus = async (gatewayId) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');
  return gateway;
};

const markOffline = async (gatewayId) => {
  await SmsGateway.findOneAndUpdate(
    { gatewayId, status: { $ne: 'revoked' } },
    { status: 'offline', updatedAt: new Date() }
  );
};

const markOfflineIfStale = async (cutoff) => {
  const result = await SmsGateway.updateMany(
    {
      status: { $in: ['online', 'degraded', 'needs_update'] },
      lastHeartbeat: { $lte: cutoff },
    },
    { $set: { status: 'offline', updatedAt: new Date() } }
  );
  return result;
};

module.exports = {
  ensureGatewayForDevice,
  revokeGatewayForDevice,
  rotateToken,
  confirmRotation,
  verifyGatewayToken,
  processHeartbeat,
  tryClaimPoll,
  getProvisionData,
  prepareProvision,
  confirmProvision,
  claimJobs,
  markJobSent,
  markJobFailed,
  retryFailedJob,
  getGatewayStatus,
  markOffline,
  markOfflineIfStale,
};