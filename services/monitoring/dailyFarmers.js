// services/monitoring/dailyFarmers.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');

/**
 * Get daily farmer deliveries with morning/afternoon split
 */
const getDailyFarmers = async (cooperativeId, date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    type: 'milk',
    timestamp_server: { $gte: start, $lte: end },
  };

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$farmer_id',
        morningLitres: {
          $sum: {
            $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, '$litres', 0],
          },
        },
        afternoonLitres: {
          $sum: {
            $cond: [{ $gte: [{ $hour: '$timestamp_server' }, 12] }, '$litres', 0],
          },
        },
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactions: { $sum: 1 },
        morningTransactions: {
          $sum: {
            $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, 1, 0],
          },
        },
        afternoonTransactions: {
          $sum: {
            $cond: [{ $gte: [{ $hour: '$timestamp_server' }, 12] }, 1, 0],
          },
        },
      },
    },
    {
      $lookup: {
        from: 'farmers',
        localField: '_id',
        foreignField: '_id',
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        farmerId: '$_id',
        farmerName: { $ifNull: ['$farmer.name', 'Unknown'] },
        farmerCode: { $ifNull: ['$farmer.farmer_code', ''] },
        zone: { $ifNull: ['$farmer.zoneName', ''] },
        morningLitres: 1,
        afternoonLitres: 1,
        totalLitres: 1,
        totalPayout: 1,
        transactions: 1,
        morningTransactions: 1,
        afternoonTransactions: 1,
      },
    },
    { $sort: { totalLitres: -1 } },
  ];

  return await Transaction.aggregate(pipeline);
};

/**
 * Get daily inventory transactions (all categories)
 */
const getDailyInventory = async (cooperativeId, date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    type: 'feed',
    timestamp_server: { $gte: start, $lte: end },
  };

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'inventories',
        localField: 'product_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        productName: { $ifNull: ['$product.name', 'Unknown'] },
        category: { $ifNull: ['$product.category', 'Other'] },
        quantity: 1,
        cost: 1,
        farmer_id: 1,
        timestamp_server: 1,
        paymentMethod: 1,
        unit: { $ifNull: ['$product.unit', 'units'] },
      },
    },
    { $sort: { timestamp_server: -1 } },
  ];

  return await Transaction.aggregate(pipeline);
};

/**
 * Get farmer performance history (milk trend)
 */
const getFarmerPerformance = async (cooperativeId, farmerId, days = 30) => {
  const end = new Date();
  end.setHours(23, 59, 59, 999);
  const start = new Date(end);
  start.setDate(start.getDate() - days);
  start.setHours(0, 0, 0, 0);

  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    farmer_id: new mongoose.Types.ObjectId(farmerId),
    type: 'milk',
    timestamp_server: { $gte: start, $lte: end },
  };

  const milkPipeline = [
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        litres: { $sum: '$litres' },
        payout: { $sum: '$payout' },
        transactions: { $sum: 1 },
        morning: {
          $sum: {
            $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, '$litres', 0],
          },
        },
        afternoon: {
          $sum: {
            $cond: [{ $gte: [{ $hour: '$timestamp_server' }, 12] }, '$litres', 0],
          },
        },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const milkData = await Transaction.aggregate(milkPipeline);

  // Feed purchases for the same period
  const feedMatch = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    farmer_id: new mongoose.Types.ObjectId(farmerId),
    type: 'feed',
    timestamp_server: { $gte: start, $lte: end },
  };

  const feedPipeline = [
    { $match: feedMatch },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        quantity: { $sum: '$quantity' },
        cost: { $sum: '$cost' },
      },
    },
    { $sort: { _id: 1 } },
  ];

  const feedData = await Transaction.aggregate(feedPipeline);

  return {
    milk: milkData,
    feed: feedData,
  };
};

/**
 * Get farmer purchases for a specific date (all inventory categories)
 */
const getFarmerPurchases = async (cooperativeId, farmerId, date) => {
  const start = new Date(date);
  start.setHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setHours(23, 59, 59, 999);

  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    farmer_id: new mongoose.Types.ObjectId(farmerId),
    type: 'feed',
    timestamp_server: { $gte: start, $lte: end },
  };

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'inventories',
        localField: 'product_id',
        foreignField: '_id',
        as: 'product',
      },
    },
    { $unwind: { path: '$product', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        productName: { $ifNull: ['$product.name', 'Unknown'] },
        category: { $ifNull: ['$product.category', 'Other'] },
        quantity: 1,
        cost: 1,
        paymentMethod: 1,
        timestamp_server: 1,
        unit: { $ifNull: ['$product.unit', 'units'] },
      },
    },
    { $sort: { timestamp_server: -1 } },
  ];

  return await Transaction.aggregate(pipeline);
};

// ─── Exports ──────────────────────────────────────────────────────
module.exports = {
  getDailyFarmers,
  getDailyInventory,
  getFarmerPerformance,
  getFarmerPurchases, // ✅ Ensure this is exported
};