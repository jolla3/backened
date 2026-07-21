// services/monitoring/farmers.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const { buildMatch } = require('./helpers');

const getFarmerRanking = async (cooperativeId, range, limit = 20, sortBy = 'litres') => {
  const match = buildMatch(cooperativeId, range);

  const sortField = sortBy === 'payout' ? 'payout' : 'litres';

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: '$farmer_id',
        litres: { $sum: '$litres' },
        payout: { $sum: '$payout' },
        transactions: { $sum: 1 },
        avgLitres: { $avg: '$litres' },
        firstDelivery: { $min: '$timestamp_server' },
        lastDelivery: { $max: '$timestamp_server' },
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
        name: { $ifNull: ['$farmer.name', 'Unknown'] },
        code: { $ifNull: ['$farmer.farmer_code', ''] },
        zone: { $ifNull: ['$farmer.zoneName', ''] },
        litres: 1,
        payout: 1,
        transactions: 1,
        avgLitres: { $round: ['$avgLitres', 2] },
        firstDelivery: 1,
        lastDelivery: 1,
      },
    },
    { $sort: { [sortField]: -1 } },
    { $limit: limit },
  ];

  return await Transaction.aggregate(pipeline);
};

const getFarmerDetails = async (cooperativeId, farmerId, range) => {
  const match = buildMatch(cooperativeId, range, null, 'all', { farmer_id: new mongoose.Types.ObjectId(farmerId) });

  const pipeline = [
    { $match: match },
    {
      $group: {
        _id: null,
        litres: { $sum: '$litres' },
        payout: { $sum: '$payout' },
        transactions: { $sum: 1 },
        avgLitres: { $avg: '$litres' },
        firstDelivery: { $min: '$timestamp_server' },
        lastDelivery: { $max: '$timestamp_server' },
        sessions: {
          $push: {
            session: { $cond: [{ $lt: [{ $hour: '$timestamp_server' }, 12] }, 'morning', 'afternoon'] },
            litres: '$litres',
          },
        },
      },
    },
  ];

  const result = await Transaction.aggregate(pipeline);
  return result[0] || null;
};

module.exports = { getFarmerRanking, getFarmerDetails };