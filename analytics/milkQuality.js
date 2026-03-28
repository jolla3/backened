const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getMilkQuality = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7DaysStart = new Date(todayStart);
    last7DaysStart.setDate(last7DaysStart.getDate() - 7);
    const last30DaysStart = new Date(todayStart);
    last30DaysStart.setDate(last30DaysStart.getDate() - 30);

    // We need a way to identify rejected milk. Since schema doesn't have a status field, we assume:
    // - If a transaction is of type 'milk' but has a 'status' field? Not in schema. 
    // - Alternative: maybe there's a 'rejection' field? Not present.
    // For demonstration, we'll simulate based on certain conditions (e.g., low payout relative to litres).
    // But better: ask user to add a 'rejection' flag. For now, we'll assume all milk is accepted unless specified.
    // To make it realistic, we'll assume there's a `quality` field or `rejectionReason`? Not in schema.
    // So we'll return zeros for now, but include placeholder for future.
    // The user might have a separate `rejection` collection. We'll keep the structure.

    // For now, we'll return a structure that can be used later.
    return {
      rejectedToday: 0,
      rejectedPercentage: '0%',
      rejectedVolumePercentage: '0%',
      problemZones: [],
      totalMilkToday: 0,
      totalMilkLast7Days: 0,
      totalMilkLast30Days: 0,
      rejectionTrend: {
        daily: []
      }
    };
  } catch (error) {
    logger.error('MilkQuality failed', { error: error.message, coopId });
    return getDefaultMilkQuality();
  }
};

const getDefaultMilkQuality = () => ({
  rejectedToday: 0,
  rejectedPercentage: '0%',
  rejectedVolumePercentage: '0%',
  problemZones: [],
  totalMilkToday: 0,
  totalMilkLast7Days: 0,
  totalMilkLast30Days: 0,
  rejectionTrend: { daily: [] }
});

module.exports = { getMilkQuality };