const crypto = require('crypto');
const SmsGateway = require('../models/SmsGateway');
const Device = require('../models/Device');
const OutboundSms = require('../models/OutboundSms');
const smsService = require('./smsService');
const smsConfig = require('../config/smsConfig');
const logger = require('../utils/logger');

const generateSecret = () => crypto.randomBytes(32).toString('hex');
const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

const compareVersions = (v1, v2) => {
  const parts1 = String(v1).trim().split('.').map(Number);
  const parts2 = String(v2).trim().split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((parts1[i] || 0) > (parts2[i] || 0)) return 1;
    if ((parts1[i] || 0) < (parts2[i] || 0)) return -1;
  }
  return 0;
};

// ─── Gateway lifecycle ─────────────────────────────────────
const ensureGatewayForDevice = async (device, audit = {}) => {
  let gateway = await SmsGateway.findOne({ deviceId: device._id });
  if (gateway) {
    gateway.deviceName = device.deviceName || gateway.deviceName;
    gateway.gatewayId = device.uuid;
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
    gateway.updatedAt = new Date();
    await gateway.save();
    logger.info('SmsGateway revoked', { deviceId, gatewayId: gateway.gatewayId });
  }
  return gateway;
};

// ─── Token rotation (two‑phase) ────────────────────────────
const rotateToken = async (gatewayId, audit = {}) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');
  if (gateway.status === 'revoked') throw new Error('Gateway is revoked');

  const newSecret = generateSecret();
  const hashed = hashSecret(newSecret);
  gateway.stagedSecretToken = hashed;
  gateway.stagedPlainSecret = newSecret;
  gateway.stagedSecretIssuedAt = new Date();
  gateway.stagedSecretVersion = (gateway.secretVersion || 0) + 1;
  gateway.lastRotatedBy = audit.userId;
  gateway.lastRotatedIp = audit.ip;
  gateway.lastRotatedAt = new Date();
  gateway.updatedAt = new Date();
  await gateway.save();

  return { secretToken: newSecret, version: gateway.stagedSecretVersion };
};

const confirmRotation = async (gatewayId) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');
  if (!gateway.stagedSecretToken) throw new Error('No staged token to confirm');

  gateway.secretToken = gateway.stagedSecretToken;
  gateway.plainSecret = gateway.stagedPlainSecret;
  gateway.secretIssuedAt = gateway.stagedSecretIssuedAt;
  gateway.secretVersion = gateway.stagedSecretVersion;
  gateway.stagedSecretToken = null;
  gateway.stagedPlainSecret = null;
  gateway.stagedSecretIssuedAt = null;
  gateway.stagedSecretVersion = null;
  gateway.updatedAt = new Date();
  await gateway.save();
  return gateway;
};

