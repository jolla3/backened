const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getMonthlyReport = async (year, month, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  // ✅ FIXED: Parse to numbers + validate
  const y = parseInt(year);
  const m = parseInt(month);
  
  if (isNaN(y) || isNaN(m) || m < 1 || m > 12) {
    throw new Error('Invalid year or month');
  }

  const startOfMonth = new Date(y, m - 1, 1);  // ✅ JS months 0-indexed
  const endOfMonth = new Date(y, m, 0, 23, 59, 59, 999);

  // ✅ FIXED: Remove createdAt filter - causes Invalid Date
  const farmers = await Farmer.find({ 
    cooperativeId: cooperative._id
  });
  
  const transactions = await Transaction.find({
    cooperativeId: cooperative._id,
    timestamp_server: { $gte: startOfMonth, $lte: endOfMonth }
  });

  const report = {
    farmers: farmers.length,
    transactions: transactions.length,
    totalMilk: transactions.filter(t => t.type === 'milk').reduce((sum, t) => sum + (t.litres || 0), 0),
    totalPayout: transactions.filter(t => t.type === 'milk').reduce((sum, t) => sum + (t.payout || 0), 0)
  };

  return report;
};
module.exports = { getMonthlyReport };