const mongoose = require('mongoose');
const OutboundSms = require('../models/OutboundSms');
const SmsUsageLedger = require('../models/SmsUsageLedger');
const SmsProviderAccount = require('../models/SmsProviderAccount');
const SmsBalanceSnapshot = require('../models/SmsBalanceSnapshot');
const SmsRateVersion = require('../models/SmsRateVersion');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// ─── Date Helper (local time boundaries) ─────────────────
const buildDateFilter = (startDate, endDate) => {
  const filter = {};
  if (startDate) {
    const start = new Date(startDate);
    start.setHours(0, 0, 0, 0);
    filter.createdAt = { $gte: start };
  }
  if (endDate) {
    const end = new Date(endDate);
    end.setHours(23, 59, 59, 999);
    filter.createdAt = { ...filter.createdAt, $lte: end };
  }
  return filter;
};

// ─── Segment Calculator (GSM-7 / UCS-2 with extended char handling) ──
const GSM7_EXTENDED_CHARS = new Set([
  '^', '{', '}', '\\', '[', '~', ']', '|', '€'
]);

const calculateSegments = (message) => {
  if (!message || message.length === 0) return 1;

  const isUnicode = [...message].some(ch => {
    const code = ch.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7E && !GSM7_EXTENDED_CHARS.has(ch)) return false;
    if (code === 0x40 || code === 0xA3 || code === 0x24 || code === 0xA5 ||
        code === 0xE8 || code === 0xE9 || code === 0xF9 || code === 0xEC ||
        code === 0xF2 || code === 0xC7 || code === 0xD8 || code === 0xF8 ||
        code === 0xC5 || code === 0xE5 || code === 0x0394 || code === 0x5F ||
        code === 0x03A6 || code === 0x0393 || code === 0x039B || code === 0x03A9 ||
        code === 0x03A0 || code === 0x03A8 || code === 0x03A3 || code === 0x0398 ||
        code === 0x039E || code === 0x00C6 || code === 0x00E6 || code === 0x00DF ||
        code === 0x00C9 || code === 0x00C4 || code === 0x00D6 || code === 0x00D1 ||
        code === 0x00DC || code === 0x00A7 || code === 0x00BF || code === 0x00A1) {
      return false;
    }
    return true;
  });

  let maxPerSegment, maxPerMultipart;
  if (isUnicode) {
    maxPerSegment = 70;
    maxPerMultipart = 67;
  } else {
    maxPerSegment = 160;
    maxPerMultipart = 153;
  }

  let effectiveLength = 0;
  if (!isUnicode) {
    for (const ch of message) {
      if (GSM7_EXTENDED_CHARS.has(ch)) {
        effectiveLength += 2;
      } else {
        effectiveLength += 1;
      }
    }
  } else {
    effectiveLength = message.length;
  }

  if (effectiveLength <= maxPerSegment) {
    return 1;
  } else {
    return Math.ceil(effectiveLength / maxPerMultipart);
  }
};

// ─── Rate Version ────────────────────────────────────────────
const getActiveRateVersion = async (provider, asOfDate = new Date()) => {
  const rate = await SmsRateVersion.findOne({
    provider,
    effectiveFrom: { $lte: asOfDate },
    $or: [
      { effectiveTo: null },
      { effectiveTo: { $gt: asOfDate } },
    ],
    isActive: true,
  }).sort({ effectiveFrom: -1 });

  if (!rate) {
    throw new Error(`No active rate found for provider ${provider} at ${asOfDate}`);
  }
  return rate;
};

