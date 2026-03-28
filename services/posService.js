const mongoose = require('mongoose');
const crypto = require('crypto');
const TransactionService = require('./transactionService');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');

// Helper: generate HMAC for transaction verification
function generateHMAC(data) {
  const secret = process.env.HMAC_SECRET || 'default_secret_change_me';
  const str = Object.values(data).join(':');
  return crypto.createHmac('sha256', secret).update(str).digest('hex');
}

// =============================================================================
// IMPORT SERVICES (No duplication – use transactionService functions)
// =============================================================================
const {
  recordMilkTransaction: recordMilkTxFromTransactionService,
  syncOfflineTransactions: syncOfflineFromTransactionService,
  getFarmerHistory: getFarmerHistoryFromTransactionService,
  getActiveRateVersion,
  generateReceiptNum,
  generateServerSeqNum,
  checkDailyFraudLimit
} = TransactionService;

// =============================================================================
// 1️⃣ FIND FARMER BY CODE (POS Entry Point)
// =============================================================================
const findFarmerByCode = async (farmer_code) => {
  logger.info('🔍 POS: Finding farmer', { farmer_code });

  const farmer = await Farmer.findOne({ farmer_code }).lean();
  if (!farmer) {
    return { error: 'Farmer not found' };
  }

  const lastTx = await Transaction.findOne({ 
    farmer_id: farmer._id,
    type: 'milk'
  })
  .sort({ timestamp_server: -1 })
  .select('timestamp_server')
  .lean();

  logger.info('✅ POS: Farmer found', { 
    farmer_id: farmer._id,
    code: farmer.farmer_code,
    cooperativeId: farmer.cooperativeId 
  });

  return {
    farmer: {
      id: farmer._id,
      code: farmer.farmer_code,
      name: farmer.name,
      phone: farmer.phone || null,
      branch: farmer.branch_id || null,
      balance: parseFloat(farmer.balance || 0),
      cooperativeId: farmer.cooperativeId,
      lastDelivery: lastTx?.timestamp_server ? lastTx.timestamp_server.toISOString() : null
    }
  };
};

// =============================================================================
// 2️⃣ RECORD MILK TRANSACTION (POS CORE - No Rate Needed)
// =============================================================================
const recordMilkTransaction = async (session, data) => {
  try {
    const { 
      farmer_code, litres, porter_id, zone, device_id, 
      branch_id, device_seq_num, timestamp_local, cooperativeId 
    } = data;

    logger.info('🚀 POS: Milk transaction START', {
      farmer_code, litres: parseFloat(litres), porter_id, zone, branch_id, cooperativeId
    });

    // 1️⃣ VALIDATE FARMER & COOPERATIVE
    const farmer = await Farmer.findOne({ farmer_code });
    if (!farmer) {
      throw new Error('Farmer not found');
    }
    if (farmer.cooperativeId.toString() !== cooperativeId) {
      throw new Error('Farmer does not belong to this cooperative');
    }

    // 2️⃣ QUICK FRAUD CHECK (before heavy transactionService call)
    const litresNum = parseFloat(litres);
    if (litresNum < FRAUD_CONFIG.MIN_MILK_THRESHOLD || litresNum > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error(`Milk quantity ${litresNum}L exceeds limits`);
    }

    // 3️⃣ DELEGATE TO transactionService (handles rate, payout, receiptNum, receipts)
    const result = await recordMilkTxFromTransactionService(session, {
      farmer_code,
      litres: litresNum,
      porter_id,
      zone,
      device_id,
      farmer_id: farmer._id,
      branch_id,
      device_seq_num,
      timestamp_local: timestamp_local || new Date(),
      cooperativeId
    });

    // 4️⃣ GET UPDATED FARMER BALANCE
    const farmerDetails = await Farmer.findById(farmer._id)
      .select('name balance')
      .lean();

    logger.info('✅ POS: Milk transaction SUCCESS', {
      receiptNum: result.receiptNum,
      serverSeqNum: result.serverSeqNum,
      payout: result.payout,
      newBalance: farmerDetails.balance + result.payout
    });

    return {
      transaction: result.transaction,
      receiptNum: result.receiptNum,
      serverSeqNum: result.serverSeqNum,
      qrUrl: result.qrUrl,
      payout: result.payout,
      farmer_code,
      farmer_name: farmerDetails.name,
      newBalance: parseFloat(farmerDetails.balance) + result.payout,
      thermalReceipt: result.thermalReceipt,
      receiptPreview: result.receiptPreview
    };

  } catch (error) {
    logger.error('❌ POS: Milk transaction FAILED', { error: error.message, data });
    throw error;
  }
};

