// services/monitoring/helpers.js
import mongoose from 'mongoose';

/**
 * Get date range based on period
 */
export const getDateRange = (period = 'today', date = null, startDate = null, endDate = null) => {
  const now = new Date();
  let start, end;

  if (period === 'custom' && startDate && endDate) {
    start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  if (date) {
    const d = new Date(date);
    start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    start.setHours(0, 0, 0, 0);
    end = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    end.setHours(23, 59, 59, 999);
    return { start, end };
  }

  switch (period) {
    case 'today':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end.setHours(23, 59, 59, 999);
      break;
    case 'yesterday':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      end.setHours(23, 59, 59, 999);
      break;
    case 'week':
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end.setHours(23, 59, 59, 999);
      break;
    case 'month':
      start = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end.setHours(23, 59, 59, 999);
      break;
    default:
      start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      start.setHours(0, 0, 0, 0);
      end = new Date(now.getFullYear(), now.getMonth(), now.getDate());
      end.setHours(23, 59, 59, 999);
  }

  return { start, end };
};

/**
 * Build match stage for monitoring queries
 */
export const buildMatch = (cooperativeId, range, zoneFilter = null, session = 'all', additional = {}) => {
  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    type: 'milk',
    timestamp_server: { $gte: range.start, $lte: range.end },
    ...additional,
  };
  if (zoneFilter) match.zone = zoneFilter;
  if (session === 'morning') {
    match.$expr = { $lt: [{ $hour: '$timestamp_server' }, 12] };
  } else if (session === 'afternoon') {
    match.$expr = { $gte: [{ $hour: '$timestamp_server' }, 12] };
  }
  return match;
};