// ─── Record SMS Usage (race-safe with unique index) ─────────
const recordSmsUsage = async ({
  smsJobId,
  providerMessageId,
  provider = 'celcom',
  providerAcceptedAt = new Date(),
}) => {
  const job = await OutboundSms.findById(smsJobId);
  if (!job) {
    throw new Error(`OutboundSms job ${smsJobId} not found`);
  }

  const existing = await SmsUsageLedger.findOne({ smsJobId });
  if (existing) {
    logger.info('SMS usage already recorded (idempotent)', { smsJobId });
    return existing;
  }

  const rateVersion = await getActiveRateVersion(provider, providerAcceptedAt);
  const segments = calculateSegments(job.message);
  const unitCost = rateVersion.costPerSegment;
  const totalCost = segments * unitCost;

  const update = {
    $setOnInsert: {
      smsJobId,
      cooperativeId: job.cooperativeId,
      farmerId: job.farmerId || null,
      provider,
      type: job.type,
      segments,
      rateVersionId: rateVersion._id,
      unitCost,
      totalCost,
      currency: rateVersion.currency || 'KES',
      status: 'sent',
      providerMessageId,
      providerAcceptedAt,
      metadata: {
        jobStatus: job.status,
        jobCreatedAt: job.createdAt,
      },
    },
  };

  const options = { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true };
  const ledgerEntry = await SmsUsageLedger.findOneAndUpdate(
    { smsJobId },
    update,
    options
  );

  logger.info('SMS usage recorded', {
    smsJobId,
    cooperativeId: job.cooperativeId,
    segments,
    unitCost,
    totalCost,
  });

  return ledgerEntry;
};

// ─── Provider Balance ────────────────────────────────────────
const updateProviderBalance = async ({
  provider = 'celcom',
  balance,
  currency = 'KES',
  source = 'health_check',
}) => {
  // Normalize balance so "4116.00000" and 4116 compare equal (stops snapshot spam)
  const normalizedBalance =
    balance === null || balance === undefined || balance === ''
      ? null
      : Number(balance);
  if (normalizedBalance !== null && !Number.isFinite(normalizedBalance)) {
    throw new Error(`Invalid provider balance: ${balance}`);
  }

  const existingAccount = await SmsProviderAccount.findOne({ provider });
  const oldBalanceRaw = existingAccount ? existingAccount.currentBalance : null;
  const oldBalance =
    oldBalanceRaw === null || oldBalanceRaw === undefined
      ? null
      : Number(oldBalanceRaw);

  const account = await SmsProviderAccount.findOneAndUpdate(
    { provider },
    {
      $set: {
        currentBalance: normalizedBalance,
        currency,
        lastCheckedAt: new Date(),
        status: 'healthy',
      },
      $setOnInsert: {
        provider,
        senderId: process.env.SMS_SENDER || 'JOMUGITAGRI',
      },
    },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true }
  );

  const balancesEqual =
    oldBalance !== null &&
    normalizedBalance !== null &&
    Math.abs(oldBalance - normalizedBalance) < 0.00001;

  const shouldSnapshot =
    source === 'manual_refresh' ||
    source === 'manual' ||
    oldBalance === null ||
    !balancesEqual;

  if (shouldSnapshot && normalizedBalance !== null) {
    const snapshot = new SmsBalanceSnapshot({
      provider,
      balance: normalizedBalance,
      currency,
      checkedAt: new Date(),
      source,
      // 1-hour dedupe window for identical balance from health_check
      dedupKey: `${provider}:${normalizedBalance}:${Math.floor(Date.now() / (60 * 60 * 1000))}`,
    });
    try {
      await snapshot.save();
    } catch (err) {
      // Duplicate dedupKey → ignore (throttle spam)
      if (err.code !== 11000) throw err;
      logger.debug('Balance snapshot deduped', { provider, balance: normalizedBalance });
      return { account, balanceChanged: false };
    }

    logger.info('Provider balance snapshot created', {
      provider,
      source,
      oldBalance,
      newBalance: normalizedBalance,
      changed: !balancesEqual,
    });

    return { account, snapshot, balanceChanged: !balancesEqual };
  }

  logger.debug('Provider balance unchanged – no snapshot created', {
    provider,
    balance: normalizedBalance,
  });

  return { account, balanceChanged: false };
};

const getProviderAccount = async (provider = 'celcom') => {
  return await SmsProviderAccount.findOne({ provider });
};

