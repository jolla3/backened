// service/gatewaySyncService

const crypto = require('crypto');
const SmsGateway = require('../models/SmsGateway');
const logger = require('../utils/logger');

const generateSecret = () => crypto.randomBytes(32).toString('hex');
const hashSecret = (secret) => crypto.createHash('sha256').update(secret).digest('hex');

/**
 * Ensure an SmsGateway exists for a given Device.
 * Called when Device is approved.
 */
const ensureGateway = async (device, audit = {}) => {
  let gateway = await SmsGateway.findOne({ deviceId: device._id });

  if (gateway) {
    // Update metadata from device
    gateway.deviceName = device.deviceName || gateway.deviceName;
    gateway.gatewayId = device.uuid;
    gateway.cooperativeId = device.cooperativeId;
    gateway.deviceModel = device.deviceModel || gateway.deviceModel;
    gateway.manufacturer = device.manufacturer || gateway.manufacturer;
    gateway.androidVersion = device.androidVersion || gateway.androidVersion;
    if (gateway.status === 'revoked') {
      gateway.status = 'pending';
      gateway.secretToken = hashSecret(generateSecret()); // regenerate token? safer to keep old? We'll keep old and allow rotation.
    }
    gateway.updatedAt = new Date();
    await gateway.save();
    return { gateway, secretToken: null };
  }

  // Create new SmsGateway
  const secretToken = generateSecret();
  const hashedToken = hashSecret(secretToken);

  gateway = new SmsGateway({
    deviceId: device._id,
    gatewayId: device.uuid,
    secretToken: hashedToken,
    secretIssuedAt: new Date(),
    secretVersion: 1,
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

  logger.info('SmsGateway auto‑created on device approval', {
    deviceId: device._id,
    gatewayId: device.uuid,
    userId: audit.userId,
  });

  return { gateway, secretToken };
};

const revokeGateway = async (deviceId) => {
  const gateway = await SmsGateway.findOneAndUpdate(
    { deviceId },
    {
      status: 'revoked',
      secretToken: null, // invalidate token
      updatedAt: new Date(),
    },
    { new: true }
  );
  if (gateway) {
    logger.info('SmsGateway revoked', { deviceId, gatewayId: gateway.gatewayId });
  }
  return gateway;
};

const rotateToken = async (gatewayId, audit = {}) => {
  const gateway = await SmsGateway.findOne({ gatewayId });
  if (!gateway) throw new Error('Gateway not found');
  if (gateway.status === 'revoked') throw new Error('Gateway is revoked');
  const newSecret = generateSecret();
  const hashed = hashSecret(newSecret);
  gateway.secretToken = hashed;
  gateway.secretIssuedAt = new Date();
  gateway.secretVersion = (gateway.secretVersion || 0) + 1;
  gateway.updatedAt = new Date();
  await gateway.save();
  return { secretToken: newSecret };
};

module.exports = {
  ensureGateway,
  revokeGateway,
  rotateToken,
};