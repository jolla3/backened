// services/posService.js
const mongoose = require('mongoose');
const crypto = require('crypto');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Ledger = require('../models/ledger');
const logger = require('../utils/logger');

// ── HMAC helper ──────────────────────────────────────────
function generateHMAC(data) {
  const secret = process.env.HMAC_SECRET || 'default_secret_change_me';
  const str = Object.values(data).join(':');
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

// ── Date Utilities ──────────────────────────────────────
const DATE_UTILS = {
  getStartOfDay: (date = new Date()) => {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  getEndOfDay: (date = new Date()) => {
    const d = new Date(date);
    d.setHours(23, 59, 59, 999);
    return d;
  },
  getStartOfWeek: (date = new Date()) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    d.setDate(diff);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  getStartOfMonth: (date = new Date()) => {
    const d = new Date(date);
    d.setDate(1);
    d.setHours(0, 0, 0, 0);
    return d;
  },
  getDateRange: (period, referenceDate = new Date()) => {
    const start = new Date(referenceDate);
    const end = new Date(referenceDate);
    switch (period) {
      case 'today':
        return { start: DATE_UTILS.getStartOfDay(start), end: DATE_UTILS.getEndOfDay(end) };
      case 'yesterday': {
        const y = new Date(referenceDate);
        y.setDate(y.getDate() - 1);
        return { start: DATE_UTILS.getStartOfDay(y), end: DATE_UTILS.getEndOfDay(y) };
      }
      case 'week':
        return { start: DATE_UTILS.getStartOfWeek(start), end: new Date() };
      case 'month':
        return { start: DATE_UTILS.getStartOfMonth(start), end: new Date() };
      case 'last7days': {
        const s = new Date(referenceDate);
        s.setDate(s.getDate() - 7);
        return { start: DATE_UTILS.getStartOfDay(s), end: new Date() };
      }
      case 'last30days': {
        const s = new Date(referenceDate);
        s.setDate(s.getDate() - 30);
        return { start: DATE_UTILS.getStartOfDay(s), end: new Date() };
      }
      default:
        return { start: DATE_UTILS.getStartOfDay(start), end: new Date() };
    }
  },
  formatDate: (date) => date.toISOString().split('T')[0],
  formatDateTime: (date) => date.toISOString().replace('T', ' ').slice(0, 19),
};

// ── Analytics Engine ────────────────────────────────────
class POSAnalytics {
  constructor({ cooperativeId = null } = {}) {
    this.cooperativeId = cooperativeId;
    this.baseMatch = { type: 'milk' };
    if (this.cooperativeId) {
      // Ensure it's a valid ObjectId
      try {
        this.baseMatch.cooperativeId = new mongoose.Types.ObjectId(this.cooperativeId);
      } catch (err) {
        logger.warn('Invalid cooperativeId provided to POSAnalytics', { cooperativeId: this.cooperativeId });
        // Fallback: try to use as string, but MongoDB will fail if invalid
        this.baseMatch.cooperativeId = this.cooperativeId;
      }
    }
  }

  // ─── 1. PORTER PERFORMANCE ────────────────────────────
  // ✅ ZONE-RELATED: collects zones in stats, groups by zone for breakdown
  async getPorterPerformance(porterId, period = 'today') {
    const porter = await Porter.findById(porterId).lean();
    if (!porter) throw new Error('Porter not found');

    const { start, end } = DATE_UTILS.getDateRange(period);
    const match = {
      ...this.baseMatch,
      porter_id: new mongoose.Types.ObjectId(porterId),
      timestamp_server: { $gte: start, $lte: end },
    };

    const [stats] = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalLitres: { $sum: '$litres' },
          transactionCount: { $sum: 1 },
          avgLitres: { $avg: '$litres' },
          uniqueFarmers: { $addToSet: '$farmer_id' },
          zones: { $addToSet: '$zone' }, // ✅ ZONE
        },
      },
      {
        $project: {
          totalLitres: 1,
          transactionCount: 1,
          avgLitres: { $round: ['$avgLitres', 2] },
          uniqueFarmersCount: { $size: '$uniqueFarmers' },
          zones: 1,
        },
      },
    ]);

    const trend = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
          litres: { $sum: '$litres' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
    ]);

    const zoneStats = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$zone', // ✅ ZONE
          litres: { $sum: '$litres' },
          count: { $sum: 1 },
        },
      },
      { $sort: { litres: -1 } },
    ]);

    const defaultStats = {
      totalLitres: 0,
      transactionCount: 0,
      avgLitres: 0,
      uniqueFarmersCount: 0,
      zones: [],
    };

    return {
      porter: {
        id: porter._id,
        name: porter.name,
        zones: porter.zones || [],
      },
      period,
      dateRange: { start: DATE_UTILS.formatDateTime(start), end: DATE_UTILS.formatDateTime(end) },
      stats: stats || defaultStats,
      trend,
      zoneBreakdown: zoneStats,
      efficiency: stats
        ? {
            litresPerTransaction: parseFloat((stats.totalLitres / stats.transactionCount).toFixed(2)),
          }
        : null,
    };
  }

  // ─── 2. DAILY SUMMARY ──────────────────────────────────
 async getDailySummary(date = new Date()) {
  // Parse date as UTC to avoid timezone issues
  const target = DATE_UTILS.getStartOfDay(date);
  const nextDay = new Date(target);
  nextDay.setUTCDate(nextDay.getUTCDate() + 1);

  const match = {
    ...this.baseMatch,
    timestamp_server: { $gte: target, $lt: nextDay },
  };

  // 1. Summary aggregation
  const [daily] = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        activeFarmers: { $addToSet: '$farmer_id' },
        zones: { $addToSet: '$zone' },
      },
    },
    {
      $project: {
        totalLitres: 1,
        transactionCount: 1,
        activeFarmersCount: { $size: '$activeFarmers' },
        zones: 1,
      },
    },
  ]);

  // 2. Previous day comparison
  const prevDay = new Date(target);
  prevDay.setUTCDate(prevDay.getUTCDate() - 1);
  const prevMatch = {
    ...this.baseMatch,
    timestamp_server: { $gte: prevDay, $lt: target },
  };
  const [prev] = await Transaction.aggregate([
    { $match: prevMatch },
    { $group: { _id: null, totalLitres: { $sum: '$litres' }, count: { $sum: 1 } } },
  ]);

  // 3. Hourly distribution
  const hourly = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $hour: { date: '$timestamp_server', timezone: 'UTC' } },
        litres: { $sum: '$litres' },
        count: { $sum: 1 },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  // 4. Top zones
  const topZones = await Transaction.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$zone',
        litres: { $sum: '$litres' },
        count: { $sum: 1 },
      },
    },
    { $sort: { litres: -1 } },
    { $limit: 3 },
  ]);

  // 5. 🔥 NEW: Fetch actual transactions for the date
  const txDocs = await Transaction.find(match)
    .sort({ timestamp_server: -1 })
    .limit(100) // limit to avoid huge payloads
    .populate('farmer_id', 'name farmer_code')
    .populate('porter_id', 'name')
    .lean();

  const formattedTransactions = txDocs.map(t => ({
    _id: t._id,
    receiptNum: t.receipt_num,
    farmerName: t.farmer_id?.name || 'Unknown',
    farmerCode: t.farmer_id?.farmer_code || '',
    porterName: t.porter_id?.name || 'Direct',
    litres: t.litres,
    amount: t.payout || (t.litres * (t.rate || 55)),
    status: t.status || 'recorded',
    timestamp: t.timestamp_server,
    createdAt: t.createdAt || t.timestamp_server,
  }));

  // 6. Build response
  const defaultDaily = {
    totalLitres: 0,
    transactionCount: 0,
    activeFarmersCount: 0,
    zones: [],
  };

  const prevLitres = prev?.totalLitres || 0;
  const change = daily?.totalLitres - prevLitres;
  const changePercent = prevLitres ? ((change / prevLitres) * 100).toFixed(1) : null;

  return {
    date: DATE_UTILS.formatDate(target),
    summary: daily || defaultDaily,
    comparison: {
      previousDay: {
        litres: prevLitres,
        change,
        changePercent: changePercent ? parseFloat(changePercent) : null,
      },
    },
    hourlyDistribution: hourly.map(h => ({ hour: h._id, litres: h.litres, count: h.count })),
    topZones: topZones.map(z => ({ zone: z._id || 'Unassigned', litres: z.litres, count: z.count })),
    // 🔥 ADD THIS LINE
    transactions: formattedTransactions,
  };
}

  // ─── 3. FARMER HISTORY ──────────────────────────────────
  // ✅ ZONE-RELATED: returns zone per transaction
  async getFarmerHistory(farmerCode, limit = 50, offset = 0, cooperativeId = null) {
    const farmer = await Farmer.findOne({ farmer_code: farmerCode }).lean();
    if (!farmer) throw new Error('Farmer not found');
    if (cooperativeId && farmer.cooperativeId.toString() !== cooperativeId.toString()) {
      throw new Error('Farmer does not belong to this cooperative');
    }

    const lastLedger = await Ledger.findOne({
      cooperativeId: farmer.cooperativeId,
      farmerId: farmer._id,
    })
      .sort({ timestamp: -1 })
      .lean();

    const currentBalance = lastLedger ? lastLedger.runningBalance : 0;

    const ledgerSummary = await Ledger.aggregate([
      {
        $match: {
          cooperativeId: farmer.cooperativeId,
          farmerId: farmer._id,
        },
      },
      {
        $group: {
          _id: null,
          milkIncome: {
            $sum: { $cond: [{ $eq: ['$type', 'MILK_CREDIT'] }, '$amount', 0] },
          },
          feedCost: {
            $sum: { $cond: [{ $eq: ['$type', 'FEED_DEBIT'] }, '$amount', 0] },
          },
          settlementDeductions: {
            $sum: { $cond: [{ $eq: ['$type', 'SETTLEMENT_DEBIT'] }, '$amount', 0] },
          },
        },
      },
    ]);

    const summary = ledgerSummary[0] || { milkIncome: 0, feedCost: 0, settlementDeductions: 0 };
    const netProfit = summary.milkIncome - summary.feedCost - summary.settlementDeductions;

    const match = {
      ...this.baseMatch,
      farmer_id: farmer._id,
    };

    const docs = await Transaction.find(match)
      .sort({ timestamp_server: -1 })
      .skip(offset)
      .limit(limit)
      .populate('porter_id', 'name')
      .lean();

    const transactions = docs.map(doc => ({
      id: doc._id,
      receiptNum: doc.receipt_num,
      litres: doc.litres,
      timestamp: doc.timestamp_server,
      status: doc.status,
      porter: doc.porter_id?.name || 'Direct',
      zone: doc.zone || '', // ✅ ZONE
    }));

    const monthlyTrend = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            year: { $year: '$timestamp_server' },
            month: { $month: '$timestamp_server' },
          },
          litres: { $sum: '$litres' },
          count: { $sum: 1 },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    return {
      farmer: {
        id: farmer._id,
        code: farmer.farmer_code,
        name: farmer.name,
        phone: farmer.phone,
        balance: currentBalance,
      },
      summary: {
        totalLitres: await Transaction.countDocuments(match),
        transactionCount: await Transaction.countDocuments(match),
        firstTransaction: await Transaction.findOne(match).sort({ timestamp_server: 1 }).select('timestamp_server'),
        lastTransaction: await Transaction.findOne(match).sort({ timestamp_server: -1 }).select('timestamp_server'),
        milkIncome: summary.milkIncome,
        feedCost: summary.feedCost,
        settlementDeductions: summary.settlementDeductions,
        netProfit,
      },
      transactions,
      pagination: {
        limit,
        offset,
        hasMore: transactions.length === limit,
      },
      monthlyTrend,
    };
  }

  // ─── 4. FARMERS COLLECTED BY PORTER ──────────────────────
  // ✅ ZONE-RELATED: returns porter zones
  async getFarmersCollectedByPorter(porterId, startDate, endDate) {
    const porter = await Porter.findById(porterId).lean();
    if (!porter) throw new Error('Porter not found');

    const start = startDate ? new Date(startDate) : DATE_UTILS.getStartOfDay(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000));
    const end = endDate ? new Date(endDate) : new Date();

    const match = {
      ...this.baseMatch,
      porter_id: porter._id,
      timestamp_server: { $gte: start, $lte: end },
    };

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$farmer_id',
          totalLitres: { $sum: '$litres' },
          transactionCount: { $sum: 1 },
          lastTransaction: { $max: '$timestamp_server' },
          firstTransaction: { $min: '$timestamp_server' },
        },
      },
      {
        $lookup: {
          from: 'farmers',
          localField: '_id',
          foreignField: '_id',
          as: 'farmerInfo',
        },
      },
      { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          farmer: {
            id: '$farmerInfo._id',
            code: '$farmerInfo.farmer_code',
            name: '$farmerInfo.name',
            phone: '$farmerInfo.phone',
            location: '$farmerInfo.location',
          },
          totalLitres: 1,
          transactionCount: 1,
          lastTransaction: 1,
          firstTransaction: 1,
          avgLitresPerTx: { $divide: ['$totalLitres', '$transactionCount'] },
        },
      },
      { $sort: { totalLitres: -1 } },
    ];

    const farmers = await Transaction.aggregate(pipeline);

    const summary = farmers.reduce(
      (acc, f) => {
        acc.totalFarmers += 1;
        acc.totalLitres += f.totalLitres;
        acc.totalTransactions += f.transactionCount;
        return acc;
      },
      { totalFarmers: 0, totalLitres: 0, totalTransactions: 0 }
    );

    return {
      porter: {
        id: porter._id,
        name: porter.name,
        zones: porter.zones || [], // ✅ ZONE
      },
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      farmers,
      summary,
    };
  }

  // ─── 5. CHART DATA ───────────────────────────────────────
  // Does not directly touch zones.
  async getPerformanceChartData(params) {
    const { entity, id, period = 'day', metric = 'litres', startDate, endDate } = params;

    if (!['porter', 'farmer', 'overall'].includes(entity)) {
      throw new Error('Invalid entity. Must be porter, farmer, or overall');
    }

    const match = { ...this.baseMatch };
    if (entity === 'porter' && id) {
      match.porter_id = new mongoose.Types.ObjectId(id);
    } else if (entity === 'farmer' && id) {
      match.farmer_id = new mongoose.Types.ObjectId(id);
    }

    const start = startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const end = endDate ? new Date(endDate) : new Date();
    match.timestamp_server = { $gte: start, $lte: end };

    let dateGroup;
    switch (period) {
      case 'hour':
        dateGroup = {
          year: { $year: '$timestamp_server' },
          month: { $month: '$timestamp_server' },
          day: { $dayOfMonth: '$timestamp_server' },
          hour: { $hour: '$timestamp_server' },
        };
        break;
      case 'day':
        dateGroup = {
          year: { $year: '$timestamp_server' },
          month: { $month: '$timestamp_server' },
          day: { $dayOfMonth: '$timestamp_server' },
        };
        break;
      case 'week':
        dateGroup = {
          year: { $year: '$timestamp_server' },
          week: { $week: '$timestamp_server' },
        };
        break;
      case 'month':
        dateGroup = {
          year: { $year: '$timestamp_server' },
          month: { $month: '$timestamp_server' },
        };
        break;
      default:
        throw new Error('Period must be hour, day, week, or month');
    }

    let valueField;
    switch (metric) {
      case 'litres':
        valueField = '$litres';
        break;
      case 'transactions':
        valueField = 1;
        break;
      case 'payout':
        valueField = '$litres';
        break;
      default:
        throw new Error('Metric must be litres or transactions');
    }

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: dateGroup,
          total: { $sum: valueField },
        },
      },
      { $sort: { '_id': 1 } },
    ];

    const results = await Transaction.aggregate(pipeline);

    const chartData = results.map((item) => {
      let date;
      const { year, month, day, hour, week } = item._id;
      if (period === 'hour') {
        date = new Date(year, month - 1, day, hour);
      } else if (period === 'day') {
        date = new Date(year, month - 1, day);
      } else if (period === 'week') {
        date = new Date(year, 0, 1 + (week - 1) * 7);
      } else {
        date = new Date(year, month - 1, 1);
      }
      return {
        date: date.toISOString(),
        value: item.total,
      };
    });

    const smoothed = chartData.map((point, index, array) => {
      if (index < 2 || index > array.length - 3) return point;
      const avg = (array[index - 1].value + point.value + array[index + 1].value) / 3;
      return { ...point, smoothed: parseFloat(avg.toFixed(2)) };
    });

    return {
      entity,
      id: id || null,
      period,
      metric: metric === 'payout' ? 'litres' : metric,
      dateRange: { start: start.toISOString(), end: end.toISOString() },
      data: smoothed,
    };
  }

  // ─── 6. TOP FARMERS ─────────────────────────────────────
  // Does not directly touch zones.
  async getTopFarmers({ date = null, limit = 10, sortBy = 'litres' } = {}) {
    const match = { ...this.baseMatch };
    if (date) {
      const start = DATE_UTILS.getStartOfDay(date);
      const end = new Date(start);
      end.setDate(end.getDate() + 1);
      match.timestamp_server = { $gte: start, $lt: end };
    }

    const pipeline = [
      { $match: match },
      {
        $group: {
          _id: '$farmer_id',
          totalLitres: { $sum: '$litres' },
          transactionCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'farmers',
          localField: '_id',
          foreignField: '_id',
          as: 'farmerInfo',
        },
      },
      { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          farmer: {
            code: '$farmerInfo.farmer_code',
            name: '$farmerInfo.name',
          },
          totalLitres: 1,
          transactionCount: 1,
          avgLitres: { $divide: ['$totalLitres', '$transactionCount'] },
        },
      },
      { $sort: { totalLitres: -1 } },
      { $limit: limit },
    ];

    return await Transaction.aggregate(pipeline);
  }

  // ─── 7. ZONE PERFORMANCE ─────────────────────────────────
  // ✅ ZONE-RELATED: groups by zone
  async getZonePerformance({ dateRange = null } = {}) {
    const match = { ...this.baseMatch };
    if (dateRange) {
      match.timestamp_server = {
        $gte: dateRange.start,
        $lte: dateRange.end,
      };
    }

    const zones = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$zone', // ✅ ZONE
          totalLitres: { $sum: '$litres' },
          transactionCount: { $sum: 1 },
          uniqueFarmers: { $addToSet: '$farmer_id' },
        },
      },
      {
        $project: {
          zone: '$_id',
          totalLitres: 1,
          transactionCount: 1,
          farmerCount: { $size: '$uniqueFarmers' },
          avgLitresPerTx: { $divide: ['$totalLitres', '$transactionCount'] },
        },
      },
      { $sort: { totalLitres: -1 } },
    ]);

    return zones;
  }

  // ─── 8. PORTER RANKING ──────────────────────────────────
  // Does not directly touch zones.
  async getPorterRanking({ period = 'today', limit = 5 } = {}) {
    const { start, end } = DATE_UTILS.getDateRange(period);
    const match = {
      ...this.baseMatch,
      timestamp_server: { $gte: start, $lte: end },
    };

    const ranking = await Transaction.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$porter_id',
          totalLitres: { $sum: '$litres' },
          transactionCount: { $sum: 1 },
        },
      },
      {
        $lookup: {
          from: 'porters',
          localField: '_id',
          foreignField: '_id',
          as: 'porterInfo',
        },
      },
      { $unwind: { path: '$porterInfo', preserveNullAndEmptyArrays: false } },
      {
        $project: {
          porter: {
            id: '$porterInfo._id',
            name: '$porterInfo.name',
          },
          totalLitres: 1,
          transactionCount: 1,
          efficiency: { $divide: ['$totalLitres', '$transactionCount'] },
        },
      },
      { $sort: { totalLitres: -1 } },
      { $limit: limit },
    ]);

    return {
      period,
      dateRange: { start: DATE_UTILS.formatDateTime(start), end: DATE_UTILS.formatDateTime(end) },
      ranking,
    };
  }
}

