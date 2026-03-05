const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

const getDailyTotal = async (date) => {
  const startOfDay = new Date(date);
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      timestamp_server: { $gte: startOfDay, $lte: endOfDay }
    }},
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }}
  ]);

  return result[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0 };
};

const getMonthlySummary = async (year, month) => {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      timestamp_server: { $gte: startOfMonth, $lte: endOfMonth }
    }},
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' }
    }},
    { $sort: { _id: 1 } }
  ]);

  return result;
};

module.exports = { getDailyTotal, getMonthlySummary };