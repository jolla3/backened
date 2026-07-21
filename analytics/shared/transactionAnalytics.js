// analytics/shared/transactionAnalytics.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Inventory = require('../../models/inventory');
const logger = require('../../utils/logger');

/**
 * Get milk trend for a period
 */
const getMilkTrend = async (coopId, startDate, endDate = null) => {
  const match = {
    type: 'milk',
    cooperativeId: coopId,
    timestamp_server: { $gte: startDate },
  };
  if (endDate) match.timestamp_server.$lt = endDate;

  const result = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return result.map(r => ({
    date: r._id,
    litres: r.totalLitres || 0,
    transactions: r.transactionCount || 0,
  }));
};

/**
 * Get feed trend (quantity and revenue)
 */
const getFeedTrend = async (coopId, startDate, endDate = null) => {
  const match = {
    type: 'feed',
    cooperativeId: coopId,
    timestamp_server: { $gte: startDate },
  };
  if (endDate) match.timestamp_server.$lt = endDate;

  const result = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        totalQty: { $sum: '$quantity' },
        totalRevenue: { $sum: '$cost' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return result.map(r => ({
    date: r._id,
    quantity: r.totalQty || 0,
    revenue: r.totalRevenue || 0,
  }));
};

/**
 * Get daily collection trend (milk, feed, revenue combined)
 */
const getDailyCollectionTrend = async (coopId, startDate) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        cooperativeId: coopId,
        timestamp_server: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: {
          date: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
          type: '$type',
        },
        totalLitres: { $sum: '$litres' },
        totalQty: { $sum: '$quantity' },
        totalRevenue: { $sum: '$cost' },
        totalPayout: { $sum: '$payout' },
        count: { $sum: 1 },
      },
    },
    { $sort: { '_id.date': 1 } },
  ]);

  // Transform to daily objects
  const dailyMap = {};
  for (const r of result) {
    const date = r._id.date;
    if (!dailyMap[date]) {
      dailyMap[date] = {
        date,
        milk: { litres: 0, transactions: 0, payout: 0 },
        feed: { quantity: 0, revenue: 0, transactions: 0 },
      };
    }
    if (r._id.type === 'milk') {
      dailyMap[date].milk.litres = r.totalLitres || 0;
      dailyMap[date].milk.payout = r.totalPayout || 0;
      dailyMap[date].milk.transactions = r.count || 0;
    } else if (r._id.type === 'feed') {
      dailyMap[date].feed.quantity = r.totalQty || 0;
      dailyMap[date].feed.revenue = r.totalRevenue || 0;
      dailyMap[date].feed.transactions = r.count || 0;
    }
  }

  return Object.values(dailyMap).sort((a, b) => a.date.localeCompare(b.date));
};

/**
 * Get porter performance (top 10)
 */
const getPorterPerformance = async (coopId, startDate = null) => {
  const match = { type: 'milk', cooperativeId: coopId };
  if (startDate) match.timestamp_server = { $gte: startDate };

  const result = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$porter_id',
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        farmers: { $addToSet: '$farmer_id' },
        zones: { $addToSet: '$zone' },
        avgLitres: { $avg: '$litres' },
      },
    },
    {
      $lookup: {
        from: 'porters',
        localField: '_id',
        foreignField: '_id',
        as: 'porter',
      },
    },
    { $unwind: { path: '$porter', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        name: { $ifNull: ['$porter.name', 'Unknown'] },
        totalLitres: 1,
        transactionCount: 1,
        farmerCount: { $size: '$farmers' },
        zoneCount: { $size: '$zones' },
        zones: 1,
        avgLitres: 1,
        isActive: { $ifNull: ['$porter.isActive', false] },
      },
    },
    { $sort: { totalLitres: -1 } },
    { $limit: 10 },
  ]);

  return result;
};

/**
 * Get top farmers (top 10)
 */
const getTopFarmers = async (coopId, limit = 10) => {
  const result = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: coopId } },
    {
      $group: {
        _id: '$farmer_id',
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 },
        avgLitres: { $avg: '$litres' },
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
        totalLitres: 1,
        totalPayout: 1,
        transactionCount: 1,
        avgLitres: { $round: ['$avgLitres', 2] },
      },
    },
    { $match: { farmerId: { $ne: null } } },
    { $sort: { totalLitres: -1 } },
    { $limit: limit },
  ]);

  return result;
};

/**
 * Get bottom farmers (lowest 10)
 */
const getBottomFarmers = async (coopId, limit = 10) => {
  const result = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: coopId } },
    {
      $group: {
        _id: '$farmer_id',
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 },
        avgLitres: { $avg: '$litres' },
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
        totalLitres: 1,
        totalPayout: 1,
        transactionCount: 1,
        avgLitres: { $round: ['$avgLitres', 2] },
      },
    },
    { $match: { farmerId: { $ne: null } } },
    { $sort: { totalLitres: 1 } },
    { $limit: limit },
  ]);

  return result;
};

/**
 * Get zone production (from transaction.zone field)
 */
const getZoneProduction = async (coopId, startDate = null) => {
  const match = { type: 'milk', cooperativeId: coopId };
  if (startDate) match.timestamp_server = { $gte: startDate };

  const result = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $ifNull: ['$zone', 'Unassigned'] },
        totalMilk: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 },
        farmers: { $addToSet: '$farmer_id' },
        avgLitres: { $avg: '$litres' },
      },
    },
    {
      $project: {
        zone: '$_id',
        totalMilk: 1,
        totalPayout: 1,
        transactionCount: 1,
        farmerCount: { $size: '$farmers' },
        avgLitres: { $round: ['$avgLitres', 2] },
      },
    },
    { $sort: { totalMilk: -1 } },
  ]);

  return result;
};

