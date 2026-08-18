/**
 * Cumulative Milk Service – authoritative calculation from Transaction collection.
 * Now accepts asOfDate and asOfShift to compute month‑to‑date inclusive of the current shift.
 */
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

/**
 * Get month boundaries for a given date (Africa/Nairobi).
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
 * Cumulative milk for one farmer for the month containing asOfDate,
 * up to and including the given shift (AM or PM) on that date.
 * If asOfShift is not provided, it includes all transactions up to the end of asOfDate.
 */
const getCumulativeMilkForMonth = async (
  farmerId,
  cooperativeId,
  asOfDate = new Date(),
  asOfShift = null
) => {
  if (!farmerId || !cooperativeId) {
    throw new Error('farmerId and cooperativeId are required');
  }

  const boundaries = getCurrentMonthBoundaries(asOfDate);

  // Base match: same month, completed milk transactions
  const match = {
    farmer_id: new mongoose.Types.ObjectId(farmerId),
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    type: 'milk',
    status: 'completed',
    collectionDate: {
      $gte: boundaries.startDate,
      $lte: boundaries.endDate,
    },
  };

  // Apply shift-based cutoff if provided
  if (asOfShift) {
    // If shift is AM: include all before asOfDate, plus AM on asOfDate
    // If shift is PM: include all before asOfDate, plus AM and PM on asOfDate
    if (asOfShift === 'AM') {
      match.$or = [
        { collectionDate: { $lt: asOfDate } },
        {
          collectionDate: asOfDate,
          collectionShift: 'AM',
        },
      ];
    } else if (asOfShift === 'PM') {
      match.$or = [
        { collectionDate: { $lt: asOfDate } },
        {
          collectionDate: asOfDate,
          collectionShift: { $in: ['AM', 'PM'] },
        },
      ];
    }
    // Note: for invalid shift, we default to including everything up to endDate (same as no shift)
  }

  const result = await Transaction.aggregate([
    { $match: match },
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
    cooperativeId: cooperativeId.toString(),
    month: boundaries.month,
    year: boundaries.year,
    asOfDate,
    asOfShift,
    litres: data.totalLitres,
    transactions: data.transactionCount,
  });

  return {
    litres: Number(data.totalLitres || 0),
    transactionCount: Number(data.transactionCount || 0),
    month: boundaries.month,
    year: boundaries.year,
    startDate: boundaries.startDate,
    endDate: boundaries.endDate,
    firstDelivery: data.minDate,
    lastDelivery: data.maxDate,
  };
};

/**
 * Public wrapper – now accepts asOfDate and asOfShift.
 */
const getCumulativeMilk = async ({
  farmerId,
  cooperativeId,
  session,
  asOfDate = new Date(),
  asOfShift = null,
}) => {
  // session is accepted for future transactional use; aggregation currently runs outside session
  return getCumulativeMilkForMonth(
    farmerId,
    cooperativeId,
    asOfDate,
    asOfShift
  );
};

/**
 * Bulk cumulative for multiple farmers (kept for completeness)
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