// services/porterService.js
const mongoose = require('mongoose');
const Porter = require('../models/porter');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// ─── Helpers ───────────────────────────────────────────────
const getStartDate = (period) => {
  const now = new Date();
  if (period === 'daily') {
    now.setHours(0, 0, 0, 0);
    return now;
  }
  if (period === 'weekly') {
    now.setDate(now.getDate() - 7);
    return now;
  }
  // monthly
  now.setMonth(now.getMonth() - 1);
  return now;
};

const getPeriodDays = (period) => {
  if (period === 'daily') return 1;
  if (period === 'weekly') return 7;
  return 30; // monthly approximate
};

// ─── CRUD (unchanged) ──────────────────────────────────────
const createPorter = async (data, cooperativeId) => {
  const { cooperativeId: _, ...porterData } = data;
  const porter = await Porter.create({ ...porterData, cooperativeId });
  logger.info('Porter created', { porterId: porter._id, cooperativeId });
  return porter;
};

const getPorter = async (porterId, cooperativeId) => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Porter does not belong to your cooperative');
  }
  return porter;
};

const getAllPorters = async (cooperativeId) => {
  const porters = await Porter.find({ cooperativeId }).sort({ createdAt: -1 });
  logger.info('Porters retrieved', { count: porters.length, cooperativeId });
  return porters;
};

const updatePorter = async (porterId, data, cooperativeId) => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Cannot modify porters from other cooperatives');
  }
  const updatedPorter = await Porter.findByIdAndUpdate(
    porterId,
    { $set: data },
    { new: true, runValidators: true }
  );
  logger.info('Porter updated', { porterId, cooperativeId });
  return updatedPorter;
};

const deletePorter = async (porterId, cooperativeId) => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Cannot delete porters from other cooperatives');
  }
  await Porter.findByIdAndDelete(porterId);
  logger.info('Porter deleted', { porterId, cooperativeId });
  return { message: 'Porter deleted successfully' };
};

// ─── PERFORMANCE: Legacy (kept for backward compatibility) ──
const getPerformance = async (porterId, cooperativeId, period = 'monthly', groupBy = null) => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) throw new Error('Unauthorized');

  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const startDate = getStartDate(period);

  const match = {
    porter_id: porter._id,
    cooperativeId: coopId,
    timestamp_server: { $gte: startDate }
  };

  if (groupBy === 'day') {
    const daily = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
          litres: { $sum: '$litres' },
          payout: { $sum: '$payout' },
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);
    return {
      porterId: porter._id,
      porterName: porter.name,
      zones: porter.zones,
      daily: daily.map(d => ({ date: d._id, litres: d.litres, payout: d.payout, count: d.count })),
      period
    };
  }

  const performance = await Transaction.aggregate([
    { $match: match },
    { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' }, transactionCount: { $sum: 1 } } }
  ]);

  return {
    porterId: porter._id,
    porterName: porter.name,
    zones: porter.zones,
    totalLitres: performance[0]?.totalLitres || 0,
    totalPayout: performance[0]?.totalPayout || 0,
    transactionCount: performance[0]?.transactionCount || 0,
    period
  };
};

// ─── NEW PERFORMANCE ENDPOINTS ─────────────────────────────

