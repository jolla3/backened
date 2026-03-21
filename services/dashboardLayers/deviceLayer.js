const Device = require('../../models/device');
const Transaction = require('../../models/transaction');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getDevices = async (cooperativeId) => {
  try {
    // ✅ VALIDATE cooperative
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');
    
    logger.info('Fetching devices', { cooperativeId, cooperativeName: cooperative.name });
    
    // ✅ FIXED: Match YOUR devices exactly
    const devices = await Device.find({ 
      cooperativeId: cooperativeId,  // Only exact match
      revoked: false                // Exclude revoked only
    }).lean();  // Faster query
    
    logger.info('Found devices', { count: devices.length, cooperativeId });
    
    if (devices.length === 0) {
      logger.warn('No devices found for cooperative', { cooperativeId });
      return {
        health: [],
        summary: { 
          totalDevices: 0, 
          approvedDevices: 0, 
          pendingApproval: 0,
          activeDevices: 0, 
          inactiveDevices: 0, 
          pendingDevices: 0, 
          syncRate: 0 
        }
      };
    }

    const healthData = [];
    let totalDevices = 0;
    let activeDevices = 0;
    let inactiveDevices = 0;
    let pendingDevicesCount = 0;
    let approvedDevices = 0;
    let pendingApproval = 0;

    for (const device of devices) {
      // ✅ Transaction lookup (your transactions have NO device_id matches)
      const lastTx = await Transaction.findOne({ 
        device_id: device.uuid 
      }).sort({ timestamp_server: -1 }).lean();
      
      const pendingTx = await Transaction.countDocuments({ 
        device_id: device.uuid, 
        status: 'pending' 
      });
      
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

      let healthStatus = 'healthy';
      if (healthScore < 50) healthStatus = 'critical';
      else if (healthScore < 75) healthStatus = 'warning';

      // ✅ Approval stats
      if (device.approved) {
        approvedDevices++;
        totalDevices++;
        if (hoursSinceSync !== null && hoursSinceSync <= 24 && todayTx > 0) {
          activeDevices++;
        } else if (hoursSinceSync !== null && hoursSinceSync > 24) {
          inactiveDevices++;
        }
      } else {
        pendingApproval++;
      }
      
      if (pendingTx > 0) pendingDevicesCount++;

      healthData.push({
        _id: device._id,
        uuid: device.uuid,
        deviceId: device.uuid,
        hardwareId: device.hardware_id,
        name: device.name || `Device ${device.uuid.slice(-6)}`,
        location: device.location || 'Not set',
        type: device.type || 'Standard',
        status: device.approved ? 'approved' : 'pending',
        approved: device.approved || false,
        revoked: device.revoked || false,
        created_at: device.created_at,
        last_seen: device.last_seen,
        lastSync: lastTx?.timestamp_server || null,
        hoursSinceSync: hoursSinceSync !== null ? hoursSinceSync.toFixed(1) : 'Never',
        pendingTransactions: pendingTx,
        todayTransactions: todayTx,
        healthScore: Math.max(0, healthScore),
        healthStatus,
        autoSyncEnabled: true
      });
    }

    const result = {
      health: healthData.sort((a, b) => b.healthScore - a.healthScore),
      summary: {
        totalDevices: devices.length,
        approvedDevices,
        pendingApproval,
        activeDevices,
        inactiveDevices,
        pendingDevices: pendingDevicesCount,
        syncRate: totalDevices > 0 ? ((activeDevices / totalDevices) * 100).toFixed(1) : 0
      }
    };
    
    logger.info('Devices result', { 
      result: JSON.stringify(result.summary, null, 2),
      cooperativeId 
    });
    
    return result;
  } catch (error) {
    logger.error('Devices error', { error: error.message, coopId: cooperativeId });
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