// =============================================================================
// 3️⃣ VERIFY TRANSACTION (QR/Receipt Check)
// =============================================================================
const verifyTransaction = async (receiptNum) => {
  logger.info('🔍 POS: Verifying transaction', { receiptNum });

  const transaction = await Transaction.findOne({ receipt_num: receiptNum })
    .populate('farmer_id', 'name farmer_code')
    .populate('porter_id', 'name')
    .lean();

  if (!transaction) {
    return { valid: false, error: 'Transaction not found' };
  }

  // Signature verification
  const signatureData = {
    receiptNum: transaction.receipt_num,
    farmer_code: transaction.farmer_id.farmer_code,
    litres: transaction.litres,
    payout: transaction.payout,
    timestamp: transaction.timestamp_server.getTime()
  };
  const expectedSignature = generateHMAC(signatureData);
  const isValid = expectedSignature === transaction.digital_signature;

  logger.info('✅ POS: Transaction verified', { receiptNum, valid: isValid });

  return {
    valid: isValid,
    transaction: {
      receiptNum: transaction.receipt_num,
      serverSeqNum: transaction.server_seq_num,
      farmer: {
        code: transaction.farmer_id.farmer_code,
        name: transaction.farmer_id.name
      },
      milk: {
        litres: transaction.litres,
        payout: transaction.payout
      },
      porter: transaction.porter_id?.name || 'Direct Delivery',
      zone: transaction.zone,
      timestamp: transaction.timestamp_server.toISOString(),
      status: transaction.status
    }
  };
};

// =============================================================================
// 4️⃣ PORTER PERFORMANCE REPORT (Basic stats)
// =============================================================================
const getPorterPerformance = async (porter_id, period = 'today') => {
  logger.info('📊 POS: Porter performance', { porter_id, period });

  const porter = await Porter.findById(porter_id).lean();
  if (!porter) {
    return { error: 'Porter not found' };
  }

  let startDate = new Date();
  if (period === 'today') {
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === 'month') {
    startDate.setDate(startDate.getDate() - 30);
  }

  const stats = await Transaction.aggregate([
    { 
      $match: { 
        porter_id: porter._id, 
        timestamp_server: { $gte: startDate },
        type: 'milk'
      } 
    },
    { 
      $group: {
        _id: null,
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        totalPayout: { $sum: '$payout' }
      }
    }
  ]);

  return {
    porter: { 
      id: porter._id, 
      name: porter.name, 
      zones: porter.zones || [] 
    },
    stats: stats[0] || { 
      totalLitres: 0, 
      transactionCount: 0, 
      totalPayout: 0 
    },
    period
  };
};

// =============================================================================
// 5️⃣ DAILY SUMMARY REPORT
// =============================================================================
const getDailySummary = async (date = new Date().toISOString().split('T')[0]) => {
  logger.info('📈 POS: Daily summary', { date });

  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  const summary = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      transactionCount: { $sum: 1 },
      activeFarmers: { $addToSet: '$farmer_id' }
    }}
  ]);

  return {
    date,
    summary: {
      totalLitres: summary[0]?.totalLitres || 0,
      transactionCount: summary[0]?.transactionCount || 0,
      activeFarmers: summary[0]?.activeFarmers?.length || 0
    }
  };
};

// =============================================================================
// 6️⃣ FARMER HISTORY (Now accepts cooperativeId)
// =============================================================================
const getFarmerHistory = async (farmer_code, limit = 50, cooperativeId) => {
  logger.info('📋 POS: Farmer history', { farmer_code, limit, cooperativeId });
  return await getFarmerHistoryFromTransactionService(farmer_code, limit, cooperativeId);
};

// =============================================================================
// 7️⃣ OFFLINE SYNC
// =============================================================================
const syncOfflineTransactions = async (transactions) => {
  logger.info('🔄 POS: Syncing offline transactions', { count: transactions.length });
  return await syncOfflineFromTransactionService(transactions, null);
};

// =============================================================================
// 🆕 8️⃣ GET FARMERS COLLECTED BY A PORTER (with details and totals)
// =============================================================================
const getFarmersCollectedByPorter = async (porter_id, startDate, endDate) => {
  logger.info('👨‍🌾 POS: Farmers collected by porter', { porter_id, startDate, endDate });

  // Validate porter exists
  const porter = await Porter.findById(porter_id).lean();
  if (!porter) {
    return { error: 'Porter not found' };
  }

  // Build date filter
  let dateFilter = {};
  if (startDate && endDate) {
    dateFilter = {
      $gte: new Date(startDate),
      $lt: new Date(endDate)
    };
  } else if (startDate) {
    dateFilter = { $gte: new Date(startDate) };
  } else if (endDate) {
    dateFilter = { $lt: new Date(endDate) };
  } else {
    // Default to last 30 days if no dates provided
    const defaultStart = new Date();
    defaultStart.setDate(defaultStart.getDate() - 30);
    dateFilter = { $gte: defaultStart };
  }

  // Aggregate transactions for this porter
  const pipeline = [
    {
      $match: {
        porter_id: porter._id,
        type: 'milk',
        timestamp_server: dateFilter
      }
    },
    {
      $group: {
        _id: '$farmer_id',
        totalLitres: { $sum: '$litres' },
        transactionCount: { $sum: 1 },
        totalPayout: { $sum: '$payout' },
        lastTransaction: { $max: '$timestamp_server' },
        firstTransaction: { $min: '$timestamp_server' }
      }
    },
    {
      $lookup: {
        from: 'farmers',
        localField: '_id',
        foreignField: '_id',
        as: 'farmerInfo'
      }
    },
    { $unwind: { path: '$farmerInfo', preserveNullAndEmptyArrays: false } },
    {
      $project: {
        farmer: {
          id: '$farmerInfo._id',
          code: '$farmerInfo.farmer_code',
          name: '$farmerInfo.name',
          phone: '$farmerInfo.phone',
          branch: '$farmerInfo.branch_id',
          location: '$farmerInfo.location',
          balance: '$farmerInfo.balance'
        },
        totalLitres: 1,
        transactionCount: 1,
        totalPayout: 1,
        lastTransaction: 1,
        firstTransaction: 1
      }
    },
    { $sort: { totalLitres: -1 } } // Most litres first
  ];

  const farmers = await Transaction.aggregate(pipeline);

  return {
    porter: { id: porter._id, name: porter.name, zones: porter.zones || [] },
    dateRange: {
      start: dateFilter.$gte ? dateFilter.$gte.toISOString() : null,
      end: dateFilter.$lt ? dateFilter.$lt.toISOString() : null
    },
    farmers: farmers,
    summary: {
      totalFarmers: farmers.length,
      totalLitres: farmers.reduce((sum, f) => sum + f.totalLitres, 0),
      totalPayout: farmers.reduce((sum, f) => sum + f.totalPayout, 0),
      totalTransactions: farmers.reduce((sum, f) => sum + f.transactionCount, 0)
    }
  };
};

