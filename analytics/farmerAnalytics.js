const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// Farmers with Highest Debt (Negative Balance)
const getFarmersWithDebt = async (limit = 10) => {
  const farmers = await Farmer.find({ balance: { $lt: 0 } })
    .sort({ balance: 1 })
    .limit(limit)
    .select('name phone balance branch_id');

  return farmers;
};

// Top Farmers by Balance (Credit)
const getTopFarmersByBalance = async (limit = 10) => {
  const farmers = await Farmer.find({ balance: { $gte: 0 } })
    .sort({ balance: -1 })
    .limit(limit)
    .select('name phone balance branch_id');

  return farmers;
};

// Farmers Buying Feed But Delivering Little Milk
const getFeedMilkImbalance = async (limit = 10) => {
  const farmers = await Farmer.find({});
  
  const imbalanceList = [];
  
  for (const farmer of farmers) {
    const milkStats = await Transaction.aggregate([
      { $match: { type: 'milk', farmer_id: farmer._id } },
      { $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' }
      }}
    ]);

    const feedStats = await Transaction.aggregate([
      { $match: { type: 'feed', farmer_id: farmer._id } },
      { $group: {
        _id: null,
        totalQuantity: { $sum: '$quantity' },
        totalCost: { $sum: '$cost' }
      }}
    ]);

    const milkLitres = milkStats[0]?.totalLitres || 0;
    const feedCost = feedStats[0]?.totalCost || 0;
    
    // If feed cost > milk payout, they're in debt
    if (feedCost > milkStats[0]?.totalPayout && milkLitres < 50) {
      imbalanceList.push({
        farmerId: farmer._id,
        farmerName: farmer.name,
        farmerPhone: farmer.phone,
        milkLitres,
        milkPayout: milkStats[0]?.totalPayout || 0,
        feedCost,
        netBalance: (milkStats[0]?.totalPayout || 0) - feedCost,
        currentBalance: farmer.balance
      });
    }
  }

  return imbalanceList.sort((a, b) => a.netBalance - b.netBalance).slice(0, limit);
};

// Farmer Transaction History
const getFarmerTransactionHistory = async (farmerId, limit = 20) => {
  const transactions = await Transaction.find({ farmer_id: farmerId })
    .sort({ timestamp_server: -1 })
    .limit(limit)
    .populate('farmer_id', 'name phone');

  return transactions;
};

module.exports = {
  getFarmersWithDebt,
  getTopFarmersByBalance,
  getFeedMilkImbalance,
  getFarmerTransactionHistory
};