// ─── Balance History (with optional date range) ─────────────
const getBalanceHistory = async (provider = 'celcom', limit = 30, startDate, endDate) => {
  const filter = { provider };
  if (startDate || endDate) {
    filter.checkedAt = {};
    if (startDate) filter.checkedAt.$gte = new Date(startDate);
    if (endDate) {
      const end = new Date(endDate);
      end.setDate(end.getDate() + 1);
      filter.checkedAt.$lt = end;
    }
  }
  return await SmsBalanceSnapshot.find(filter)
    .sort({ checkedAt: -1 })
    .limit(limit);
};

// ─── System Usage Summary ───────────────────────────────────
const getSystemUsageSummary = async (startDate, endDate) => {
  const dateFilter = buildDateFilter(startDate, endDate);

  const statuses = ['sent', 'delivered', 'failed', 'unknown'];
  const outboundMatch = { ...dateFilter, status: { $in: statuses } };
  const totalAttempted = await OutboundSms.countDocuments(outboundMatch);

  const statusCounts = await OutboundSms.aggregate([
    { $match: { ...dateFilter, status: { $in: statuses } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);

  let sent = 0, delivered = 0, failed = 0, unknown = 0;
  statusCounts.forEach(item => {
    if (item._id === 'sent') sent = item.count;
    else if (item._id === 'delivered') delivered = item.count;
    else if (item._id === 'failed') failed = item.count;
    else if (item._id === 'unknown') unknown = item.count;
  });

  const accepted = sent + delivered;

  const ledgerResult = await SmsUsageLedger.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: null,
        totalSegments: { $sum: '$segments' },
        totalCost: { $sum: '$totalCost' },
      },
    },
  ]);
  const ledgerData = ledgerResult[0] || { totalSegments: 0, totalCost: 0 };

  const total = totalAttempted > 0 ? totalAttempted : 1;
  const acceptedRate = (accepted / total) * 100;
  const failedRate = (failed / total) * 100;
  const unknownRate = (unknown / total) * 100;

  return {
    totalMessages: totalAttempted,
    acceptedMessages: accepted,
    deliveredMessages: delivered,
    failedMessages: failed,
    unknownMessages: unknown,
    acceptedRate,
    failedRate,
    unknownRate,
    totalSegments: ledgerData.totalSegments,
    totalCost: ledgerData.totalCost,
  };
};

