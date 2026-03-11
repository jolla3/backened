const Device = require('../models/device');
const Cooperative = require('../models/cooperative');
const io = require('../websocket');
const logger = require('../utils/logger');

const registerDevice = async (uuid, hardwareId, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const device = await Device.findOne({ $or: [{ uuid }, { hardware_id: hardwareId }] });
  if (device) return device;

  const newDevice = await Device.create({
    uuid,
    hardware_id: hardwareId,
    approved: false,
    cooperativeId: cooperative._id,
    created_by: adminId
  });

  logger.info('Device registered', { uuid: newDevice.uuid, cooperativeId: cooperative._id });
  return newDevice;
};

const approveDevice = async (deviceId, adminId) => {
  const device = await Device.findById(deviceId);
  if (!device) throw new Error('Device not found');

  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || device.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Device does not belong to your cooperative');
  }

  const updatedDevice = await Device.findByIdAndUpdate(
    deviceId,
    { approved: true },
    { new: true }
  );

  io.to('admin').emit('device-approved', { deviceId });
  return updatedDevice;
};

const revokeDevice = async (deviceId, adminId) => {
  const device = await Device.findById(deviceId);
  if (!device) throw new Error('Device not found');

  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || device.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Device does not belong to your cooperative');
  }

  const updatedDevice = await Device.findByIdAndUpdate(
    deviceId,
    {
      revoked: true,
      revoked_timestamp: new Date()
    },
    { new: true }
  );

  io.to('admin').emit('device-revoked', { deviceId });
  return updatedDevice;
};

module.exports = { registerDevice, approveDevice, revokeDevice };