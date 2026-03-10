const Device = require('../models/device');
const Inventory = require('../models/inventory');
const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Porter = require('../models/porter');

const generateActions = async () => {
  const actions = [];

  // 1. Device Inactivity
  const devices = await Device.find({ approved: true, revoked: false });
  for (const device of devices) {
    const lastTx = await Transaction.findOne({ device_id: device.uuid }).sort({ timestamp_server: -1 });
    if (lastTx) {
      const hours = (Date.now() - new Date(lastTx.timestamp_server)) / 36e5;
      if (hours > 12) {
        actions.push({
          type: 'device_inactivity',
          priority: hours > 24 ? 'HIGH' : 'MEDIUM',
          message: `Investigate Device ${device.uuid}: no sync in ${hours.toFixed(0)} hours`
        });
      }
    }
  }

  // 2. High Debt Farmers
  const highDebtFarmers = await Farmer.find({ balance: { $lt: -20000 } }).limit(5);
  for (const farmer of highDebtFarmers) {
    actions.push({
      type: 'high_debt',
      priority: 'HIGH',
      message: `Call farmer ${farmer.name}: outstanding balance KES ${Math.abs(farmer.balance).toLocaleString()}`
    });
  }

  // 3. Stockout Risk
  const lowStock = await Inventory.aggregate([
    { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
    { $limit: 3 }
  ]);
  for (const product of lowStock) {
    actions.push({
      type: 'stockout_risk',
      priority: 'HIGH',
      message: `Restock ${product.name}: ${product.stock} units remaining`
    });
  }

  // 4. Farmer Inactivity
  const farmers = await Farmer.find({}).limit(5);
  for (const farmer of farmers) {
    const lastTx = await Transaction.findOne({ farmer_id: farmer._id, type: 'milk' }).sort({ timestamp_server: -1 });
    if (lastTx) {
      const days = (Date.now() - new Date(lastTx.timestamp_server)) / 86400000;
      if (days > 7) {
        actions.push({
          type: 'farmer_inactivity',
          priority: days > 14 ? 'CRITICAL' : 'HIGH',
          message: `Contact ${farmer.name}: no delivery in ${days.toFixed(0)} days`
        });
      }
    }
  }

  // 5. Porter Fraud Risk
  const porters = await Porter.find({});
  for (const porter of porters) {
    const largeDeliveries = await Transaction.countDocuments({
      device_id: porter._id,
      type: 'milk',
      litres: { $gt: 100 }
    });
    if (largeDeliveries > 0) {
      actions.push({
        type: 'fraud_risk',
        priority: 'HIGH',
        message: `Audit ${porter.name}: ${largeDeliveries} large deliveries detected`
      });
    }
  }

  // 6. Zone Underperformance
  const zones = await Transaction.aggregate([
    { $match: { type: 'milk' } },
    { $lookup: {
      from: 'farmers',
      localField: 'farmer_id',
      foreignField: '_id',
      as: 'farmer'
    }},
    { $unwind: '$farmer' },
    { $group: {
      _id: '$farmer.branch_id',
      totalMilk: { $sum: '$litres' }
    }},
    { $sort: { totalMilk: 1 } },
    { $limit: 2 }
  ]);
  for (const zone of zones) {
    actions.push({
      type: 'zone_underperformance',
      priority: 'MEDIUM',
      message: `Zone ${zone._id} producing only ${zone.totalMilk} litres - investigate`
    });
  }

  return actions.sort((a, b) => {
    const priorityOrder = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
};

module.exports = { generateActions };