// ─── Status Breakdown ────────────────────────────────────────
const getStatusBreakdown = async (startDate, endDate) => {
  const dateFilter = buildDateFilter(startDate, endDate);
  const result = await OutboundSms.aggregate([
    { $match: { ...dateFilter, status: { $in: ['sent', 'delivered', 'failed', 'unknown'] } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);
  const breakdown = { failed: 0, unknown: 0, sent: 0, delivered: 0 };
  result.forEach(item => {
    if (item._id === 'failed') breakdown.failed = item.count;
    else if (item._id === 'unknown') breakdown.unknown = item.count;
    else if (item._id === 'sent') breakdown.sent = item.count;
    else if (item._id === 'delivered') breakdown.delivered = item.count;
  });
  return breakdown;
};

// ─── Cooperative Usage (single) ────────────────────────────
const getCooperativeUsage = async (cooperativeId, startDate, endDate) => {
  if (!mongoose.Types.ObjectId.isValid(cooperativeId)) {
    throw new Error('Invalid cooperative ID');
  }
  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    ...buildDateFilter(startDate, endDate),
  };

  const coopOid = new mongoose.Types.ObjectId(cooperativeId);
  const dateFilter = buildDateFilter(startDate, endDate);

  const [ledgerResult, statusCounts, coop] = await Promise.all([
    SmsUsageLedger.aggregate([
      { $match: match },
      {
        $group: {
          _id: null,
          totalMessages: { $sum: 1 },
          totalSegments: { $sum: '$segments' },
          totalCost: { $sum: '$totalCost' },
        },
      },
    ]),
    OutboundSms.aggregate([
      {
        $match: {
          cooperativeId: coopOid,
          ...dateFilter,
          status: { $in: ['sent', 'delivered', 'failed', 'unknown'] },
        },
      },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]),
    Cooperative.findById(coopOid).select('name').lean(),
  ]);

  const ledgerData = ledgerResult[0] || { totalMessages: 0, totalSegments: 0, totalCost: 0 };
  const byStatus = Object.fromEntries(statusCounts.map((r) => [r._id, r.count]));
  const outboundCount =
    (byStatus.sent || 0) +
    (byStatus.delivered || 0) +
    (byStatus.failed || 0) +
    (byStatus.unknown || 0);

  return {
    cooperativeId,
    cooperativeName: coop?.name || 'Unknown',
    totalMessages: outboundCount,
    totalSegments: ledgerData.totalSegments,
    totalCost: ledgerData.totalCost,
    outboundMessages: outboundCount,
    ledgerMessages: ledgerData.totalMessages,
    failedCount: byStatus.failed || 0,
    unknownCount: byStatus.unknown || 0,
    acceptedMessages: (byStatus.sent || 0) + (byStatus.delivered || 0),
  };
};

const getCooperativeUsageByType = async (cooperativeId, startDate, endDate) => {
  if (!mongoose.Types.ObjectId.isValid(cooperativeId)) {
    throw new Error('Invalid cooperative ID');
  }
  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    ...buildDateFilter(startDate, endDate),
  };

  return await SmsUsageLedger.aggregate([
    { $match: match },
    {
      $group: {
        _id: '$type',
        totalMessages: { $sum: 1 },
        totalSegments: { $sum: '$segments' },
        totalCost: { $sum: '$totalCost' },
      },
    },
  ]);
};

// ─── Cooperative Usage Summary ─────────────────────────────
const getCooperativeUsageSummary = async (startDate, endDate) => {
  const dateFilter = buildDateFilter(startDate, endDate);

  const outboundGroups = await OutboundSms.aggregate([
    { $match: { ...dateFilter, status: { $in: ['sent', 'delivered', 'failed', 'unknown'] } } },
    {
      $group: {
        _id: '$cooperativeId',
        totalMessages: { $sum: 1 },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        unknownCount: { $sum: { $cond: [{ $eq: ['$status', 'unknown'] }, 1, 0] } },
      },
    },
  ]);

  const ledgerGroups = await SmsUsageLedger.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: '$cooperativeId',
        totalSegments: { $sum: '$segments' },
        totalCost: { $sum: '$totalCost' },
        ledgerMessages: { $sum: 1 },
      },
    },
  ]);

  const coopMap = {};
  outboundGroups.forEach(item => {
    coopMap[item._id.toString()] = {
      cooperativeId: item._id,
      totalMessages: item.totalMessages,
      failedCount: item.failedCount,
      unknownCount: item.unknownCount,
      totalSegments: 0,
      totalCost: 0,
      ledgerMessages: 0,
    };
  });

  ledgerGroups.forEach(item => {
    const id = item._id.toString();
    if (coopMap[id]) {
      coopMap[id].totalSegments = item.totalSegments;
      coopMap[id].totalCost = item.totalCost;
      coopMap[id].ledgerMessages = item.ledgerMessages;
    } else {
      coopMap[id] = {
        cooperativeId: item._id,
        totalMessages: 0,
        failedCount: 0,
        unknownCount: 0,
        totalSegments: item.totalSegments,
        totalCost: item.totalCost,
        ledgerMessages: item.ledgerMessages,
      };
    }
  });

  const coopIds = Object.keys(coopMap);
  const cooperatives = await Cooperative.find({ _id: { $in: coopIds } }).select('name');
  const nameMap = {};
  cooperatives.forEach(c => nameMap[c._id.toString()] = c.name);

  return Object.values(coopMap).map(item => ({
    cooperativeId: item.cooperativeId,
    cooperativeName: nameMap[item.cooperativeId.toString()] || 'Unknown',
    totalMessages: item.totalMessages || 0,
    totalSegments: item.totalSegments || 0,
    totalCost: item.totalCost || 0,
    failedCount: item.failedCount || 0,
    unknownCount: item.unknownCount || 0,
    ledgerMessages: item.ledgerMessages || 0,
  }));
};

