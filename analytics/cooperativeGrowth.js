const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');

const getCooperativeGrowth = async () => {
  const now = new Date();
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const startOfLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);

  const farmersThisMonth = await Farmer.countDocuments({ createdAt: { $gte: startOfMonth } });
  const farmersLastMonth = await Farmer.countDocuments({ createdAt: { $gte: startOfLastMonth, $lt: startOfMonth } });

  const milkThisMonth = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: startOfMonth } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);

  const milkLastMonth = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: startOfLastMonth, $lt: startOfMonth } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);

  const feedThisMonth = await Transaction.aggregate([
    { $match: { type: 'feed', timestamp_server: { $gte: startOfMonth } } },
    { $group: { _id: null, totalQty: { $sum: '$quantity' } } }
  ]);

  const feedLastMonth = await Transaction.aggregate([
    { $match: { type: 'feed', timestamp_server: { $gte: startOfLastMonth, $lt: startOfMonth } } },
    { $group: { _id: null, totalQty: { $sum: '$quantity' } } }
  ]);

  const milkGrowth = milkLastMonth[0]?.totalLitres > 0 
    ? ((milkThisMonth[0]?.totalLitres - milkLastMonth[0]?.totalLitres) / milkLastMonth[0]?.totalLitres) * 100 
    : 0;

  const feedGrowth = feedLastMonth[0]?.totalQty > 0 
    ? ((feedThisMonth[0]?.totalQty - feedLastMonth[0]?.totalQty) / feedLastMonth[0]?.totalQty) * 100 
    : 0;

  const farmerGrowth = farmersLastMonth > 0 
    ? ((farmersThisMonth - farmersLastMonth) / farmersLastMonth) * 100 
    : 0;

  return {
    farmersJoinedThisMonth: farmersThisMonth,
    farmersGrowth: farmerGrowth.toFixed(1) + '%',
    milkGrowth: milkGrowth.toFixed(1) + '%',
    feedSalesGrowth: feedGrowth.toFixed(1) + '%'
  };
};

module.exports = { getCooperativeGrowth };