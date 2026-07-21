// services/monitoring/dashboard.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const { buildMatch } = require('./helpers');

const getDashboardKPIs = async (cooperativeId, range, zoneFilter = null, session = 'all') => {
  const match = buildMatch(cooperativeId, range, zoneFilter, session);

  const pipeline = [
    { $match: match },
    {
      $facet: {
        summary: [
          {
            $group: {
              _id: null,
              totalLitres: { $sum: '$litres' },
              totalPayout: { $sum: '$payout' },
              transactionCount: { $sum: 1 },
              farmers: { $addToSet: '$farmer_id' },
              porters: { $addToSet: '$porter_id' },
              zones: { $addToSet: '$zone' },
            },
          },
          {
            $project: {
              _id: 0,
              totalLitres: 1,
              totalPayout: 1,
              transactionCount: 1,
              farmerCount: { $size: '$farmers' },
              porterCount: { $size: '$porters' },
              zoneCount: { $size: '$zones' },
            },
          },
        ],
        averages: [
          {
            $group: {
              _id: null,
              avgLitresPerFarmer: { $avg: '$litres' },
              avgPayoutPerFarmer: { $avg: '$payout' },
              avgLitresPerTransaction: { $avg: '$litres' },
            },
          },
        ],
        zones: [
          {
            $group: {
              _id: '$zone',
              litres: { $sum: '$litres' },
              farmers: { $addToSet: '$farmer_id' },
              transactions: { $sum: 1 },
            },
          },
          {
            $project: {
              zone: '$_id',
              litres: 1,
              farmerCount: { $size: '$farmers' },
              transactionCount: 1,
            },
          },
          { $sort: { litres: -1 } },
        ],
        porters: [
          {
            $group: {
              _id: '$porter_id',
              litres: { $sum: '$litres' },
              farmers: { $addToSet: '$farmer_id' },
              transactions: { $sum: 1 },
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
              porterName: { $ifNull: ['$porter.name', 'Unknown'] },
              litres: 1,
              farmerCount: { $size: '$farmers' },
              transactionCount: 1,
            },
          },
          { $sort: { litres: -1 } },
        ],
        sessions: [
          {
            $group: {
              _id: {
                session: { $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, 'morning', 'afternoon'] },
              },
              litres: { $sum: '$litres' },
              farmers: { $addToSet: '$farmer_id' },
              transactions: { $sum: 1 },
            },
          },
          {
            $project: {
              session: '$_id.session',
              litres: 1,
              farmerCount: { $size: '$farmers' },
              transactionCount: 1,
            },
          },
        ],
        lateDeliveries: [
          {
            $match: {
              $or: [
                { $and: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, { $gt: [{ $hour: '$timestamp_server' }, 10] }] },
                { $and: [{ $gte: [{ $hour: '$timestamp_server' }, 12] }, { $gt: [{ $hour: '$timestamp_server' }, 16] }] },
              ],
            },
          },
          { $count: 'lateCount' },
        ],
      },
    },
  ];

  const result = await Transaction.aggregate(pipeline);
  const data = result[0] || {};

  const summary = data.summary?.[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0, farmerCount: 0, porterCount: 0, zoneCount: 0 };
  const averages = data.averages?.[0] || { avgLitresPerFarmer: 0, avgPayoutPerFarmer: 0, avgLitresPerTransaction: 0 };
  const lateDeliveries = data.lateDeliveries?.[0] || { lateCount: 0 };

  // Farmer participation (total vs active)
  const totalFarmers = await Farmer.countDocuments({ cooperativeId, isActive: true });
  const activeFarmers = summary.farmerCount || 0;
  const completionRate = totalFarmers > 0 ? (activeFarmers / totalFarmers) * 100 : 0;

  const sessionsMap = {};
  (data.sessions || []).forEach(s => { sessionsMap[s.session] = s; });

  return {
    summary: {
      totalLitres: Math.round(summary.totalLitres),
      totalPayout: Math.round(summary.totalPayout),
      transactionCount: summary.transactionCount,
      farmerCount: summary.farmerCount,
      porterCount: summary.porterCount,
      zoneCount: summary.zoneCount,
    },
    averages: {
      avgLitresPerFarmer: Math.round(averages.avgLitresPerFarmer || 0),
      avgPayoutPerFarmer: Math.round(averages.avgPayoutPerFarmer || 0),
      avgLitresPerTransaction: Math.round(averages.avgLitresPerTransaction || 0),
    },
    participation: {
      totalFarmers,
      activeFarmers,
      completionRate: Math.round(completionRate * 10) / 10,
    },
    lateDeliveries: lateDeliveries.lateCount,
    sessions: {
      morning: sessionsMap.morning || { litres: 0, farmerCount: 0, transactionCount: 0 },
      afternoon: sessionsMap.afternoon || { litres: 0, farmerCount: 0, transactionCount: 0 },
    },
    zones: data.zones || [],
    porters: data.porters || [],
  };
};

module.exports = { getDashboardKPIs };