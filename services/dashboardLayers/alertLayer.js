const Inventory = require('../../models/inventory');
const Transaction = require('../../models/transaction');
const Porter = require('../../models/porter');
const Device = require('../../models/device');
const Farmer = require('../../models/farmer');
const taskService = require('../../services/taskService');
const logger = require('../../utils/logger');

const getAlerts = async () => {
  try {
    const alerts = [];
    const tasks = await taskService.getTasks('pending');

    // ✅ FIXED: Real alerts based on actual data
    const summary = await summaryLayer.getSummary();

    // 1. Production Drop Alert
    if (summary.milkChange < -20) {
      alerts.push({
        type: 'production_drop',
        severity: 'warning',
        message: `Milk collection dropped ${Math.abs(summary.milkChange).toFixed(1)}% today`
      });
    }

    // 2. Stock Risk
    const lowStock = await Inventory.aggregate([
      { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
      { $count: 'count' }
    ]);
    if (lowStock[0]?.count > 0) {
      alerts.push({ type: 'stock_risk', severity: 'high', message: `${lowStock[0].count} products below threshold` });
    }

    // 3. Device Offline
    const devices = await Device.find({ approved: true, revoked: false });
    for (const device of devices) {
      const lastTx = await Transaction.findOne({ device_id: device.uuid }).sort({ timestamp_server: -1 });
      if (lastTx) {
        const hours = (Date.now() - new Date(lastTx.timestamp_server)) / 36e5;
        if (hours > 24) {
          alerts.push({ type: 'device_offline', severity: 'high', message: `Device ${device.uuid} inactive for ${hours.toFixed(0)}h` });
        }
      }
    }

    // 4. Farmer Inactivity
    const farmers = await Farmer.find({});
    for (const farmer of farmers) {
      const lastTx = await Transaction.findOne({ farmer_id: farmer._id, type: 'milk' }).sort({ timestamp_server: -1 });
      if (lastTx) {
        const days = (Date.now() - new Date(lastTx.timestamp_server)) / 86400000;
        if (days > 7) {
          alerts.push({ type: 'farmer_inactivity', severity: days > 14 ? 'critical' : 'high', message: `Farmer ${farmer.name} no delivery in ${days.toFixed(0)} days` });
        }
      }
    }

    // 5. High Debt
    const highDebtFarmers = await Farmer.find({ balance: { $lt: -5000 } });
    if (highDebtFarmers.length > 0) {
      alerts.push({ type: 'high_debt', severity: 'high', message: `${highDebtFarmers.length} farmers with debt > KES 5,000` });
    }

    return { alerts, tasks };
  } catch (error) {
    logger.warn('Alerts failed', { error: error.message });
    return getDefaultAlerts();
  }
};

const getDefaultAlerts = () => ({ alerts: [], tasks: [] });

module.exports = { getAlerts };