// ─── Messages (optimized with $lookup) ─────────────────────
const getMessages = async ({ cooperativeId, status, type, startDate, endDate, page = 1, limit = 20 }) => {
  const match = {};
  if (cooperativeId) {
    if (!mongoose.Types.ObjectId.isValid(cooperativeId)) {
      throw new Error('Invalid cooperative ID');
    }
    match.cooperativeId = new mongoose.Types.ObjectId(cooperativeId);
  }
  if (status) match.status = status;
  if (type) match.type = type;
  Object.assign(match, buildDateFilter(startDate, endDate));

  const skip = (page - 1) * limit;

  const pipeline = [
    { $match: match },
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: limit },
    {
      $lookup: {
        from: 'cooperatives',
        localField: 'cooperativeId',
        foreignField: '_id',
        as: 'coop',
      },
    },
    { $unwind: { path: '$coop', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'smsusageledgers',
        localField: '_id',
        foreignField: 'smsJobId',
        as: 'ledger',
      },
    },
    { $unwind: { path: '$ledger', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'farmers',
        localField: 'farmerId',
        foreignField: '_id',
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        createdAt: 1,
        updatedAt: 1,
        sentAt: 1,
        phone: 1,
        message: 1,
        from: 1,
        type: 1,
        status: 1,
        priority: 1,
        deliveryRoute: 1,
        cooperativeId: 1,
        cooperativeName: '$coop.name',
        farmerId: 1,
        farmerName: '$farmer.name',
        farmerCode: '$farmer.farmer_code',
        segments: { $ifNull: ['$ledger.segments', 0] },
        totalCost: { $ifNull: ['$ledger.totalCost', 0] },
        providerMessageId: 1,
        providerResponse: 1,
        error: 1,
        errorCode: 1,
        retryCount: 1,
        metadata: 1,
      },
    },
  ];

  const [messages, total] = await Promise.all([
    OutboundSms.aggregate(pipeline),
    OutboundSms.countDocuments(match),
  ]);

  return { messages, total, page, limit };
};

/**
 * Single message with farmer + cooperative names (for detail page by id).
 */
const getMessageById = async (messageId) => {
  if (!mongoose.Types.ObjectId.isValid(messageId)) {
    throw new Error('Invalid message ID');
  }
  const oid = new mongoose.Types.ObjectId(messageId);
  const pipeline = [
    { $match: { _id: oid } },
    {
      $lookup: {
        from: 'cooperatives',
        localField: 'cooperativeId',
        foreignField: '_id',
        as: 'coop',
      },
    },
    { $unwind: { path: '$coop', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'farmers',
        localField: 'farmerId',
        foreignField: '_id',
        as: 'farmer',
      },
    },
    { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
    {
      $lookup: {
        from: 'smsusageledgers',
        localField: '_id',
        foreignField: 'smsJobId',
        as: 'ledger',
      },
    },
    { $unwind: { path: '$ledger', preserveNullAndEmptyArrays: true } },
    {
      $project: {
        _id: 1,
        createdAt: 1,
        updatedAt: 1,
        sentAt: 1,
        phone: 1,
        message: 1,
        from: 1,
        type: 1,
        status: 1,
        priority: 1,
        deliveryRoute: 1,
        cooperativeId: 1,
        cooperativeName: '$coop.name',
        farmerId: 1,
        farmerName: '$farmer.name',
        farmerCode: '$farmer.farmer_code',
        segments: { $ifNull: ['$ledger.segments', 0] },
        totalCost: { $ifNull: ['$ledger.totalCost', 0] },
        providerMessageId: 1,
        providerResponse: 1,
        error: 1,
        errorCode: 1,
        retryCount: 1,
        maxRetries: 1,
        metadata: 1,
        idempotencyKey: 1,
      },
    },
  ];
  const rows = await OutboundSms.aggregate(pipeline);
  return rows[0] || null;
};

// ─── Usage Timeline (daily aggregates, outbound + ledger) ──
const getUsageTimeline = async (startDate, endDate) => {
  const dateFilter = buildDateFilter(startDate, endDate);

  const outboundTimeline = await OutboundSms.aggregate([
    { $match: { ...dateFilter, status: { $in: ['sent', 'delivered', 'failed', 'unknown'] } } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        attemptedMessages: { $sum: 1 },
        acceptedMessages: {
          $sum: { $cond: [{ $in: ['$status', ['sent', 'delivered']] }, 1, 0] },
        },
        failedMessages: {
          $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] },
        },
        unknownMessages: {
          $sum: { $cond: [{ $eq: ['$status', 'unknown'] }, 1, 0] },
        },
      },
    },
  ]);

  const ledgerTimeline = await SmsUsageLedger.aggregate([
    { $match: dateFilter },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt' } },
        billableSegments: { $sum: '$segments' },
        cost: { $sum: '$totalCost' },
      },
    },
  ]);

  const map = new Map();
  outboundTimeline.forEach(day => {
    map.set(day._id, {
      date: day._id,
      attemptedMessages: day.attemptedMessages || 0,
      acceptedMessages: day.acceptedMessages || 0,
      failedMessages: day.failedMessages || 0,
      unknownMessages: day.unknownMessages || 0,
      billableSegments: 0,
      cost: 0,
    });
  });

  ledgerTimeline.forEach(day => {
    const existing = map.get(day._id) || {
      date: day._id,
      attemptedMessages: 0,
      acceptedMessages: 0,
      failedMessages: 0,
      unknownMessages: 0,
    };
    existing.billableSegments = day.billableSegments || 0;
    existing.cost = day.cost || 0;
    map.set(day._id, existing);
  });

  const result = Array.from(map.values());
  result.sort((a, b) => a.date.localeCompare(b.date));
  return result;
};

