const Device = require('../../models/device');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getDevices = async (cooperativeId) => {  // ✅ FIXED: Accept cooperativeId
  try {
    // ✅ FIXED: Use cooperativeId directly (no lookup needed)
    const devices = await Device.find({ 
      approved: true, 
      revoked: false, 
      cooperativeId 
    });
    
    // ... rest of your logic stays the same
    const healthData = [];
    let totalDevices = 0;
    let activeDevices = 0;
    let inactiveDevices = 0;
    let pendingDevices = 0;

    for (const device of devices) {
      const lastTx = await Transaction.findOne({ device_id: device.uuid }).sort({ timestamp_server: -1 });
      const pendingTx = await Transaction.countDocuments({ device_id: device.uuid, status: 'pending' });
      
      const hoursSinceSync = lastTx 
        ? (Date.now() - new Date(lastTx.timestamp_server)) / 36e5 
        : null;
      
      const todayTx = await Transaction.countDocuments({
        device_id: device.uuid,
        timestamp_server: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) }
      });

      let healthScore = 100;
      if (hoursSinceSync !== null && hoursSinceSync > 24) healthScore -= 30;
      if (hoursSinceSync !== null && hoursSinceSync > 48) healthScore -= 20;
      if (pendingTx > 5) healthScore -= 15;
      if (todayTx === 0) healthScore -= 10;

      let status = 'healthy';
      if (healthScore < 50) status = 'critical';
      else if (healthScore < 75) status = 'warning';

      totalDevices++;
      if (hoursSinceSync !== null && hoursSinceSync <= 24 && todayTx > 0) {
        activeDevices++;
      } else if (hoursSinceSync !== null && hoursSinceSync > 24) {
        inactiveDevices++;
      }
      if (pendingTx > 0) {
        pendingDevices++;
      }

      healthData.push({
        deviceId: device.uuid,
        hardwareId: device.hardware_id,
        lastSync: lastTx?.timestamp_server || null,
        hoursSinceSync: hoursSinceSync !== null ? hoursSinceSync.toFixed(1) : null,
        pendingTransactions: pendingTx,
        todayTransactions: todayTx,
        healthScore,
        status,
        autoSyncEnabled: true
      });
    }

    return {
      health: healthData.sort((a, b) => a.healthScore - b.healthScore),
      summary: {
        totalDevices,
        activeDevices,
        inactiveDevices,
        pendingDevices,
        syncRate: totalDevices > 0 ? ((activeDevices / totalDevices) * 100) : 0
      }
    };
  } catch (error) {
    logger.warn('Devices failed', { error: error.message, coopId: cooperativeId });
    return getDefaultDevices();
  }
};

const getDefaultDevices = () => ({
  totalDevices: 0,
  activeDevices: 0,
  inactiveDevices: 0,
  pendingDevices: 0,
  syncRate: 0,
  health: []
});

module.exports = { getDevices };