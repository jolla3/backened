const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const getPayoutForecast = async () => {
  const farmers = await Farmer.find({ balance: { $gt: 0 } });
  const totalPayout = farmers.reduce((sum, f) => sum + f.balance, 0);
  const farmersToPay = farmers.length;

  // Next payout date (e.g., 15th of month)
  const nextPayout = new Date();
  nextPayout.setDate(15);

  return {
    nextPayoutDate: nextPayout.toISOString().split('T')[0],
    estimatedAmount: totalPayout,
    farmersToPay: farmersToPay
  };
};

module.exports = { getPayoutForecast };