/**
 * Get peak hours with formatted hour strings
 */
const getPeakHours = async (coopId, startDate) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        type: 'milk',
        cooperativeId: coopId,
        timestamp_server: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: { $hour: '$timestamp_server' },
        count: { $sum: 1 },
        totalLitres: { $sum: '$litres' },
        avgLitres: { $avg: '$litres' },
      },
    },
    { $sort: { count: -1 } },
    { $limit: 8 },
  ]);

  return result.map(h => {
    const hourNum = h._id;
    const ampm = hourNum >= 12 ? 'PM' : 'AM';
    const hour12 = hourNum % 12 || 12;
    return {
      hour: `${String(hour12).padStart(2, '0')}:00 ${ampm}`,
      hourNum,
      transactions: h.count,
      litres: h.totalLitres || 0,
      avgLitres: Math.round(h.avgLitres || 0),
    };
  });
};

/**
 * Get milk prediction
 */
const getMilkPrediction = async (coopId) => {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const trends = await getMilkTrend(coopId, thirtyDaysAgo, today);
  if (trends.length < 7) {
    return {
      predictedTomorrow: null,
      confidence: 'low',
      basedOn: 'Insufficient data',
      last7Average: 0,
    };
  }

  const weekdayMap = {};
  for (const t of trends) {
    const date = new Date(t.date);
    const day = date.getDay();
    if (!weekdayMap[day]) weekdayMap[day] = [];
    weekdayMap[day].push(t.litres);
  }

  const todayDay = now.getDay();
  const sameWeekdayData = weekdayMap[todayDay] || [];
  const avgSameWeekday = sameWeekdayData.length > 0
    ? sameWeekdayData.reduce((s, v) => s + v, 0) / sameWeekdayData.length
    : 0;

  const last7 = trends.slice(-7);
  const avgLast7 = last7.reduce((s, v) => s + v.litres, 0) / last7.length;

  const prediction = sameWeekdayData.length >= 3 ? avgSameWeekday : avgLast7;
  const confidence = sameWeekdayData.length >= 3 ? 'medium' : 'low';

  return {
    predictedTomorrow: Math.round(prediction),
    confidence,
    basedOn: sameWeekdayData.length >= 3 ? 'Same weekday average' : '7-day average',
    last7Average: Math.round(avgLast7),
  };
};

/**
 * Get farmer growth (daily registrations)
 */
const getFarmerGrowth = async (coopId, startDate, endDate = null) => {
  const match = { cooperativeId: coopId };
  if (startDate) match.createdAt = { $gte: startDate };
  if (endDate) match.createdAt.$lt = endDate;

  const result = await Farmer.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return result.map(r => ({
    date: r._id,
    registrations: r.count,
  }));
};

/**
 * Get payment methods breakdown
 */
const getPaymentMethods = async (coopId, startDate) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        type: 'feed',
        cooperativeId: coopId,
        timestamp_server: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: '$paymentMethod',
        total: { $sum: '$cost' },
        count: { $sum: 1 },
      },
    },
  ]);

  const methods = {};
  for (const r of result) {
    methods[r._id || 'unknown'] = {
      amount: r.total || 0,
      count: r.count || 0,
    };
  }
  return methods;
};

/**
 * Get product sales breakdown (by inventory category)
 */
const getProductSales = async (coopId, startDate) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        type: 'feed',
        cooperativeId: coopId,
        timestamp_server: { $gte: startDate },
        product_id: { $exists: true },
      },
    },
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
      $group: {
        _id: { $ifNull: ['$product.category', 'Other'] },
        totalQuantity: { $sum: '$quantity' },
        totalRevenue: { $sum: '$cost' },
        transactionCount: { $sum: 1 },
      },
    },
    {
      $project: {
        category: '$_id',
        totalQuantity: 1,
        totalRevenue: 1,
        transactionCount: 1,
      },
    },
    { $sort: { totalRevenue: -1 } },
  ]);

  return result;
};

/**
 * Get collection time distribution (hourly buckets)
 */
const getCollectionTimeDistribution = async (coopId, startDate) => {
  const result = await Transaction.aggregate([
    {
      $match: {
        type: 'milk',
        cooperativeId: coopId,
        timestamp_server: { $gte: startDate },
      },
    },
    {
      $group: {
        _id: { $hour: '$timestamp_server' },
        transactions: { $sum: 1 },
        litres: { $sum: '$litres' },
        avgLitres: { $avg: '$litres' },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  return result.map(h => ({
    hour: h._id,
    hourLabel: `${String(h._id).padStart(2, '0')}:00`,
    transactions: h.transactions || 0,
    litres: h.litres || 0,
    avgLitres: Math.round(h.avgLitres || 0),
  }));
};

module.exports = {
  getMilkTrend,
  getFeedTrend,
  getDailyCollectionTrend,
  getPorterPerformance,
  getTopFarmers,
  getBottomFarmers,
  getZoneProduction,
  getPeakHours,
  getMilkPrediction,
  getFarmerGrowth,
  getPaymentMethods,
  getProductSales,
  getCollectionTimeDistribution,
};