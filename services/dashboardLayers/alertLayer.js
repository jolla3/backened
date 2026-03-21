const Inventory = require('../../models/inventory');
const Transaction = require('../../models/transaction');
const Porter = require('../../models/porter');
const Device = require('../../models/device');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const summaryLayer = require('./summaryLayer');  // ✅ Import summary
const taskService = require('../../services/taskService');
const logger = require('../../utils/logger');

const getAlerts = async (cooperativeId) => {  // ✅ FIXED
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const tasks = await taskService.getTasks('pending', cooperativeId);
    const summary = await summaryLayer.getSummary(cooperativeId);  // ✅ Use cooperativeId

    const alerts = [];

    // 1. Production Drop Alert
    if (summary.milkChange < -20) {
      alerts.push({
        type: 'production_drop',
        severity: 'warning',
        message: `Milk collection dropped ${Math.abs(summary.milkChange).toFixed(1)}% today`
      });
    }

    // 2. Low Stock Alert
    const lowStock = await Inventory.aggregate([
      { $match: { cooperativeId: cooperative._id, $expr: { $lte: ['$stock', '$threshold'] } } },
      { $count: 'count' }
    ]);
    if (lowStock[0]?.count > 0) {
      alerts.push({ 
        type: 'stock_risk', 
        severity: 'high', 
        message: `${lowStock[0].count} products below threshold` 
      });
    }

    // 3. Device Offline (only approved devices)
    const devices = await Device.find({ 
      approved: true, 
      revoked: false, 
      cooperativeId: cooperative._id 
    });
    for (const device of devices) {
      const lastTx = await Transaction.findOne({ 
        device_id: device.uuid 
      }).sort({ timestamp_server: -1 });
      if (lastTx) {
        const hours = (Date.now() - new Date(lastTx.timestamp_server)) / 36e5;
        if (hours > 24) {
          alerts.push({ 
            type: 'device_offline', 
            severity: 'high', 
            message: `Device ${device.uuid.slice(-8)} inactive for ${Math.round(hours)}h` 
          });
        }
      }
    }

    // 4. Farmer Inactivity (top 5)
    const inactiveFarmers = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id } },
      { 
        $lookup: {
          from: 'farmers',
          localField: 'farmer_id',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { 
        $group: {
          _id: '$farmer._id',
          farmerName: { $first: '$farmer.name' },
          lastDelivery: { $max: '$timestamp_server' }
        }
      },
      { $match: { lastDelivery: { $lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) } } },
      { $sort: { lastDelivery: 1 } },
      { $limit: 5 }
    ]);

    inactiveFarmers.forEach(farmer => {
      const days = (Date.now() - new Date(farmer.lastDelivery)) / 86400000;
      alerts.push({ 
        type: 'farmer_inactivity', 
        severity: days > 14 ? 'critical' : 'high', 
        message: `Farmer ${farmer.farmerName} no delivery in ${Math.round(days)} days` 
      });
    });

    // 5. High Debt Farmers
    const highDebtFarmers = await Farmer.find({ 
      cooperativeId: cooperative._id, 
      balance: { $lt: -5000 } 
    });
    if (highDebtFarmers.length > 0) {
      alerts.push({ 
        type: 'high_debt', 
        severity: 'high', 
        message: `${highDebtFarmers.length} farmers with debt > KES 5,000` 
      });
    }

    return { 
      alerts: alerts.slice(0, 10),  // Limit to 10
      tasks 
    };
  } catch (error) {
    logger.warn('Alerts failed', { error: error.message, coopId });
    return getDefaultAlerts();
  }
};

const getDefaultAlerts = () => ({ alerts: [], tasks: [] });

module.exports = { getAlerts };