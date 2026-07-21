// services/monitoring/graphs.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const { buildMatch } = require('./helpers');

const getGraphData = async (cooperativeId, range, zoneFilter = null, session = 'all') => {
  const match = buildMatch(cooperativeId, range, zoneFilter, session);

  const pipeline = [
    { $match: match },
    {
      $facet: {
        dailyTrend: [
          {
            $group: {
              _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
              litres: { $sum: '$litres' },
              transactions: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
          { $limit: 30 },
        ],
        hourly: [
          {
            $group: {
              _id: { $hour: '$timestamp_server' },
              litres: { $sum: '$litres' },
              transactions: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
        zoneComparison: [
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
        topFarmers: [
          {
            $group: {
              _id: '$farmer_id',
              litres: { $sum: '$litres' },
              payout: { $sum: '$payout' },
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
              name: { $ifNull: ['$farmer.name', 'Unknown'] },
              code: { $ifNull: ['$farmer.farmer_code', ''] },
              litres: 1,
              payout: 1,
            },
          },
          { $sort: { litres: -1 } },
          { $limit: 10 },
        ],
        bottomFarmers: [
          {
            $group: {
              _id: '$farmer_id',
              litres: { $sum: '$litres' },
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
              name: { $ifNull: ['$farmer.name', 'Unknown'] },
              litres: 1,
            },
          },
          { $sort: { litres: 1 } },
          { $limit: 10 },
        ],
        porterComparison: [
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
              name: { $ifNull: ['$porter.name', 'Unknown'] },
              litres: 1,
              farmerCount: { $size: '$farmers' },
              transactionCount: 1,
            },
          },
          { $sort: { litres: -1 } },
        ],
        weekdayPattern: [
          {
            $group: {
              _id: { $dayOfWeek: '$timestamp_server' },
              litres: { $sum: '$litres' },
              transactions: { $sum: 1 },
            },
          },
          { $sort: { _id: 1 } },
        ],
      },
    },
  ];

  const result = await Transaction.aggregate(pipeline);
  return result[0] || {};
};

module.exports = { getGraphData };