// ─── Reconciliation (fixed with exclusive end boundary) ─────
const getReconciliation = async (startDate, endDate) => {
  const fromDate = startDate ? new Date(startDate) : new Date(0);
  const toDateExclusive = endDate ? new Date(endDate) : new Date(Date.now() + 1);

  const [openingSnapshot, closingSnapshot, usage] = await Promise.all([
    SmsBalanceSnapshot.findOne({
      provider: 'celcom',
      checkedAt: { $lt: fromDate },
    }).sort({ checkedAt: -1 }),
    SmsBalanceSnapshot.findOne({
      provider: 'celcom',
      checkedAt: { $lt: toDateExclusive },
    }).sort({ checkedAt: -1 }),
    getSystemUsageSummary(startDate, endDate),
  ]);

  const openingBalance = openingSnapshot ? openingSnapshot.balance : 0;
  const closingBalance = closingSnapshot ? closingSnapshot.balance : 0;
  const recordedCost = usage.totalCost || 0;
  const expectedClosing = openingBalance - recordedCost;
  const difference = closingBalance - expectedClosing;

  return {
    openingBalance,
    closingBalance,
    recordedCost,
    expectedClosing,
    difference,
    provider: 'celcom',
    attemptedMessages: usage.totalMessages,
    acceptedMessages: usage.acceptedMessages,
    failedMessages: usage.failedMessages,
    unknownMessages: usage.unknownMessages,
    totalSegments: usage.totalSegments,
  };
};

// ─── Refresh Provider Balance ───────────────────────────────
const refreshProviderBalance = async (provider = 'celcom') => {
  const CelcomSmsProvider = require('../providers/CelcomSmsProvider');
  const providerInstance = new CelcomSmsProvider();
  const balanceResult = await providerInstance.checkBalance();
  const balance = balanceResult.balance;
  await updateProviderBalance({ provider, balance, source: 'manual_refresh' });
  return { balance };
};

// ─── Exports ─────────────────────────────────────────────────
module.exports = {
  calculateSegments,
  getActiveRateVersion,
  recordSmsUsage,
  updateProviderBalance,
  getProviderAccount,
  getBalanceHistory,
  getSystemUsageSummary,
  getStatusBreakdown,
  getCooperativeUsage,
  getCooperativeUsageByType,
  getCooperativeUsageSummary,
  getMessages,
  getUsageTimeline,
  getReconciliation,
  refreshProviderBalance,
  getMessageById,
};