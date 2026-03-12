const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Inventory = require('../models/inventory');
const Porter = require('../models/porter');

const getAiAdvisory = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const insights = [];

  // 1. Milk Production Drop Analysis
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const lastWeek = new Date(today);
  lastWeek.setDate(lastWeek.getDate() - 7);

  const [todayMilk, lastWeekMilk] = await Promise.all([
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ]),
    Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastWeek, $lt: today } } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
    ])
  ]);

  const todayLitres = todayMilk[0]?.totalLitres || 0;
  const lastWeekLitres = lastWeekMilk[0]?.totalLitres || 0;
  const dropPercent = lastWeekLitres > 0 ? ((lastWeekLitres - todayLitres) / lastWeekLitres) * 100 : 0;

  if (dropPercent > 15) {
    insights.push({
      category: 'production_drop',
      severity: 'high',
      message: `Milk production dropped ${dropPercent.toFixed(1)}% this week`,
      possibleCauses: ['rainfall drop', 'feed shortage', 'farmer inactivity'],
      recommendation: 'Visit farms in underperforming zones'
    });
  }

  // 2. Feed Shortage Analysis
  const lowStock = await Inventory.aggregate([
    { $match: { cooperativeId: cooperative._id, $expr: { $lte: ['$stock', '$threshold'] } } },
    { $limit: 3 }
  ]);

  if (lowStock.length > 0) {
    insights.push({
      category: 'feed_shortage',
      severity: 'high',
      message: `${lowStock.length} feed products at critical stock levels`,
      possibleCauses: ['high demand', 'supply chain delay', 'poor forecasting'],
      recommendation: 'Place urgent restock orders'
    });
  }

  // 3. Farmer Retention Risk (Optimized)
  const inactiveFarmers = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { $group: { _id: '$farmer_id', lastDelivery: { $max: '$timestamp_server' } } },
    { $lookup: { from: 'farmers', localField: '_id', foreignField: '_id', as: 'farmer' } },
    { $unwind: '$farmer' },
    { $project: { farmerId: '$_id', lastDelivery: 1 } }
  ]);

  let criticalInactive = 0;
  for (const farmer of inactiveFarmers) {
    const days = (Date.now() - new Date(farmer.lastDelivery)) / 86400000;
    if (days > 14) criticalInactive++;
  }

  if (criticalInactive > 5) {
    insights.push({
      category: 'farmer_retention',
      severity: 'medium',
      message: `${criticalInactive} farmers inactive for 14+ days`,
      possibleCauses: ['payment delays', 'better offers elsewhere', 'cattle health issues'],
      recommendation: 'Contact farmers and resolve payment issues'
    });
  }

  // 4. Porter Efficiency Analysis (Optimized)
  const porterStats = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { $group: { _id: '$device_id', totalLitres: { $sum: '$litres' }, transactionCount: { $sum: 1 } } },
    { $lookup: { from: 'porters', localField: '_id', foreignField: '_id', as: 'porter' } },
    { $unwind: '$porter' },
    { $project: { name: '$porter.name', litres: '$totalLitres', transactions: '$transactionCount' } }
  ]);

  const avgLitres = porterStats.length > 0 
    ? porterStats.reduce((sum, p) => sum + p.litres, 0) / porterStats.length 
    : 0;

  const underperformingPorters = porterStats.filter(p => p.litres < avgLitres * 0.7);
  if (underperformingPorters.length > 0) {
    insights.push({
      category: 'porter_efficiency',
      severity: 'medium',
      message: `${underperformingPorters.length} porters below average collection`,
      possibleCauses: ['route inefficiency', 'device issues', 'low farmer coverage'],
      recommendation: 'Review porter routes and provide support'
    });
  }

  return insights.sort((a, b) => (b.severity === 'high' ? 1 : 0));
};

module.exports = { getAiAdvisory };