// services/cumulativeMilkService.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

/**
 * Get month boundaries for a given date (Africa/Nairobi).
 * Handles both Date objects and YYYY-MM-DD strings.
 */
const getCurrentMonthBoundaries = (referenceDate = new Date()) => {
  let year, month;

  // If referenceDate is a YYYY-MM-DD string, parse it directly.
  if (
    typeof referenceDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(referenceDate)
  ) {
    const [y, m] = referenceDate.split('-').map(Number);
    year = y;
    month = m;
  } else {
    // Otherwise treat as a Date object or convert.
    const date = new Date(referenceDate);
    if (Number.isNaN(date.getTime())) {
      throw new Error(`Invalid reference date: ${referenceDate}`);
    }
    // Use Africa/Nairobi timezone to extract year/month.
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi',
      year: 'numeric',
      month: '2-digit',
    });
    const parts = formatter.formatToParts(date);
    year = Number(parts.find(p => p.type === 'year').value);
    month = Number(parts.find(p => p.type === 'month').value);
  }

  // Build start and end dates as YYYY-MM-DD strings.
  const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
  // Last day of month using UTC to avoid timezone shifts.
  const lastDayOfMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate =
    `${year}-${String(month).padStart(2, '0')}-${String(lastDayOfMonth).padStart(2, '0')}`;

  return {
    startDate,
    endDate,
    year,
    month,
  };
};

/**
 * Cumulative milk for one farmer for the month containing asOfDate,
 * up to and including the given shift (AM or PM) on that date.
 * Uses explicit $or with date ranges – clean and safe.
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

  const farmerObjectId = new mongoose.Types.ObjectId(farmerId);
  const cooperativeObjectId = new mongoose.Types.ObjectId(cooperativeId);

  // Base match: same cooperative, farmer, milk type, completed
  let match = {
    farmer_id: farmerObjectId,
    cooperativeId: cooperativeObjectId,
    type: 'milk',
    status: 'completed',
  };

  // If asOfDate is a YYYY-MM-DD string, apply shift-based cutoff
  if (
    typeof asOfDate === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(asOfDate)
  ) {
    // AM shift: include all previous days + AM on asOfDate
    if (asOfShift === 'AM') {
      match.$or = [
        {
          collectionDate: {
            $gte: boundaries.startDate,
            $lt: asOfDate,
          },
        },
        {
          collectionDate: asOfDate,
          collectionShift: 'AM',
        },
      ];
    }
    // PM shift: include all previous days + AM & PM on asOfDate
    else if (asOfShift === 'PM') {
      match.$or = [
        {
          collectionDate: {
            $gte: boundaries.startDate,
            $lt: asOfDate,
          },
        },
        {
          collectionDate: asOfDate,
          collectionShift: { $in: ['AM', 'PM'] },
        },
      ];
    }
    // If no shift provided, default to entire month up to endDate
    else {
      match.collectionDate = {
        $gte: boundaries.startDate,
        $lte: boundaries.endDate,
      };
    }
  } else {
    // Fallback for Date objects: use full month
    match.collectionDate = {
      $gte: boundaries.startDate,
      $lte: boundaries.endDate,
    };
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
  return getCumulativeMilkForMonth(
    farmerId,
    cooperativeId,
    asOfDate,
    asOfShift
  );
};

/**
 * Bulk cumulative – for reporting, uses full month (unchanged).
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