// services/monitoring/zones.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Zone = require('../../models/zone');
const { buildMatch } = require('./helpers');

const getZoneAnalytics = async (cooperativeId, range, zoneFilter = null) => {
  const match = buildMatch(cooperativeId, range, zoneFilter);

  // Get zone expectations
  const zoneExpectations = {};
  const zones = await Zone.find({ cooperativeId, isActive: true }).lean();
  zones.forEach(z => { zoneExpectations[z.name] = { expectedFarmers: z.expectedFarmers || 0, expectedDailyLitres: z.expectedDailyLitres || 0 }; });

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$zone',
        totalLitres: { $sum: '$litres' },
        totalPayout: { $sum: '$payout' },
        transactionCount: { $sum: 1 },
        farmers: { $addToSet: '$farmer_id' },
        sessions: {
          $push: {
            session: { $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, 'morning', 'afternoon'] },
            litres: '$litres',
          },
        },
      },
    },
    {
      $project: {
        zone: '$_id',
        totalLitres: 1,
        totalPayout: 1,
        transactionCount: 1,
        farmerCount: { $size: '$farmers' },
        avgLitresPerFarmer: { $cond: [{ $gt: [{ $size: '$farmers' }, 0] }, { $divide: ['$totalLitres', { $size: '$farmers' }] }, 0] },
        avgLitresPerTransaction: { $cond: [{ $gt: ['$transactionCount', 0] }, { $divide: ['$totalLitres', '$transactionCount'] }, 0] },
        sessions: 1,
      },
    },
    { $sort: { totalLitres: -1 } },
  ];

  const results = await Transaction.aggregate(pipeline);

  return results.map(z => {
    const morning = z.sessions.filter(s => s.session === 'morning');
    const afternoon = z.sessions.filter(s => s.session === 'afternoon');
    const morningLitres = morning.reduce((s, m) => s + m.litres, 0);
    const afternoonLitres = afternoon.reduce((s, m) => s + m.litres, 0);

    const expected = zoneExpectations[z.zone] || { expectedFarmers: 0, expectedDailyLitres: 0 };

    return {
      zone: z.zone || 'Unassigned',
      totalLitres: Math.round(z.totalLitres),
      totalPayout: Math.round(z.totalPayout),
      transactionCount: z.transactionCount,
      farmerCount: z.farmerCount,
      avgLitresPerFarmer: Math.round(z.avgLitresPerFarmer),
      avgLitresPerTransaction: Math.round(z.avgLitresPerTransaction),
      morning: { litres: Math.round(morningLitres) },
      afternoon: { litres: Math.round(afternoonLitres) },
      expectedFarmers: expected.expectedFarmers,
      expectedDailyLitres: expected.expectedDailyLitres,
      completionRate: expected.expectedFarmers > 0 ? Math.round((z.farmerCount / expected.expectedFarmers) * 100) : 0,
    };
  });
};

module.exports = { getZoneAnalytics };