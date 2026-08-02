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
setInterval(() => {
  const now = Date.now();
  for (const [key, value] of tokenCache) {
    if (value.expires <= now) tokenCache.delete(key);
  }
}, 60000);

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
    // NOTE: re-approval after revocation intentionally does NOT touch
    // provisionState/plainSecret here — revokeGatewayForDevice already
    // cleared plainSecret and set provisionState:'revoked', so
    // prepareProvision's generate-secret block (guarded on `!plainSecret`)
    // will correctly issue a fresh secret on the device's next poll.
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
    // FIX: this used to be 'pending'. A plainSecret is generated and stored
    // right here, in this same object — so the true state at this point is
    // "secret has been issued", not "nothing has happened yet". Leaving it
    // as 'pending' was a deadlock: prepareProvision only regenerates a
    // secret when `!gateway.plainSecret` (never true here, since it's set
    // above), and only *returns* a secret when provisionState is exactly
    // 'secret_issued' — which this record would never reach on its own.
    // A freshly-approved device would poll /gateway/provision forever and
    // always get `secret: null` back, despite a valid secret sitting
    // unused in this very document. Setting the initial state to
    // 'secret_issued' here (matching the fact that a secret genuinely was
    // just issued) is what makes prepareProvision's first poll actually
    // hand it over.
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
  // Read current version first so the staged version increments correctly,
  // then commit the stage atomically conditioned on the gateway not having
  // been rotated/revoked out from under us in between.
  const existing = await SmsGateway.findOne({ gatewayId });
  if (!existing) throw new Error('Gateway not found');
  if (existing.status === 'revoked') throw new Error('Gateway is revoked');

  const stagedVersion = (existing.secretVersion || 0) + 1;
  const gateway = await SmsGateway.findOneAndUpdate(
    {
      gatewayId,
      status: { $ne: 'revoked' },
      secretVersion: existing.secretVersion, // optimistic concurrency guard
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

  // Optional: if the caller tells us which version it actually received
  // from rotateToken(), reject confirming a *different* (e.g. newer, from
  // another rotation that happened in between) staged token. Backward
  // compatible — omitting expectedVersion skips this check entirely, same
  // behavior as before this existed.
  if (expectedVersion !== undefined && gateway.stagedSecretVersion !== expectedVersion) {
    throw new Error(
      `Staged secret version mismatch: expected ${expectedVersion}, found ${gateway.stagedSecretVersion}`
    );
  }

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
  invalidateTokenCache(gatewayId);
  return gateway;
};

// ─── Provisioning (Two-Phase with State Machine) ──────────
//
// provisionState ∈ { pending, secret_issued, confirmed, revoked }
// status         ∈ { pending, online, offline, degraded, needs_update, revoked }
//
// provisionState answers "has this device completed the provisioning
// handshake?" — it is set exactly once by confirmProvision and never
// touched again except by revocation. status answers "is it currently
// reachable?" — only processHeartbeat/markOfflineIfStale/markOffline touch
// it. Previously processHeartbeat also flipped provisionState to 'online'
// on first successful heartbeat, which conflated the two questions (a
// device could be "provisionState: online" yet the schema had no way to
// distinguish that from a device that's merely reachable right now) and
// meant a device that provisioned once but has been offline for a week
// still reported provisionState:'online' — this is now handled entirely
// by `status`, which markOfflineIfStale already flips back to 'offline'.

// Phase 1: Prepare – return secret or state
const prepareProvision = async (deviceId, cooperativeId) => {
  const device = await Device.findOne({ uuid: deviceId, cooperativeId });
  if (!device) {
    return { approved: false, revoked: false, provisioned: false, secret: null, gatewayId: null };
  }

  let gateway = await SmsGateway.findOne({ deviceId: device._id });
  if (!gateway) {
    return { approved: device.approved, revoked: device.revoked, provisioned: false, secret: null, gatewayId: null };
  }

  // Same check processHeartbeat already enforces — prepareProvision was
  // assuming gateway.cooperativeId and device.cooperativeId never drift
  // apart, which holds under normal operation but not against a manual
  // Mongo edit, a restored backup, a data migration, or a bug elsewhere.
  // Fail closed rather than handing back provisioning data scoped to the
  // wrong cooperative.
  if (!gateway.cooperativeId.equals(cooperativeId)) {
    logger.error('Cooperative mismatch during provisioning', {
      deviceId,
      gatewayCoop: gateway.cooperativeId,
      requestCoop: cooperativeId,
    });
    throw new Error('Cooperative mismatch between gateway and device');
  }

  // Already confirmed -> provisioned. (No longer also checks 'online' —
  // that was never a valid provisionState value going forward; status
  // carries reachability instead.)
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

  // Two cases land here: the current secret expired, or none was ever
  // issued (not confirmed either way). Both are handled by the same atomic
  // regenerate-in-place — merged into one round trip rather than returning
  // an intermediate `expired` response and making the client poll again
  // for the actual new secret.
  const now = Date.now();
  const isExpired =
    !!gateway.secretIssuedAt &&
    now - gateway.secretIssuedAt.getTime() > SECRET_TTL &&
    gateway.provisionState !== 'confirmed';
  const needsFreshSecret = !gateway.plainSecret && gateway.provisionState !== 'confirmed';

  if (isExpired || needsFreshSecret) {
    const secret = generateSecret();
    const hashed = hashSecret(secret);
    // Guard: match on the exact secretIssuedAt we read (works whether it's
    // a real timestamp being replaced or null in the needsFreshSecret-only
    // case) plus provisionState, so two concurrent callers can't both win
    // this write — only one findOneAndUpdate matches and regenerates.
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
    // If `updated` is null, a concurrent request won the race and already
    // regenerated — re-fetch so we return *that* secret below instead of
    // stale in-memory data.
    gateway = updated || (await SmsGateway.findOne({ _id: gateway._id }));
  }

  // Return fresh secret if available and not retrieved
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

  // Secret already retrieved but not confirmed – state: awaiting_confirmation
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

  // Fallback: not ready
  return {
    approved: device.approved,
    revoked: device.revoked,
    provisioned: false,
    secret: null,
    gatewayId: gateway.gatewayId,
  };
};

// Phase 2: Confirm – client has stored the secret
const confirmProvision = async (deviceId, cooperativeId) => {
  const device = await Device.findOne({ uuid: deviceId, cooperativeId });
  if (!device) throw new Error('Device not found');

  const gateway = await SmsGateway.findOne({ deviceId: device._id });
  if (!gateway) throw new Error('Gateway not found');

  if (!gateway.cooperativeId.equals(cooperativeId)) {
    logger.error('Cooperative mismatch during confirm', {
      deviceId,
      gatewayCoop: gateway.cooperativeId,
      requestCoop: cooperativeId,
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
        // FIX: was 'online'. Confirmation only means the handshake is
        // complete — the device hasn't sent a single heartbeat yet at
        // this point, so calling it 'online' is misleading. It starts
        // 'offline' and processHeartbeat flips it to 'online' on the
        // device's first real heartbeat, same as any other reachability
        // change from here on.
        status: 'offline',
        updatedAt: new Date(),
      },
    },
    { returnDocument: 'after' }
  );

  if (!updated) throw new Error('Provision confirmation failed – secret already consumed');
  logger.info('Gateway provision confirmed', { deviceId, gatewayId: gateway.gatewayId });
  return { success: true, provisioned: true };
};

// ─── Legacy compatibility ──────────────────────────────────
const getProvisionData = async (deviceId, cooperativeId) => {
  return prepareProvision(deviceId, cooperativeId);
};

// ─── Token verification (with cache) ──────────────────────
const verifyGatewayToken = async (gatewayId, token) => {
  // Reject obviously-garbage input before it ever touches the cache or a
  // hashing call — a valid secret is always a 64-char hex string.
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

  tokenCache.set(cacheKey, { valid, expires: Date.now() + CACHE_TTL });
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

  // provisionState is intentionally never touched here — see the comment
  // block above prepareProvision for why. Only `status` reflects
  // reachability; the old second .save() that flipped provisionState to
  // 'online' has been removed entirely (also resolves the "two writes per
  // heartbeat" issue — this is the only save() in this function now).

  // Best-effort only: the gateway's own state already committed above.
  // Not wrapped in a transaction — that requires a replica-set MongoDB
  // deployment, which isn't guaranteed here, and would turn a "nice to
  // have" consistency improvement into a hard requirement. If this throws,
  // the heartbeat has still done its real job; log and move on rather than
  // surfacing a 400 to a device whose heartbeat actually succeeded.
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

  return gateway;
};

// ─── Atomic job claiming ───────────────────────────────────
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

// NOTE (unresolved, needs the scheduler file to confirm): this function is
// correct on its own — it flips status (not provisionState, consistent
// with the separation above) to 'offline' once lastHeartbeat is stale.
// Whatever cron/interval is supposed to call this periodically (with a
// cutoff — the review suggested ~15 minutes) isn't part of this file. If
// nothing currently calls markOfflineIfStale on a schedule, a gateway that
// goes dark will show its last real status forever instead of 'offline'.
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
}