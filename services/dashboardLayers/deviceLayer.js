const Device = require('../../models/device');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getDevices = async (cooperativeId) => {
  try {
    // ✅ VALIDATE: Cooperative exists
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');
    
    // ✅ FIXED: Show ALL devices (pending + approved, exclude revoked only)
    const devices = await Device.find({ 
      cooperativeId,
      revoked: false  // Only exclude revoked
    });
    
    const healthData = [];
    let totalDevices = 0;
    let activeDevices = 0;
    let inactiveDevices = 0;
    let pendingDevices = 0;
    let approvedDevices = 0;
    let pendingApproval = 0;

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

      // ✅ Track approval status
      if (device.approved) {
        approvedDevices++;
        totalDevices++;  // Only count approved for health stats
        if (hoursSinceSync !== null && hoursSinceSync <= 24 && todayTx > 0) {
          activeDevices++;
        } else if (hoursSinceSync !== null && hoursSinceSync > 24) {
          inactiveDevices++;
        }
      } else {
        pendingApproval++;
      }
      
      if (pendingTx > 0) pendingDevices++;

      healthData.push({
        _id: device._id,
        uuid: device.uuid,
        deviceId: device.uuid,
        hardwareId: device.hardware_id,
        name: device.name || 'Unnamed Device',
        location: device.location || 'Unknown',
        type: device.type || 'Standard',
        status: device.approved ? 'approved' : 'pending',
        approved: device.approved,
        revoked: device.revoked,
        lastSync: lastTx?.timestamp_server || null,
        hoursSinceSync: hoursSinceSync !== null ? hoursSinceSync.toFixed(1) : null,
        pendingTransactions: pendingTx,
        todayTransactions: todayTx,
        healthScore,
        healthStatus: status,
        last_seen: device.last_seen,
        autoSyncEnabled: true
      });
    }

    return {
      health: healthData.sort((a, b) => b.healthScore - a.healthScore),  // Best first
      summary: {
        totalDevices: devices.length,           // All devices
        approvedDevices,
        pendingApproval,
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
  health: [],
  summary: { 
    totalDevices: 0, approvedDevices: 0, pendingApproval: 0,
    activeDevices: 0, inactiveDevices: 0, pendingDevices: 0, syncRate: 0 
  }
});

module.exports = { getDevices };