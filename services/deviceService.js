const Device = require('../models/device');
const io = require('../websocket');
const logger = require('../utils/logger');

const registerDevice = async (uuid, hardwareId) => {
  const device = await Device.findOne({ $or: [{ uuid }, { hardware_id: hardwareId }] });
  if (device) return device;

  const newDevice = await Device.create({ uuid, hardware_id: hardwareId, approved: false });
  logger.info('Device registered', { uuid: newDevice.uuid });
  return newDevice;
};

const approveDevice = async (deviceId) => {
  const device = await Device.findByIdAndUpdate(deviceId, { approved: true }, { new: true });
  io.to('admin').emit('device-approved', { deviceId });
  return device;
};

const revokeDevice = async (deviceId) => {
  const device = await Device.findByIdAndUpdate(deviceId, {
    revoked: true,
    revoked_timestamp: new Date()
  }, { new: true });
  io.to('admin').emit('device-revoked', { deviceId });
  return device;
};

module.exports = { registerDevice, approveDevice, revokeDevice };