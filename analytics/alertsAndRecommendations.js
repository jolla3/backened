const Inventory = require('../models/inventory');
const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const Device = require('../models/device');
const Farmer = require('../models/farmer');

const getSmartAlerts = async () => {
  const alerts = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1. Stock Risk
  const lowStock = await Inventory.aggregate([
    { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
    { $count: 'count' }
  ]);
  if (lowStock[0]?.count > 0) {
    alerts.push({ type: 'stock_risk', severity: 'high', message: `${lowStock[0].count} products below threshold` });
  }

  // 2. Device Offline
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

  // 3. Farmer Inactivity
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

  // 4. High Debt
  const highDebtFarmers = await Farmer.find({ balance: { $lt: -5000 } });
  if (highDebtFarmers.length > 0) {
    alerts.push({ type: 'high_debt', severity: 'high', message: `${highDebtFarmers.length} farmers with debt > KES 5,000` });
  }

  // 5. Zero Milk Today
  const milkToday = await Transaction.countDocuments({ type: 'milk', timestamp_server: { $gte: today } });
  if (milkToday === 0) {
    alerts.push({ type: 'zero_milk', severity: 'critical', message: 'No milk collected today - investigate immediately' });
  }

  // 6. Porter Zero Activity
  const porters = await Porter.find({});
  for (const porter of porters) {
    const porterTx = await Transaction.countDocuments({ device_id: porter._id, timestamp_server: { $gte: today } });
    if (porterTx === 0) {
      alerts.push({ type: 'porter_inactive', severity: 'medium', message: `Porter ${porter.name} has zero activity today` });
    }
  }

  return alerts.sort((a, b) => (b.severity === 'critical' ? 1 : 0));
};

const getRecommendations = async () => {
  const recs = [];
  const stockout = await require('./predictiveAnalytics').predictStockout();
  
  if (stockout.length > 0) {
    recs.push(`Order ${stockout[0].product} immediately (Stockout in ${stockout[0].predictedStockoutDays} days)`);
  }

  const dropout = await require('./predictiveAnalytics').predictFarmerDropout();
  if (dropout.length > 0) {
    recs.push(`Contact ${dropout[0].farmerName} (Production dropped ${dropout[0].declinePercent}%)`);
  }

  return recs;
};

module.exports = { getSmartAlerts, getRecommendations };