// ─── Factory ───────────────────────────────────────────
const createAnalytics = (cooperativeId = null) => new POSAnalytics({ cooperativeId });

// ─── Original functions (unchanged) ───────────────────
const TransactionService = require('./transactionService');
const {
  recordMilkTransaction: origRecord,
  syncOfflineTransactions: origSync,
} = TransactionService;

// ─── Legacy functions (some touch zones) ──────────────
module.exports = {
  recordMilkTransaction: origRecord,
  syncOfflineTransactions: origSync,

  // --- Enhanced functions (porter‑friendly) ---

  getFarmerHistory: async (farmerCode, limit, offset, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getFarmerHistory(farmerCode, limit, offset, cooperativeId);
  },

  // ✅ ZONE-RELATED
  getPorterPerformance: async (porterId, period, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getPorterPerformance(porterId, period);
  },

  // ✅ ZONE-RELATED
  getDailySummary: async (date, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getDailySummary(date);
  },

  // ✅ ZONE-RELATED
  getFarmersCollectedByPorter: async (porterId, startDate, endDate, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getFarmersCollectedByPorter(porterId, startDate, endDate);
  },

  getPerformanceChartData: async (params, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getPerformanceChartData(params);
  },

  getTopFarmers: async (params, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getTopFarmers(params);
  },

  // ✅ ZONE-RELATED
  getZonePerformance: async (params, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getZonePerformance(params);
  },

  getPorterRanking: async (params, cooperativeId) => {
    const analytics = createAnalytics(cooperativeId);
    return analytics.getPorterRanking(params);
  },

  // ── Legacy (unchanged) ──

  findFarmerByCode: async (farmerCode) => {
    const farmer = await Farmer.findOne({ farmer_code: farmerCode }).lean();
    if (!farmer) return { error: 'Farmer not found' };
    const lastTx = await Transaction.findOne({ farmer_id: farmer._id, type: 'milk' })
      .sort({ timestamp_server: -1 })
      .select('timestamp_server')
      .lean();
    return {
      farmer: {
        id: farmer._id,
        code: farmer.farmer_code,
        name: farmer.name,
        phone: farmer.phone || null,
        branch: farmer.branch_id || null,
        balance: parseFloat(farmer.balance || 0),
        cooperativeId: farmer.cooperativeId,
        lastDelivery: lastTx?.timestamp_server ? lastTx.timestamp_server.toISOString() : null,
      },
    };
  },

  // ✅ ZONE-RELATED
  verifyTransaction: async (receiptNum, cooperativeId = null) => {
    const transaction = await Transaction.findOne({ receipt_num: receiptNum })
      .populate('farmer_id', 'name farmer_code')
      .populate('porter_id', 'name')
      .lean();
    if (!transaction) {
      return { valid: false, error: 'Transaction not found' };
    }

    if (cooperativeId && transaction.cooperativeId?.toString() !== cooperativeId.toString()) {
      return { valid: false, error: 'Transaction does not belong to your cooperative' };
    }

    return {
      valid: true,
      transaction: {
        receiptNum: transaction.receipt_num,
        serverSeqNum: transaction.server_seq_num,
        farmer: {
          code: transaction.farmer_id?.farmer_code || '',
          name: transaction.farmer_id?.name || '',
        },
        milk: {
          litres: transaction.litres,
        },
        porter: transaction.porter_id?.name || 'Direct Delivery',
        zone: transaction.zone || '', // ✅ ZONE
        timestamp: transaction.timestamp_server.toISOString(),
        status: transaction.status,
      },
    };
  },
};