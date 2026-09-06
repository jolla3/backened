const mongoose = require('mongoose');
const OutboundSms = require('../models/OutboundSms');
const SmsUsageLedger = require('../models/SmsUsageLedger');
const SmsProviderAccount = require('../models/SmsProviderAccount');
const SmsBalanceSnapshot = require('../models/SmsBalanceSnapshot');
const SmsRateVersion = require('../models/SmsRateVersion');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// ─── Segment Calculator ──────────────────────────────────────
const calculateSegments = (message) => {
  if (!message || message.length === 0) return 1;

  const isUnicode = [...message].some(ch => ch.charCodeAt(0) > 127);

  let maxPerSegment;
  if (isUnicode) {
    maxPerSegment = message.length <= 70 ? 70 : 67;
  } else {
    maxPerSegment = message.length <= 160 ? 160 : 153;
  }

  let segments = Math.ceil(message.length / maxPerSegment);
  if (segments < 1) segments = 1;
  return segments;
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

// ─── Record SMS Usage ────────────────────────────────────────
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

  const ledgerEntry = new SmsUsageLedger({
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
  });

  await ledgerEntry.save();
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
  const account = await SmsProviderAccount.findOneAndUpdate(
    { provider },
    {
      $set: {
        currentBalance: balance,
        currency,
        lastCheckedAt: new Date(),
        status: 'healthy',
      },
    },
    { upsert: true, new: true }
  );

  const snapshot = new SmsBalanceSnapshot({
    provider,
    balance,
    currency,
    checkedAt: new Date(),
    source,
  });
  await snapshot.save();

  logger.info('Provider balance updated', { provider, balance, source });
  return { account, snapshot };
};

const getProviderAccount = async (provider = 'celcom') => {
  return await SmsProviderAccount.findOne({ provider });
};

// ─── Balance History ────────────────────────────────────────
const getBalanceHistory = async (provider = 'celcom', limit = 30) => {
  return await SmsBalanceSnapshot.find({ provider })
    .sort({ checkedAt: -1 })
    .limit(limit);
};

// ─── System Usage (combines OutboundSms + Ledger) ──────────
const getSystemUsageSummary = async (startDate, endDate) => {
  const dateFilter = {};
  if (startDate) dateFilter.createdAt = { $gte: new Date(startDate) };
  if (endDate) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };

  // 1. Count messages from OutboundSms (exclude queued, processing)
  const statuses = ['sent', 'delivered', 'failed', 'unknown'];
  const outboundMatch = { ...dateFilter, status: { $in: statuses } };
  const totalMessages = await OutboundSms.countDocuments(outboundMatch);

  // 2. Get segments and cost from SmsUsageLedger
  const ledgerMatch = {};
  if (startDate) ledgerMatch.createdAt = { $gte: new Date(startDate) };
  if (endDate) ledgerMatch.createdAt = { ...ledgerMatch.createdAt, $lte: new Date(endDate) };
  const ledgerResult = await SmsUsageLedger.aggregate([
    { $match: ledgerMatch },
    {
      $group: {
        _id: null,
        totalSegments: { $sum: '$segments' },
        totalCost: { $sum: '$totalCost' },
      },
    },
  ]);
  const ledgerData = ledgerResult[0] || { totalSegments: 0, totalCost: 0 };

  // 3. Get status breakdown from OutboundSms (failed, unknown)
  const statusCounts = await OutboundSms.aggregate([
    { $match: { ...dateFilter, status: { $in: ['failed', 'unknown'] } } },
    {
      $group: {
        _id: '$status',
        count: { $sum: 1 },
      },
    },
  ]);
  let failedCount = 0, unknownCount = 0;
  statusCounts.forEach(item => {
    if (item._id === 'failed') failedCount = item.count;
    else if (item._id === 'unknown') unknownCount = item.count;
  });

  const successRate = totalMessages > 0 ? ((totalMessages - failedCount) / totalMessages * 100) : 0;

  return {
    totalMessages,
    totalSegments: ledgerData.totalSegments,
    totalCost: ledgerData.totalCost,
    failedCount,
    unknownCount,
    successRate,
  };
};

// ─── Status Breakdown (from OutboundSms) ────────────────────
const getStatusBreakdown = async (startDate, endDate) => {
  const dateFilter = {};
  if (startDate) dateFilter.createdAt = { $gte: new Date(startDate) };
  if (endDate) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };

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

// ─── Cooperative Usage ──────────────────────────────────────
const getCooperativeUsage = async (cooperativeId, startDate, endDate) => {
  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
  };
  if (startDate) match.createdAt = { $gte: new Date(startDate) };
  if (endDate) match.createdAt = { ...match.createdAt, $lte: new Date(endDate) };

  const result = await SmsUsageLedger.aggregate([
    { $match: match },
    {
      $group: {
        _id: null,
        totalMessages: { $sum: 1 },
        totalSegments: { $sum: '$segments' },
        totalCost: { $sum: '$totalCost' },
      },
    },
  ]);
  // Also count outbound messages for this cooperative
  const outboundCount = await OutboundSms.countDocuments({
    cooperativeId,
    ...(startDate && { createdAt: { $gte: new Date(startDate) } }),
    ...(endDate && { createdAt: { $lte: new Date(endDate) } }),
    status: { $in: ['sent', 'delivered', 'failed', 'unknown'] },
  });
  const ledgerData = result[0] || { totalMessages: 0, totalSegments: 0, totalCost: 0 };
  // Use the larger of the two counts (or combine them – we'll use outbound for message count, ledger for cost)
  // But we want to show the actual number of messages, which is better from OutboundSms.
  return {
    totalMessages: outboundCount || ledgerData.totalMessages,
    totalSegments: ledgerData.totalSegments,
    totalCost: ledgerData.totalCost,
  };
};

