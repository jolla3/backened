const Device = require('../models/device');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// Active Devices
const getActiveDevices = async () => {
  const devices = await Device.find({ approved: true, revoked: false });
  
  const activeList = [];
  
  for (const device of devices) {
    const lastTransaction = await Transaction.findOne({ device_id: device.uuid })
      .sort({ timestamp_server: -1 });
    
    const hoursSinceLastSync = lastTransaction 
      ? (Date.now() - new Date(lastTransaction.timestamp_server)) / 36e5 
      : 999;
    
    activeList.push({
      deviceId: device.uuid,
      hardwareId: device.hardware_id,
      approved: device.approved,
      revoked: device.revoked,
      lastSeen: device.last_seen,
      lastTransaction: lastTransaction?.timestamp_server || null,
      hoursSinceLastSync: parseFloat(hoursSinceLastSync.toFixed(2)),
      status: hoursSinceLastSync > 24 ? 'inactive' : 'active'
    });
  }

  return activeList;
};

// Devices Stopped Syncing (>24 hours)
const getInactiveDevices = async () => {
  const devices = await Device.find({ approved: true, revoked: false });
  
  const inactiveList = [];
  
  for (const device of devices) {
    const lastTransaction = await Transaction.findOne({ device_id: device.uuid })
      .sort({ timestamp_server: -1 });
    
    const hoursSinceLastSync = lastTransaction 
      ? (Date.now() - new Date(lastTransaction.timestamp_server)) / 36e5 
      : 999;
    
    if (hoursSinceLastSync > 24) {
      inactiveList.push({
        deviceId: device.uuid,
        hardwareId: device.hardware_id,
        lastSeen: device.last_seen,
        lastTransaction: lastTransaction?.timestamp_server || null,
        hoursSinceLastSync: parseFloat(hoursSinceLastSync.toFixed(2)),
        status: 'inactive'
      });
    }
  }

  return inactiveList.sort((a, b) => b.hoursSinceLastSync - a.hoursSinceLastSync);
};

// Pending Device Approvals
const getPendingDevices = async () => {
  return await Device.find({ approved: false, revoked: false });
};

// Device Sync Summary
const getDeviceSyncSummary = async () => {
  const totalDevices = await Device.countDocuments();
  const activeDevices = await Device.countDocuments({ approved: true, revoked: false });
  const pendingDevices = await Device.countDocuments({ approved: false, revoked: false });
  const revokedDevices = await Device.countDocuments({ revoked: true });
  
  const inactiveDevices = await Device.find({ approved: true, revoked: false });
  let inactiveCount = 0;
  
  for (const device of inactiveDevices) {
    const lastTransaction = await Transaction.findOne({ device_id: device.uuid })
      .sort({ timestamp_server: -1 });
    
    const hoursSinceLastSync = lastTransaction 
      ? (Date.now() - new Date(lastTransaction.timestamp_server)) / 36e5 
      : 999;
    
    if (hoursSinceLastSync > 24) inactiveCount++;
  }

  return {
    totalDevices,
    activeDevices,
    pendingDevices,
    revokedDevices,
    inactiveDevices: inactiveCount,
    syncRate: activeDevices > 0 ? ((activeDevices - inactiveCount) / activeDevices * 100).toFixed(2) : 0
  };
};

module.exports = {
  getActiveDevices,
  getInactiveDevices,
  getPendingDevices,
  getDeviceSyncSummary
};