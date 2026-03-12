const Inventory = require('../models/inventory');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const predictStockout = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const products = await Inventory.find({ category: 'feed', cooperativeId: cooperative._id });
  const predictions = [];

  for (const product of products) {
    const last30Days = await Transaction.aggregate([
      { $match: { type: 'feed', cooperativeId: cooperative._id, product_id: product._id, timestamp_server: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: null, totalQty: { $sum: '$quantity' } } }
    ]);

    const avgDailySales = last30Days[0]?.totalQty / 30 || 0;
    const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : null;

    if (daysUntilStockout !== null && daysUntilStockout <= 14) {
      predictions.push({
        product: product.name,
        currentStock: product.stock,
        avgDailySales: avgDailySales.toFixed(2),
        predictedStockoutDays: daysUntilStockout,
        risk: daysUntilStockout <= 7 ? 'critical' : 'high'
      });
    }
  }

  return predictions;
};

const predictFarmerDropout = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const farmers = await Farmer.find({ cooperativeId: cooperative._id });
  const risks = [];

  for (const farmer of farmers) {
    const last30Days = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, farmer_id: farmer._id, timestamp_server: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ]);

    const last90Days = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, farmer_id: farmer._id, timestamp_server: { $gte: new Date(Date.now() - 90*24*60*60*1000), $lt: new Date(Date.now() - 30*24*60*60*1000) } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ]);

    const current = last30Days[0]?.totalLitres || 0;
    const previous = last90Days[0]?.totalLitres || 0;
    const decline = previous > 0 ? ((previous - current) / previous) * 100 : 0;

    if (decline > 30) {
      risks.push({
        farmerId: farmer._id,
        farmerName: farmer.name,
        currentLitres: current,
        previousLitres: previous,
        declinePercent: decline.toFixed(1),
        risk: 'high'
      });
    }
  }

  return risks.sort((a, b) => b.declinePercent - a.declinePercent);
};

module.exports = { predictStockout, predictFarmerDropout };