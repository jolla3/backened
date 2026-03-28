const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Inventory = require('../models/inventory');
const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getAiAdvisory = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const insights = [];
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    // 1. Milk production drop analysis
    const [todayMilk, lastWeekMilk, lastMonthMilk] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastWeek, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastMonth, $lt: today } } },
        { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
      ])
    ]);

    const todayLitres = todayMilk[0]?.totalLitres || 0;
    const lastWeekLitres = lastWeekMilk[0]?.totalLitres || 0;
    const lastMonthLitres = lastMonthMilk[0]?.totalLitres || 0;

    if (lastWeekLitres > 0) {
      const dropWeek = ((lastWeekLitres - todayLitres) / lastWeekLitres) * 100;
      if (dropWeek > 15) {
        insights.push({
          category: 'production_drop',
          severity: 'high',
          message: `Milk production dropped ${dropWeek.toFixed(1)}% compared to last week.`,
          data: { today: todayLitres, lastWeek: lastWeekLitres },
          recommendation: 'Investigate with top farmers and check for weather or health issues.',
          possibleCauses: ['Farmer inactivity', 'Feed shortage', 'Weather impact']
        });
      }
    }

    // 2. Feed shortage risk (based on actual stock vs threshold)
    const lowStockItems = await Inventory.find({
      cooperativeId: cooperative._id,
      $expr: { $lte: ['$stock', '$threshold'] }
    }).lean();

    if (lowStockItems.length) {
      insights.push({
        category: 'feed_shortage',
        severity: lowStockItems.length > 2 ? 'high' : 'medium',
        message: `${lowStockItems.length} feed product${lowStockItems.length > 1 ? 's are' : ' is'} below minimum threshold.`,
        data: lowStockItems.map(i => ({ product: i.name, current: i.stock, threshold: i.threshold })),
        recommendation: 'Place orders immediately for the items listed.',
        possibleCauses: ['High demand', 'Supply chain delays', 'Poor forecasting']
      });
    }

    // 3. Farmer dropout risk (using actual decline in deliveries)
    const farmerDecline = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id } },
      {
        $group: {
          _id: '$farmer_id',
          last30: { $sum: { $cond: [{ $gte: ['$timestamp_server', lastMonth] }, '$litres', 0] } },
          prev30: { $sum: { $cond: [{ $lt: ['$timestamp_server', lastMonth] }, '$litres', 0] } }
        }
      },
      { $match: { prev30: { $gt: 0 }, last30: { $lt: { $multiply: ['$prev30', 0.5] } } } },
      { $lookup: { from: 'farmers', localField: '_id', foreignField: '_id', as: 'farmer' } },
      { $unwind: '$farmer' },
      { $project: { farmerName: '$farmer.name', decline: { $multiply: [{ $divide: [{ $subtract: ['$prev30', '$last30'] }, '$prev30'] }, 100] } } }
    ]);

    if (farmerDecline.length) {
      insights.push({
        category: 'farmer_dropout_risk',
        severity: 'high',
        message: `${farmerDecline.length} farmer${farmerDecline.length > 1 ? 's have' : ' has'} shown a >50% drop in deliveries.`,
        data: farmerDecline.slice(0, 5).map(f => ({ name: f.farmerName, decline: f.decline.toFixed(1) + '%' })),
        recommendation: 'Contact these farmers to understand the reasons and offer support.',
        possibleCauses: ['Payment issues', 'Cattle health', 'Competitor offers']
      });
    }

    // 4. Porter efficiency analysis (based on actual average per porter)
    const porterStats = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: lastMonth } } },
      {
        $group: {
          _id: '$porter_id',
          litres: { $sum: '$litres' },
          txCount: { $sum: 1 }
        }
      },
      { $lookup: { from: 'porters', localField: '_id', foreignField: '_id', as: 'porter' } },
      { $unwind: '$porter' },
      { $project: { name: '$porter.name', litres: 1, txCount: 1 } }
    ]);

    if (porterStats.length) {
      const avgLitres = porterStats.reduce((s, p) => s + p.litres, 0) / porterStats.length;
      const underperformers = porterStats.filter(p => p.litres < avgLitres * 0.6);
      if (underperformers.length) {
        insights.push({
          category: 'porter_efficiency',
          severity: 'medium',
          message: `${underperformers.length} porter${underperformers.length > 1 ? 's are' : ' is'} collecting significantly below average.`,
          data: underperformers.map(p => ({ name: p.name, litres: p.litres, avg: Math.round(avgLitres) })),
          recommendation: 'Review routes and provide training or equipment support.',
          possibleCauses: ['Inefficient routes', 'Device issues', 'Low farmer coverage']
        });
      }
    }

    // 5. Financial health (using real data: profit margin, cash flow)
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const [milkPayout, feedRevenue] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$payout' } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, total: { $sum: '$cost' } } }
      ])
    ]);

    const milkCost = milkPayout[0]?.total || 0;
    const feedIncome = feedRevenue[0]?.total || 0;
    const netProfit = feedIncome - milkCost;
    const profitMargin = feedIncome ? (netProfit / feedIncome) * 100 : 0;

    if (netProfit < 0) {
      insights.push({
        category: 'negative_cash_flow',
        severity: 'critical',
        message: `This month's feed revenue (KES ${feedIncome.toLocaleString()}) is less than milk payout (KES ${milkCost.toLocaleString()}).`,
        data: { milkPayout: milkCost, feedRevenue: feedIncome, netLoss: Math.abs(netProfit) },
        recommendation: 'Review pricing strategy, consider adjusting feed prices or milk rates.',
        possibleCauses: ['Low feed sales', 'High milk prices', 'Operational inefficiencies']
      });
    } else if (profitMargin < 10 && profitMargin > 0) {
      insights.push({
        category: 'low_profit_margin',
        severity: 'medium',
        message: `Profit margin is only ${profitMargin.toFixed(1)}%.`,
        data: { profitMargin: profitMargin.toFixed(1), milkPayout: milkCost, feedRevenue: feedIncome },
        recommendation: 'Identify cost reduction opportunities or increase feed sales.',
        possibleCauses: ['High milk payout', 'Low feed margins', 'Fixed overheads']
      });
    }

    return insights.sort((a, b) => (b.severity === 'critical' ? 1 : b.severity === 'high' ? 1 : -1));
  } catch (error) {
    logger.error('AI Advisory failed', { error: error.message, coopId: cooperativeId });
    return [];
  }
};

module.exports = { getAiAdvisory };