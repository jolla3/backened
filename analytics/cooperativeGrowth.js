// analytics/cooperativeGrowth.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

/**
 * Get cooperative growth metrics for the CEO dashboard.
 * Includes monthly, quarterly, yearly, and rolling 7/30/90 day periods.
 */
const getCooperativeGrowth = async (cooperativeId) => {
  try {
    // ─── Convert to ObjectId once ──────────────────────────────
    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const cooperative = await Cooperative.findById(coopId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const startOfQuarter = new Date(now.getFullYear(), now.getMonth() - 3, 1);
    const startOfLastQuarter = new Date(now.getFullYear(), now.getMonth() - 6, 1);
    const startOfYear = new Date(now.getFullYear(), 0, 1);
    const startOfLastYear = new Date(now.getFullYear() - 1, 0, 1);

    // Rolling periods
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    /**
     * Helper to get farmers, milk litres, and feed quantity for a period.
     */
    const getPeriodData = async (startDate, endDate) => {
      const [farmers, milk, feed] = await Promise.all([
        Farmer.countDocuments({
          cooperativeId: coopId,
          createdAt: { $gte: startDate, $lt: endDate }
        }),
        Transaction.aggregate([
          {
            $match: {
              type: 'milk',
              cooperativeId: coopId,
              timestamp_server: { $gte: startDate, $lt: endDate }
            }
          },
          { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
        ]),
        Transaction.aggregate([
          {
            $match: {
              type: 'feed',
              cooperativeId: coopId,
              timestamp_server: { $gte: startDate, $lt: endDate }
            }
          },
          { $group: { _id: null, totalQty: { $sum: { $ifNull: ['$quantity', 0] } } } }
        ])
      ]);
      return {
        farmers,
        milk: milk[0]?.totalLitres || 0,
        feed: feed[0]?.totalQty || 0
      };
    };

    // ─── Fetch all periods in parallel ──────────────────────────
    const [
      currentMonth,
      lastMonth,
      currentQuarter,
      lastQuarter,
      currentYear,
      lastYear,
      rolling7,
      rolling30,
      rolling90
    ] = await Promise.all([
      getPeriodData(startOfMonth, now),
      getPeriodData(startOfLastMonth, startOfMonth),
      getPeriodData(startOfQuarter, now),
      getPeriodData(startOfLastQuarter, startOfQuarter),
      getPeriodData(startOfYear, now),
      getPeriodData(startOfLastYear, startOfYear),
      getPeriodData(sevenDaysAgo, now),
      getPeriodData(thirtyDaysAgo, now),
      getPeriodData(ninetyDaysAgo, now)
    ]);

    /**
     * Calculate growth percentage. Returns "New" if previous period was 0.
     */
    const calcGrowth = (current, previous) => {
      if (previous === 0 && current === 0) return '0%';
      if (previous === 0) return 'New';
      return `${(((current - previous) / previous) * 100).toFixed(1)}%`;
    };

    // ─── Return all metrics ──────────────────────────────────────
    return {
      // Monthly
      farmersThisMonth: currentMonth.farmers,
      farmersGrowthMonth: calcGrowth(currentMonth.farmers, lastMonth.farmers),
      milkThisMonth: Math.round(currentMonth.milk),
      milkGrowthMonth: calcGrowth(currentMonth.milk, lastMonth.milk),
      feedThisMonth: Math.round(currentMonth.feed),
      feedGrowthMonth: calcGrowth(currentMonth.feed, lastMonth.feed),

      // Quarterly
      farmersGrowthQuarter: calcGrowth(currentQuarter.farmers, lastQuarter.farmers),
      milkGrowthQuarter: calcGrowth(currentQuarter.milk, lastQuarter.milk),
      feedGrowthQuarter: calcGrowth(currentQuarter.feed, lastQuarter.feed),

      // Yearly
      farmersGrowthYear: calcGrowth(currentYear.farmers, lastYear.farmers),
      milkGrowthYear: calcGrowth(currentYear.milk, lastYear.milk),
      feedGrowthYear: calcGrowth(currentYear.feed, lastYear.feed),

      // Comparison for charts
      monthComparison: {
        farmersThisMonth: currentMonth.farmers,
        farmersLastMonth: lastMonth.farmers,
        milkThisMonth: Math.round(currentMonth.milk),
        milkLastMonth: Math.round(lastMonth.milk),
        feedThisMonth: Math.round(currentMonth.feed),
        feedLastMonth: Math.round(lastMonth.feed)
      },

      // Rolling periods (new)
      rolling7Days: {
        milk: Math.round(rolling7.milk),
        farmers: rolling7.farmers,
        feed: Math.round(rolling7.feed)
      },
      rolling30Days: {
        milk: Math.round(rolling30.milk),
        farmers: rolling30.farmers,
        feed: Math.round(rolling30.feed)
      },
      rolling90Days: {
        milk: Math.round(rolling90.milk),
        farmers: rolling90.farmers,
        feed: Math.round(rolling90.feed)
      }
    };
  } catch (error) {
    logger.error('CooperativeGrowth failed', {
      error: error.message,
      cooperativeId
    });
    return getDefaultGrowth();
  }
};

/**
 * Default growth object when data is missing.
 */
const getDefaultGrowth = () => ({
  farmersThisMonth: 0,
  farmersGrowthMonth: '0%',
  farmersGrowthQuarter: '0%',
  farmersGrowthYear: '0%',
  milkThisMonth: 0,
  milkGrowthMonth: '0%',
  milkGrowthQuarter: '0%',
  milkGrowthYear: '0%',
  feedThisMonth: 0,
  feedGrowthMonth: '0%',
  feedGrowthQuarter: '0%',
  feedGrowthYear: '0%',
  monthComparison: {
    farmersThisMonth: 0,
    farmersLastMonth: 0,
    milkThisMonth: 0,
    milkLastMonth: 0,
    feedThisMonth: 0,
    feedLastMonth: 0
  },
  rolling7Days: { milk: 0, farmers: 0, feed: 0 },
  rolling30Days: { milk: 0, farmers: 0, feed: 0 },
  rolling90Days: { milk: 0, farmers: 0, feed: 0 }
});

// ─── EXPORT ──────────────────────────────────────────────────────
module.exports = { getCooperativeGrowth };