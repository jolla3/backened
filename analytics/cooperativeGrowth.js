const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getCooperativeGrowth = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

    const [farmersThisMonth, farmersLastMonth, milkThisMonth, milkLastMonth, feedThisMonth, feedLastMonth] = await Promise.all([
      Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: startOfMonth } }),
      Farmer.countDocuments({ cooperativeId: cooperative._id, createdAt: { $gte: startOfLastMonth, $lt: startOfMonth } }),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfLastMonth, $lt: startOfMonth } } },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfMonth } } },
        { $group: { _id: null, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { type: 'feed', cooperativeId: cooperative._id, timestamp_server: { $gte: startOfLastMonth, $lt: startOfMonth } } },
        { $group: { _id: null, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } }
      ])
    ]);

    const milkGrowth = milkLastMonth[0]?.totalLitres > 0 
      ? Math.round(((milkThisMonth[0]?.totalLitres - milkLastMonth[0]?.totalLitres) / milkLastMonth[0]?.totalLitres) * 100 * 10) / 10
      : milkThisMonth[0]?.totalLitres > 0 ? 100 : 0;

    const feedGrowth = feedLastMonth[0]?.totalQty > 0 
      ? Math.round(((feedThisMonth[0]?.totalQty - feedLastMonth[0]?.totalQty) / feedLastMonth[0]?.totalQty) * 100 * 10) / 10
      : feedThisMonth[0]?.totalQty > 0 ? 100 : 0;

    const farmerGrowth = farmersLastMonth > 0 
      ? Math.round(((farmersThisMonth - farmersLastMonth) / farmersLastMonth) * 100 * 10) / 10
      : farmersThisMonth > 0 ? 100 : 0;

    return {
      farmersJoinedThisMonth: farmersThisMonth,
      farmersGrowth: `${farmerGrowth}%`,
      milkGrowth: `${milkGrowth}%`,
      feedSalesGrowth: `${feedGrowth}%`,
      monthComparison: {
        farmersThisMonth,
        farmersLastMonth,
        milkThisMonth: Math.round(milkThisMonth[0]?.totalLitres || 0),
        milkLastMonth: Math.round(milkLastMonth[0]?.totalLitres || 0),
        feedThisMonth: Math.round(feedThisMonth[0]?.totalQty || 0),
        feedLastMonth: Math.round(feedLastMonth[0]?.totalQty || 0)
      }
    };
  } catch (error) {
    logger.error('CooperativeGrowth failed', { error: error.message, coopId });
    return getDefaultGrowth();
  }
};

const getDefaultGrowth = () => ({
  farmersJoinedThisMonth: 0,
  farmersGrowth: '0%',
  milkGrowth: '0%',
  feedSalesGrowth: '0%',
  monthComparison: {
    farmersThisMonth: 0,
    farmersLastMonth: 0,
    milkThisMonth: 0,
    milkLastMonth: 0,
    feedThisMonth: 0,
    feedLastMonth: 0
  }
});

module.exports = { getCooperativeGrowth };