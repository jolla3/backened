const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getDailyTotal = async (date, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: startOfDay, $lte: endOfDay }
    }},
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }}
  ]);

  logger.info('Daily total retrieved', { date, cooperativeId: cooperative._id });
  return result[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0 };
};

const getMonthlySummary = async (year, month, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: startOfMonth, $lte: endOfMonth }
    }},
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' }
    }},
    { $sort: { _id: 1 } }
  ]);

  logger.info('Monthly summary retrieved', { year, month, cooperativeId: cooperative._id });
  return result;
};

module.exports = { getDailyTotal, getMonthlySummary };