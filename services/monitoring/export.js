// services/monitoring/export.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const { buildMatch } = require('./helpers');

const getExportData = async (cooperativeId, range, zoneFilter = null, session = 'all') => {
  const match = buildMatch(cooperativeId, range, zoneFilter, session);

  const pipeline = [
    { $match: match },
    {
      $lookup: {
        from: 'farmers',
        localField: 'farmer_id',
        foreignField: '_id',
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'porters',
        localField: 'porter_id',
        foreignField: '_id',
        as: 'porter',
      },
    },
    { $unwind: { path: '$porter', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        date: '$timestamp_server',
        receipt: '$receipt_num',
        farmer: '$farmer.name',
        farmerCode: '$farmer.farmer_code',
        zone: '$zone',
        litres: 1,
        payout: 1,
        porter: '$porter.name',
        device: '$device_id',
        hour: { $hour: '$timestamp_server' },
      },
    },
    { $sort: { date: -1 } },
  ];

  return await Transaction.aggregate(pipeline);
};

// Convert array to CSV
const toCSV = (data) => {
  if (!data || data.length === 0) return '';
  const headers = Object.keys(data[0]);
  const rows = data.map(row => headers.map(h => row[h] ?? '').join(','));
  return [headers.join(','), ...rows].join('\n');
};

module.exports = { getExportData, toCSV };