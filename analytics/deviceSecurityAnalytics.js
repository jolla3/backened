const Device = require('../models/device');
const Transaction = require('../models/transaction');

const getDeviceIntelligence = async () => {
  const devices = await Device.find({ approved: true, revoked: false });
  const intelligence = [];

  for (const device of devices) {
    const lastTx = await Transaction.findOne({ device_id: device.uuid }).sort({ timestamp_server: -1 });
    const pendingTx = await Transaction.countDocuments({ device_id: device.uuid, status: 'pending' });
    
    const hoursSinceSync = lastTx ? (Date.now() - new Date(lastTx.timestamp_server)) / 36e5 : 999;
    const risk = hoursSinceSync > 24 ? 'HIGH' : 'LOW';

    // Check for unusual transaction volume
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const todayTx = await Transaction.countDocuments({
      device_id: device.uuid,
      timestamp_server: { $gte: today }
    });

    intelligence.push({
      deviceId: device.uuid,
      hardwareId: device.hardware_id,
      lastSync: lastTx?.timestamp_server || null,
      hoursSinceSync: hoursSinceSync > 999 ? null : hoursSinceSync.toFixed(1),
      pendingTransactions: pendingTx,
      todayTransactions: todayTx,
      risk,
      status: hoursSinceSync > 24 ? 'inactive' : 'active'
    });
  }

  return intelligence;
};

module.exports = { getDeviceIntelligence };