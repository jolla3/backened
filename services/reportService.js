const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const getMonthlyReport = async (year, month) => {
  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const farmers = await Farmer.find({ createdAt: { $lte: endOfMonth } });
  const transactions = await Transaction.find({
    timestamp_server: { $gte: startOfMonth, $lte: endOfMonth }
  });

  return {
    farmers: farmers.length,
    transactions: transactions.length,
    totalMilk: transactions.filter(t => t.type === 'milk').reduce((sum, t) => sum + t.litres, 0),
    totalPayout: transactions.filter(t => t.type === 'milk').reduce((sum, t) => sum + t.payout, 0)
  };
};

module.exports = { getMonthlyReport };