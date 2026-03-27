const TransactionService = require('./transactionService');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');

// =============================================================================
// IMPORT SERVICES (No duplication - use transactionService functions)
// =============================================================================
const {
  recordMilkTransaction: recordMilkTxFromTransactionService,
  syncOfflineTransactions: syncOfflineFromTransactionService,
  getFarmerHistory: getFarmerHistoryFromTransactionService,
  getActiveRateVersion,
  generateReceiptNum,        // ✅ Use from transactionService
  generateServerSeqNum,      // ✅ Use from transactionService  
  checkDailyFraudLimit       // ✅ Use from transactionService
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

  // Get last milk delivery
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
      thermalReceipt: result.thermalReceipt,     // ✅ Sunmi thermal print
      receiptPreview: result.receiptPreview      // ✅ Debug text
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

  // Quick signature verification
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
// 4️⃣ PORTER PERFORMANCE REPORT
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
// 6️⃣ OFFLINE SYNC
// =============================================================================
const syncOfflineTransactions = async (transactions) => {
  logger.info('🔄 POS: Syncing offline transactions', { count: transactions.length });
  return await syncOfflineFromTransactionService(transactions, null);
};

// =============================================================================
// 7️⃣ FARMER HISTORY
// =============================================================================
const getFarmerHistory = async (farmer_code, limit = 50) => {
  logger.info('📋 POS: Farmer history', { farmer_code, limit });
  return await getFarmerHistoryFromTransactionService(farmer_code, limit, null);
};

// =============================================================================
// EXPORTS (Clean - No internal utils)
// =============================================================================
module.exports = {
  // 🔥 CORE POS FUNCTIONS
  recordMilkTransaction,
  findFarmerByCode,
  verifyTransaction,
  
  // 📊 REPORTS
  getPorterPerformance,
  getDailySummary,
  getFarmerHistory,
  
  // 🌐 OFFLINE
  syncOfflineTransactions
};