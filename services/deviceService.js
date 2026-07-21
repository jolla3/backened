const Device = require('../models/device');
const Cooperative = require('../models/cooperative');

const registerDevice = async (deviceData) => {
  const {
    deviceId,          // will be used as uuid
    deviceName,        // from expo-device
    osBuildId,         // from expo-device
    platform,          // 'android' | 'ios' | 'windows' | 'web' | 'unknown'
    hardware_id,       // optional extra hardware ID
    adminId,
    cooperativeId,
  } = deviceData;

  // Validate cooperative
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  // Use provided deviceId as uuid (or fallback)
  const deviceUuid = deviceId || `DEV-${Date.now()}`;

  // Try to find existing device by uuid
  let device = await Device.findOne({ uuid: deviceUuid });

  if (device) {
    // Update existing device: refresh last_seen, update fields
    device.last_seen = new Date();
    if (deviceName) device.deviceName = deviceName;
    if (osBuildId) device.osBuildId = osBuildId;
    if (platform) device.platform = platform;
    if (hardware_id) device.hardware_id = hardware_id;
    await device.save();
    return device;
  } else {
    // Create new device
    const newDevice = new Device({
      uuid: deviceUuid,
      hardware_id: hardware_id || null,
      deviceName: deviceName || null,
      osBuildId: osBuildId || null,
      platform: platform || 'unknown',
      cooperativeId,
      created_by: adminId,
      // approved: false (default)
      // revoked: false (default)
      // last_seen: Date.now() (default)
    });
    await newDevice.save();
    return newDevice;
  }
};

const approveDevice = async (deviceId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const device = await Device.findOneAndUpdate(
    { _id: deviceId, cooperativeId },
    { approved: true },
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
    {
      revoked: true,
      revoked_timestamp: new Date()
    },
    { new: true }
  );
  if (!device) throw new Error('Device not found');
  return device;
};

module.exports = { registerDevice, approveDevice, revokeDevice };