const getCooperativeUsageByType = async (cooperativeId, startDate, endDate) => {
  const match = {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
  };
  if (startDate) match.createdAt = { $gte: new Date(startDate) };
  if (endDate) match.createdAt = { ...match.createdAt, $lte: new Date(endDate) };

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

// ─── Cooperative Usage Summary (combines Outbound + Ledger) ──
const getCooperativeUsageSummary = async (startDate, endDate) => {
  const dateFilter = {};
  if (startDate) dateFilter.createdAt = { $gte: new Date(startDate) };
  if (endDate) dateFilter.createdAt = { ...dateFilter.createdAt, $lte: new Date(endDate) };

  // 1. Group OutboundSms by cooperative to get message counts
  const outboundGroups = await OutboundSms.aggregate([
    { $match: { ...dateFilter, status: { $in: ['sent', 'delivered', 'failed', 'unknown'] } } },
    {
      $group: {
        _id: '$cooperativeId',
        totalMessages: { $sum: 1 },
      },
    },
  ]);

  // 2. Get ledger data per cooperative (segments, cost)
  const ledgerMatch = {};
  if (startDate) ledgerMatch.createdAt = { $gte: new Date(startDate) };
  if (endDate) ledgerMatch.createdAt = { ...ledgerMatch.createdAt, $lte: new Date(endDate) };
  const ledgerGroups = await SmsUsageLedger.aggregate([
    { $match: ledgerMatch },
    {
      $group: {
        _id: '$cooperativeId',
        totalSegments: { $sum: '$segments' },
        totalCost: { $sum: '$totalCost' },
      },
    },
  ]);

  // 3. Merge
  const coopMap = {};
  outboundGroups.forEach(item => {
    coopMap[item._id.toString()] = {
      cooperativeId: item._id,
      totalMessages: item.totalMessages,
      totalSegments: 0,
      totalCost: 0,
    };
  });
  ledgerGroups.forEach(item => {
    const id = item._id.toString();
    if (coopMap[id]) {
      coopMap[id].totalSegments = item.totalSegments;
      coopMap[id].totalCost = item.totalCost;
    } else {
      // If ledger exists but no outbound (shouldn't happen), still add
      coopMap[id] = {
        cooperativeId: item._id,
        totalMessages: 0,
        totalSegments: item.totalSegments,
        totalCost: item.totalCost,
      };
    }
  });

  // 4. Populate cooperative names
  const coopIds = Object.keys(coopMap);
  const cooperatives = await Cooperative.find({ _id: { $in: coopIds } }).select('name');
  const nameMap = {};
  cooperatives.forEach(c => nameMap[c._id.toString()] = c.name);

  const result = Object.values(coopMap).map(item => ({
    cooperativeId: item.cooperativeId,
    cooperativeName: nameMap[item.cooperativeId.toString()] || 'Unknown',
    totalMessages: item.totalMessages || 0,
    totalSegments: item.totalSegments || 0,
    totalCost: item.totalCost || 0,
  }));

  return result;
};

// ─── Messages (with pagination & filters) ──────────────────
const getMessages = async ({ cooperativeId, status, type, startDate, endDate, page = 1, limit = 20 }) => {
  const query = {};
  if (cooperativeId) query.cooperativeId = cooperativeId;
  if (status) query.status = status;
  if (type) query.type = type;
  if (startDate) query.createdAt = { $gte: new Date(startDate) };
  if (endDate) query.createdAt = { ...query.createdAt, $lte: new Date(endDate) };

  const skip = (page - 1) * limit;
  const [messages, total] = await Promise.all([
    OutboundSms.find(query)
      .populate('cooperativeId', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    OutboundSms.countDocuments(query),
  ]);

  // Enrich with ledger info
  const enriched = await Promise.all(messages.map(async (msg) => {
    const ledger = await SmsUsageLedger.findOne({ smsJobId: msg._id });
    return {
      _id: msg._id,
      createdAt: msg.createdAt,
      phone: msg.phone,
      type: msg.type,
      status: msg.status,
      cooperativeName: msg.cooperativeId?.name || 'Unknown',
      farmerId: msg.farmerId,
      segments: ledger?.segments || 0,
      totalCost: ledger?.totalCost || 0,
      providerMessageId: msg.providerMessageId,
    };
  }));

  return { messages: enriched, total, page, limit };
};

// ─── Reconciliation ──────────────────────────────────────────
const getReconciliation = async (startDate, endDate) => {
  const account = await getProviderAccount('celcom');
  const providerBalance = account ? account.currentBalance : null;

  const usage = await getSystemUsageSummary(startDate, endDate);
  const recordedCost = usage.totalCost || 0;

  // Get opening balance (snapshot before startDate or earliest)
  const fromDate = startDate ? new Date(startDate) : new Date();
  const startSnapshot = await SmsBalanceSnapshot.findOne({
    provider: 'celcom',
    checkedAt: { $lte: fromDate },
  }).sort({ checkedAt: -1 });
  const openingBalance = startSnapshot ? startSnapshot.balance : providerBalance;

  let projectedBalance = null;
  let difference = null;
  if (openingBalance !== null && providerBalance !== null) {
    projectedBalance = openingBalance - recordedCost;
    difference = providerBalance - projectedBalance;
  }

  return {
    providerBalance,
    recordedCost,
    openingBalance,
    projectedBalance,
    difference,
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
  getReconciliation,
  refreshProviderBalance,
};