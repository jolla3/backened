// services/monitoring/porters.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const { buildMatch } = require('./helpers');

const getPorterRanking = async (cooperativeId, range, limit = 10) => {
  const match = buildMatch(cooperativeId, range);

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$porter_id',
        litres: { $sum: '$litres' },
        farmers: { $addToSet: '$farmer_id' },
        transactions: { $sum: 1 },
        avgLitres: { $avg: '$litres' },
        firstCollection: { $min: '$timestamp_server' },
        lastCollection: { $max: '$timestamp_server' },
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
        avgLitres: { $round: ['$avgLitres', 2] },
        zones: { $ifNull: ['$porter.zones', []] },
        efficiency: { $round: [{ $divide: ['$litres', { $size: '$farmers' }] }, 2] },
      },
    },
    { $sort: { litres: -1 } },
    { $limit: limit },
  ];

  return await Transaction.aggregate(pipeline);
};

module.exports = { getPorterRanking };