const Device = require('../models/device');
const Cooperative = require('../models/cooperative');
const gatewayService = require('./gatewayService');
const logger = require('../utils/logger');

const registerDevice = async (deviceData) => {
  const {
    deviceId,
    deviceName,
    osBuildId,
    platform,
    hardware_id,
    deviceModel,
    manufacturer,
    androidVersion,
    adminId,
    cooperativeId,
  } = deviceData;

  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const deviceUuid = deviceId || `DEV-${Date.now()}`;

  let device = await Device.findOne({ uuid: deviceUuid });

  if (device) {
    device.last_seen = new Date();
    if (deviceName) device.deviceName = deviceName;
    if (osBuildId) device.osBuildId = osBuildId;
    if (platform) device.platform = platform;
    if (hardware_id) device.hardware_id = hardware_id;
    if (deviceModel) device.deviceModel = deviceModel;
    if (manufacturer) device.manufacturer = manufacturer;
    if (androidVersion) device.androidVersion = androidVersion;
    await device.save();
    return device;
  }

  const newDevice = new Device({
    uuid: deviceUuid,
    hardware_id: hardware_id || null,
    deviceName: deviceName || null,
    osBuildId: osBuildId || null,
    platform: platform || 'unknown',
    deviceModel: deviceModel || null,
    manufacturer: manufacturer || null,
    androidVersion: androidVersion || null,
    cooperativeId,
    created_by: adminId,
  });
  await newDevice.save();
  return newDevice;
};

const approveDevice = async (deviceId, cooperativeId, audit = {}) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const device = await Device.findOne({ _id: deviceId, cooperativeId });
  if (!device) throw new Error('Device not found');

  if (device.approved) {
    // Idempotent: if already approved, still ensure gateway exists
    const { gateway } = await gatewayService.ensureGatewayForDevice(device, audit);
    return { device, gateway, secretToken: null };
  }

  device.approved = true;
  await device.save();

  const { gateway, secretToken } = await gatewayService.ensureGatewayForDevice(device, audit);
  return { device, gateway, secretToken };
};

const revokeDevice = async (deviceId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const device = await Device.findOneAndUpdate(
    { _id: deviceId, cooperativeId },
    {
      revoked: true,
      revoked_timestamp: new Date(),
    },
    { new: true }
  );
  if (!device) throw new Error('Device not found');

  await gatewayService.revokeGatewayForDevice(device._id);
  return device;
};

module.exports = { registerDevice, approveDevice, revokeDevice };