// ─── Provisioning ──────────────────────────────────────────
const getProvisionData = async (deviceId, cooperativeId) => {
  const device = await Device.findOne({ uuid: deviceId, cooperativeId });
  if (!device) {
    return { approved: false, revoked: false, secret: null, gatewayId: null };
  }

  let gateway = await SmsGateway.findOne({ deviceId: device._id });
  if (!gateway) {
    return { approved: device.approved, revoked: device.revoked, secret: null, gatewayId: null };
  }

  if (gateway.status === 'pending' && !gateway.plainSecret) {
    const secret = generateSecret();
    const hashed = hashSecret(secret);
    gateway.secretToken = hashed;
    gateway.plainSecret = secret;
    gateway.secretIssuedAt = new Date();
    gateway.secretRetrievedAt = null;
    await gateway.save();
  }

  if (!gateway.plainSecret || gateway.secretRetrievedAt) {
    return {
      approved: device.approved,
      revoked: device.revoked,
      secret: null,
      gatewayId: gateway.gatewayId,
    };
  }

  const secret = gateway.plainSecret;

  const updated = await SmsGateway.findOneAndUpdate(
    {
      _id: gateway._id,
      plainSecret: secret,
      secretRetrievedAt: null,
    },
    {
      $set: {
        plainSecret: null,
        secretRetrievedAt: new Date(),
        status: 'online',
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!updated) {
    return {
      approved: device.approved,
      revoked: device.revoked,
      secret: null,
      gatewayId: gateway.gatewayId,
    };
  }

  return {
    approved: true,
    revoked: false,
    secret,
    gatewayId: gateway.gatewayId,
  };
};

// ─── Token verification ────────────────────────────────────
const verifyGatewayToken = async (gatewayId, token) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) return false;
  if (!gateway.secretToken) return false;
  const hashedInput = hashSecret(token);
  try {
    return crypto.timingSafeEqual(Buffer.from(gateway.secretToken), Buffer.from(hashedInput));
  } catch {
    return false;
  }
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

  let status = 'online';
  const minVersion = smsConfig.minGatewayVersion || '1.0.0';
  if (appVersion && compareVersions(appVersion, minVersion) < 0) {
    status = 'needs_update';
  } else if (tunnelConnected === false) {
    status = 'degraded';
  }

  const gateway = await SmsGateway.findOne({ gatewayId }).populate('deviceId');
  if (!gateway) throw new Error('Gateway not found');

  if (gateway.deviceId && !gateway.cooperativeId.equals(gateway.deviceId.cooperativeId)) {
    logger.error('Cooperative mismatch', { gatewayId, gatewayCoop: gateway.cooperativeId, deviceCoop: gateway.deviceId.cooperativeId });
    throw new Error('Cooperative mismatch');
  }

  gateway.status = status;
  gateway.appVersion = appVersion || gateway.appVersion;
  gateway.lastHeartbeat = new Date();
  gateway.batteryLevel = batteryLevel ?? gateway.batteryLevel;
  gateway.networkType = networkType || gateway.networkType;
  gateway.signalStrength = signalStrength ?? gateway.signalStrength;
  gateway.isCharging = isCharging ?? gateway.isCharging;
  gateway.simOperator = simOperator || gateway.simOperator;
  gateway.simSerial = simSerial || gateway.simSerial;
  gateway.androidVersion = androidVersion || gateway.androidVersion;
  gateway.publicIp = publicIp || gateway.publicIp;
  gateway.tunnelConnected = tunnelConnected ?? gateway.tunnelConnected;
  gateway.lastSmsSentAt = lastSmsSentAt || gateway.lastSmsSentAt;
  gateway.lastSmsFailedAt = lastSmsFailedAt || gateway.lastSmsFailedAt;
  gateway.queueLength = queueLength ?? gateway.queueLength;
  gateway.storageFree = storageFree ?? gateway.storageFree;
  gateway.ramUsage = ramUsage ?? gateway.ramUsage;
  gateway.batteryTemperature = batteryTemperature ?? gateway.batteryTemperature;
  gateway.appState = appState || gateway.appState;
  gateway.cloudflareTunnelVersion = cloudflareTunnelVersion || gateway.cloudflareTunnelVersion;
  gateway.lastTunnelReconnect = lastTunnelReconnect || gateway.lastTunnelReconnect;
  gateway.tunnelLatency = tunnelLatency ?? gateway.tunnelLatency;
  gateway.updatedAt = new Date();
  await gateway.save();

  if (gateway.deviceId) {
    await Device.findByIdAndUpdate(gateway.deviceId._id, { last_seen: new Date() });
  }

  return gateway;
};

// ─── Atomic job claiming ───────────────────────────────────
const tryClaimPoll = async (gatewayId) => {
  const pollInterval = smsConfig.gatewayPollIntervalSeconds || 3;
  const cutoff = new Date(Date.now() - pollInterval * 1000);
  const result = await SmsGateway.findOneAndUpdate(
    {
      gatewayId,
      $or: [{ lastPoll: { $exists: false } }, { lastPoll: { $lte: cutoff } }],
    },
    { $set: { lastPoll: new Date(), updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  return result !== null;
};

// ─── Job operations (pass‑through to smsService) ──────────
const claimJobs = async (gatewayId, limit = 10) => {
  return smsService.claimJobs(gatewayId, limit);
};

const markJobSent = async (jobId, gatewayId, providerResponse) => {
  return smsService.markSent(jobId, gatewayId, providerResponse);
};

const markJobFailed = async (jobId, gatewayId, error, providerResponse) => {
  return smsService.markFailed(jobId, gatewayId, error, providerResponse);
};

const retryFailedJob = async (jobId) => {
  return smsService.retryFailedJob(jobId);
};

// ─── Status & admin ────────────────────────────────────────
const getGatewayStatus = async (gatewayId) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');
  return gateway;
};

const markOffline = async (gatewayId) => {
  await SmsGateway.findOneAndUpdate(
    { gatewayId },
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
  claimJobs,
  markJobSent,
  markJobFailed,
  retryFailedJob,
  getGatewayStatus,
  markOffline,
  markOfflineIfStale,
};