// =============================================================================
// 🆕 9️⃣ CHART DATA ENDPOINT – Returns time‑series for graphs
// =============================================================================
const getPerformanceChartData = async (params) => {
  const { entity, id, period = 'day', metric = 'litres', startDate, endDate } = params;

  logger.info('📊 POS: Chart data request', { entity, id, period, metric, startDate, endDate });

  // Validate entity
  if (!['porter', 'farmer', 'overall'].includes(entity)) {
    throw new Error('Invalid entity. Must be porter, farmer, or overall');
  }

  // Build match stage
  const match = { type: 'milk' };
  if (entity === 'porter' && id) {
    match.porter_id = new mongoose.Types.ObjectId(id);  // ✅ fixed: use 'new'
  } else if (entity === 'farmer' && id) {
    match.farmer_id = new mongoose.Types.ObjectId(id);  // ✅ fixed: use 'new'
  }

  // Date range
  let start = startDate ? new Date(startDate) : new Date();
  let end = endDate ? new Date(endDate) : new Date();
  if (!startDate) start.setDate(start.getDate() - 30); // default last 30 days
  if (!endDate) end.setHours(23, 59, 59, 999);

  match.timestamp_server = { $gte: start, $lte: end };

  // Determine grouping interval
  let dateGroup;
  if (period === 'day') {
    dateGroup = {
      year: { $year: '$timestamp_server' },
      month: { $month: '$timestamp_server' },
      day: { $dayOfMonth: '$timestamp_server' }
    };
  } else if (period === 'week') {
    dateGroup = {
      year: { $year: '$timestamp_server' },
      week: { $week: '$timestamp_server' }
    };
  } else if (period === 'month') {
    dateGroup = {
      year: { $year: '$timestamp_server' },
      month: { $month: '$timestamp_server' }
    };
  } else {
    throw new Error('Period must be day, week, or month');
  }

  // Build group stage based on metric
  let groupFields = { _id: dateGroup };
  if (metric === 'litres') {
    groupFields.total = { $sum: '$litres' };
  } else if (metric === 'transactions') {
    groupFields.total = { $sum: 1 };
  } else if (metric === 'payout') {
    groupFields.total = { $sum: '$payout' };
  } else {
    throw new Error('Metric must be litres, transactions, or payout');
  }

  const pipeline = [
    { $match: match },
    {
      $group: groupFields
    },
    { $sort: { '_id': 1 } }
  ];

  const results = await Transaction.aggregate(pipeline);

  // Format results into chart-friendly array
  const chartData = results.map(item => {
    let date;
    if (period === 'day') {
      date = new Date(item._id.year, item._id.month - 1, item._id.day);
    } else if (period === 'week') {
      // Approximate: first day of the week
      date = new Date(item._id.year, 0, 1 + (item._id.week - 1) * 7);
    } else {
      date = new Date(item._id.year, item._id.month - 1, 1);
    }
    return {
      date: date.toISOString().split('T')[0],
      value: item.total
    };
  });

  return {
    entity,
    id: id || null,
    period,
    metric,
    dateRange: { start: start.toISOString(), end: end.toISOString() },
    data: chartData
  };
};

// =============================================================================
// EXPORTS (All functions, clean and no duplication)
// =============================================================================
module.exports = {
  // Core POS
  recordMilkTransaction,
  findFarmerByCode,
  verifyTransaction,
  // Reports
  getPorterPerformance,
  getDailySummary,
  getFarmerHistory,
  getFarmersCollectedByPorter,   // 🆕
  getPerformanceChartData,        // 🆕
  // Offline
  syncOfflineTransactions
};