// 1. Summary (cards, rank, zones, vs. average)
const getPerformanceSummary = async (porterId, cooperativeId, period = 'weekly') => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) throw new Error('Unauthorized');

  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const startDate = getStartDate(period);

  // 1) Porter's own stats
  const [ownStats] = await Transaction.aggregate([
    { $match: { porter_id: porter._id, cooperativeId: coopId, timestamp_server: { $gte: startDate } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' }, txCount: { $sum: 1 } } }
  ]);

  // 2) Cooperative average (per transaction)
  const [coopAvg] = await Transaction.aggregate([
    { $match: { cooperativeId: coopId, timestamp_server: { $gte: startDate } } },
    { $group: { _id: null, avgLitres: { $avg: '$litres' }, totalCoopLitres: { $sum: '$litres' } } }
  ]);

  // 3) Rank among porters by total litres
  const ranks = await Transaction.aggregate([
    { $match: { cooperativeId: coopId, timestamp_server: { $gte: startDate } } },
    { $group: { _id: '$porter_id', totalLitres: { $sum: '$litres' } } },
    { $sort: { totalLitres: -1 } }
  ]);
  const rank = ranks.findIndex(r => r._id.toString() === porter._id.toString()) + 1;

  // 4) Actual collection zones (from transactions)
  const zones = await Transaction.aggregate([
    { $match: { porter_id: porter._id, cooperativeId: coopId, timestamp_server: { $gte: startDate } } },
    { $group: { _id: '$zone', litres: { $sum: '$litres' }, farmers: { $addToSet: '$farmer_id' } } },
    { $project: { zone: '$_id', litres: 1, farmerCount: { $size: '$farmers' }, _id: 0 } }
  ]);

  // 5) Previous period for % change
  const prevStart = new Date(startDate);
  const days = getPeriodDays(period);
  prevStart.setDate(prevStart.getDate() - days);
  const [prevStats] = await Transaction.aggregate([
    { $match: { porter_id: porter._id, cooperativeId: coopId, timestamp_server: { $gte: prevStart, $lt: startDate } } },
    { $group: { _id: null, totalLitres: { $sum: '$litres' } } }
  ]);
  const percentChange = prevStats?.totalLitres
    ? ((ownStats?.totalLitres || 0) - prevStats.totalLitres) / prevStats.totalLitres * 100
    : 0;

  return {
    porterName: porter.name,
    period,
    totalLitres: ownStats?.totalLitres || 0,
    totalPayout: ownStats?.totalPayout || 0,
    transactionCount: ownStats?.txCount || 0,
    rank: rank || 0,
    totalPorters: ranks.length,
    coopAverageLitres: coopAvg?.avgLitres || 0,
    percentChange: Math.round(percentChange * 100) / 100,
    zones: zones.map(z => ({ zone: z.zone, litres: z.litres, farmers: z.farmerCount }))
  };
};

// 2. Trends (daily/hourly)
const getPerformanceTrends = async (porterId, cooperativeId, period = 'weekly', granularity = 'day') => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) throw new Error('Unauthorized');

  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const startDate = getStartDate(period);

  const groupFormat = granularity === 'hour'
    ? { $dateToString: { format: '%Y-%m-%d %H:00', date: '$timestamp_server' } }
    : { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } };

  const trends = await Transaction.aggregate([
    { $match: { porter_id: porter._id, cooperativeId: coopId, timestamp_server: { $gte: startDate } } },
    { $group: { _id: groupFormat, litres: { $sum: '$litres' }, payout: { $sum: '$payout' }, count: { $sum: 1 } } },
    { $sort: { _id: 1 } }
  ]);
  return trends.map(t => ({ label: t._id, litres: t.litres, payout: t.payout, transactions: t.count }));
};

// 3. Top farmers served
const getPerformanceFarmers = async (porterId, cooperativeId, period = 'weekly', limit = 20) => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  if (porter.cooperativeId.toString() !== cooperativeId) throw new Error('Unauthorized');

  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const startDate = getStartDate(period);

  const farmers = await Transaction.aggregate([
    { $match: { porter_id: porter._id, cooperativeId: coopId, timestamp_server: { $gte: startDate } } },
    { $group: { _id: '$farmer_id', totalLitres: { $sum: '$litres' }, txCount: { $sum: 1 } } },
    { $lookup: { from: 'farmers', localField: '_id', foreignField: '_id', as: 'farmer' } },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    { $project: { farmerName: '$farmer.name', totalLitres: 1, transactions: '$txCount' } },
    { $sort: { totalLitres: -1 } },
    { $limit: limit }
  ]);
  return farmers;
};

module.exports = {
  createPorter,
  getPorter,
  getAllPorters,
  updatePorter,
  deletePorter,
  getPerformance,             // legacy
  getPerformanceSummary,
  getPerformanceTrends,
  getPerformanceFarmers
};