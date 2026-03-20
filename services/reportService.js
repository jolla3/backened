const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getMonthlyReport = async (year, month, cooperativeId) => {  // ✅ cooperativeId
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const farmers = await Farmer.find({ 
    cooperativeId: cooperative._id,
    createdAt: { $lte: endOfMonth } 
  });
  
  const transactions = await Transaction.find({
    cooperativeId: cooperative._id,
    timestamp_server: { $gte: startOfMonth, $lte: endOfMonth }
  });

  const report = {
    farmers: farmers.length,
    transactions: transactions.length,
    totalMilk: transactions.filter(t => t.type === 'milk').reduce((sum, t) => sum + t.litres, 0),
    totalPayout: transactions.filter(t => t.type === 'milk').reduce((sum, t) => sum + t.payout, 0)
  };

  return report;
};
module.exports = { getMonthlyReport };