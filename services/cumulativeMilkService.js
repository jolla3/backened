/**
 * Cumulative Milk Service
 * Authoritative calculation from Transaction collection (source of truth).
 * Never derived from SMS messages.
 */
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

/**
 * Get current month boundaries in Africa/Nairobi (YYYY-MM-DD strings)
 */
const getCurrentMonthBoundaries = (referenceDate = new Date()) => {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const dateString = formatter.format(referenceDate);
  const [year, month] = dateString.split('-');
  const startDate = `${year}-${month}-01`;
  const lastDayOfMonth = new Date(parseInt(year, 10), parseInt(month, 10), 0).getDate();
  const endDate = `${year}-${month}-${String(lastDayOfMonth).padStart(2, '0')}`;
  return { startDate, endDate, year: parseInt(year, 10), month: parseInt(month, 10) };
};

/**
 * Cumulative milk for one farmer for the month containing asOfDate
 * (includes all completed milk transactions in that calendar month)
 */
const getCumulativeMilkForMonth = async (farmerId, cooperativeId, asOfDate = new Date()) => {
  if (!farmerId || !cooperativeId) {
    throw new Error('farmerId and cooperativeId are required');
  }

  const boundaries = getCurrentMonthBoundaries(asOfDate);

  const result = await Transaction.aggregate([
    {
      $match: {
        farmer_id: new mongoose.Types.ObjectId(farmerId),
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        type: 'milk',
        collectionDate: {
          $gte: boundaries.startDate,
          $lte: boundaries.endDate,
        },
        status: 'completed',
      },
    },
    {
      $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        minDate: { $min: '$collectionDate' },
        maxDate: { $max: '$collectionDate' },
      },
    },
  ]);

  const data = result[0] || {
    totalLitres: 0,
    transactionCount: 0,
    minDate: null,
    maxDate: null,
  };

  logger.debug('Cumulative milk calculated', {
    farmerId: farmerId.toString(),
    month: boundaries.month,
    year: boundaries.year,
    litres: data.totalLitres,
    transactions: data.transactionCount,
  });

  return {
    litres: data.totalLitres,
    transactionCount: data.transactionCount,
    month: boundaries.month,
    year: boundaries.year,
    startDate: boundaries.startDate,
    endDate: boundaries.endDate,
    firstDelivery: data.minDate,
    lastDelivery: data.maxDate,
  };
};

/**
 * Convenience alias matching the required signature
 */
const getCumulativeMilk = async ({ farmerId, cooperativeId, session }) => {
  // session is accepted for future transactional use; aggregation currently runs outside session
  return getCumulativeMilkForMonth(farmerId, cooperativeId);
};

/**
 * Bulk cumulative for multiple farmers
 */
const getCumulativeMilkForFarmers = async (farmerIds, cooperativeId, asOfDate = new Date()) => {
  if (!Array.isArray(farmerIds) || farmerIds.length === 0) return {};
  if (!cooperativeId) throw new Error('cooperativeId is required');

  const boundaries = getCurrentMonthBoundaries(asOfDate);
  const objectIds = farmerIds.map(id => new mongoose.Types.ObjectId(id));

  const results = await Transaction.aggregate([
    {
      $match: {
        farmer_id: { $in: objectIds },
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        type: 'milk',
        collectionDate: {
          $gte: boundaries.startDate,
          $lte: boundaries.endDate,
        },
        status: 'completed',
      },
    },
    {
      $group: {
        _id: '$farmer_id',
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
      },
    },
  ]);

  const map = {};
  results.forEach(item => {
    map[item._id.toString()] = {
      litres: item.totalLitres,
      transactionCount: item.transactionCount,
      month: boundaries.month,
      year: boundaries.year,
    };
  });

  farmerIds.forEach(id => {
    const idStr = id.toString();
    if (!map[idStr]) {
      map[idStr] = {
        litres: 0,
        transactionCount: 0,
        month: boundaries.month,
        year: boundaries.year,
      };
    }
  });

  return map;
};

module.exports = {
  getCurrentMonthBoundaries,
  getCumulativeMilkForMonth,
  getCumulativeMilk,
  getCumulativeMilkForFarmers,
};