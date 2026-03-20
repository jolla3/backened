const Device = require('../models/device');
const Cooperative = require('../models/cooperative');

const registerDevice = async (deviceData) => {
  const { deviceId, name, location, type, adminId, cooperativeId, uuid, hardware_id } = deviceData;
  
  // ✅ Validate cooperative exists
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // Create device
  const device = new Device({
    deviceId: deviceId || uuid || hardware_id,
    name,
    location,
    type,
    adminId,
    cooperativeId,
    status: 'pending'
  });
  
  return await device.save();
};

const approveDevice = async (deviceId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const device = await Device.findOneAndUpdate(
    { _id: deviceId, cooperativeId },
    { status: 'approved' },
    { new: true }
  );
  
  if (!device) throw new Error('Device not found');
  return device;
};

const revokeDevice = async (deviceId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const device = await Device.findOneAndUpdate(
    { _id: deviceId, cooperativeId },
    { status: 'revoked' },
    { new: true }
  );
  
  if (!device) throw new Error('Device not found');
  return device;
};

module.exports = { registerDevice, approveDevice, revokeDevice };