const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');

const getPayoutForecast = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const farmers = await Farmer.find({ 
    cooperativeId: cooperative._id, 
    balance: { $gt: 0 } 
  });
  const totalPayout = farmers.reduce((sum, f) => sum + f.balance, 0);
  const farmersToPay = farmers.length;

  const nextPayout = new Date();
  nextPayout.setDate(15);

  return {
    nextPayoutDate: nextPayout.toISOString().split('T')[0],
    estimatedAmount: totalPayout,
    farmersToPay: farmersToPay
  };
};

module.exports = { getPayoutForecast };