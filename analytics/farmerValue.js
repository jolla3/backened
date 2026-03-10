const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');

const getFarmerValue = async () => {
  const farmers = await Farmer.find({});
  const values = [];

  for (const farmer of farmers) {
    const milkStats = await Transaction.aggregate([
      { $match: { type: 'milk', farmer_id: farmer._id } },
      { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' } } }
    ]);

    const feedStats = await Transaction.aggregate([
      { $match: { type: 'feed', farmer_id: farmer._id } },
      { $group: { _id: null, totalCost: { $sum: '$cost' } } }
    ]);

    const milkValue = milkStats[0]?.totalPayout || 0;
    const feedCost = feedStats[0]?.totalCost || 0;
    const netValue = milkValue - feedCost;
    const totalTransactions = (milkStats[0]?.totalLitres || 0) + (feedStats[0]?.totalCost || 0);

    // ✅ FIXED: Correct tier logic based on ACTIVITY, not just value
    let tier = 'inactive';
    if (totalTransactions > 0) {
      if (netValue > 50000) tier = 'high_value';
      else if (netValue > 10000) tier = 'loyal';
      else if (netValue > 0) tier = 'growing';
      else tier = 'new'; // Has transactions but negative value
    }

    values.push({
      farmer: farmer.name,
      lifetimeMilk: milkStats[0]?.totalLitres || 0,
      feedPurchased: feedCost,
      netValue: netValue,
      valueTier: tier,
      totalTransactions
    });
  }

  return values.sort((a, b) => b.netValue - a.netValue);
};

module.exports = { getFarmerValue };