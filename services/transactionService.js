const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Counter = require('../models/counter');
const Cooperative = require('../models/cooperative');
const { generateHMAC, generateQRUrl } = require('./qrService');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');

// Generate Sequential Receipt Number (Reset Per Day)
const generateReceiptNum = async (session) => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const dateKey = `${year}${month}${day}`;
  
  const counter = await Counter.findOneAndUpdate(
    { _id: `milk_receipt_seq_${dateKey}` },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );
  
  const sequence = counter.sequence;
  const seqStr = String(sequence).padStart(6, '0');
  
  return `REC-${year}${month}${day}-${seqStr}`;
};

// Generate Server Sequence Number (Branch + Daily Pattern)
const generateServerSeqNum = async (session, branch_id) => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  const counter = await Counter.findOneAndUpdate(
    { _id: `server_tx_seq_${branch_id}_${year}${month}${day}` },
    { $inc: { sequence: 1 } },
    { new: true, upsert: true, session }
  );
  
  const sequence = counter.sequence;
  const seqStr = String(sequence).padStart(6, '0');
  
  return `${branch_id}-${year}${month}${day}-${seqStr}`;
};

// Check Daily Fraud Limit
const checkDailyFraudLimit = async (farmer_id, litres, session) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const transactions = await Transaction.find({
    farmer_id,
    timestamp_server: { $gte: today, $lt: tomorrow },
    type: 'milk'
  })
  .select('litres')
  .session(session);

  const currentDailyTotal = transactions.reduce((sum, tx) => sum + tx.litres, 0);
  
  if (currentDailyTotal + litres > FRAUD_CONFIG.MAX_MILK_PER_DAY) {
    throw new Error('Daily milk limit exceeded');
  }
  
  return currentDailyTotal;
};

// ✅ HELPER: Get Cooperative by Admin ID (CONSISTENT)
const getCooperativeByAdmin = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative) {
    throw new Error('Cooperative not found for this admin');
  }
  return cooperative;
};

// Record Milk Transaction with Cooperative Scoping
const recordMilkTransaction = async (session, data) => {
  try {
    const { farmer_code, litres, payout, porter_id, zone, device_id, farmer_id, rate_version_id, branch_id, device_seq_num, timestamp_local, rate, cooperativeId } = data;

    // Fraud detection
    if (litres < FRAUD_CONFIG.MIN_MILK_THRESHOLD || litres > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error('Milk amount exceeds limits');
    }

    // Check daily fraud limit
    await checkDailyFraudLimit(farmer_id, litres, session);

    // Generate transaction data
    const receiptNum = await generateReceiptNum(session);
    const serverSeqNum = await generateServerSeqNum(session, branch_id);
    
    // Idempotency with date
    const idempotencyKey = `${device_id}-${device_seq_num}-${new Date().toISOString().split('T')[0]}`;
    
    // QR hash with more entropy
    const qrHash = generateHMAC(`${receiptNum}${serverSeqNum}`);
    
    // Signature Data
    const signatureData = {
      farmer_code,
      litres,
      payout,
      rate: rate.rate,
      rate_version_id,
      receiptNum,
      server_seq_num: serverSeqNum,
      porter_id,
      device_id,
      zone,
      branch_id,
      timestamp: Date.now()
    };
    
    const digitalSignature = generateHMAC(signatureData);

    // Create transaction with cooperativeId
    const transaction = await Transaction.create(
      [{
        device_id,
        receipt_num: receiptNum,
        qr_hash: qrHash,
        status: 'completed',
        device_seq_num,
        server_seq_num: serverSeqNum,
        timestamp_local: new Date(timestamp_local),
        timestamp_server: new Date(),
        digital_signature: digitalSignature,
        idempotency_key: idempotencyKey,
        soft_delta: 0,
        type: 'milk',
        litres,
        quantity: 0,
        payout,
        cost: 0,
        farmer_id,
        rate_version_id,
        porter_id,
        zone,
        branch_id,
        cooperativeId
      }],
      { session }
    );

    // Atomic balance update
    await Farmer.findByIdAndUpdate(
      farmer_id,
      { $inc: { balance: payout } },
      { session }
    );

    // Update porter stats
    await Porter.findByIdAndUpdate(
      porter_id,
      {
        $inc: {
          'totals.litresCollected': litres,
          'totals.transactionsCount': 1
        }
      },
      { session }
    );

    logger.info('Transaction recorded', { 
      transactionId: transaction[0]._id, 
      receiptNum,
      cooperativeId 
    });

    return {
      transaction: transaction[0],
      receiptNum,
      qrUrl: generateQRUrl(receiptNum),
      digitalSignature,
      serverSeqNum
    };
  } catch (error) {
    logger.error('Record milk transaction failed', { error: error.message });
    throw error;
  }
};

// Sync Offline Transactions with Cooperative Scoping - FIXED
const syncOfflineTransactions = async (transactions, adminId) => {
  try {
    // ✅ FIXED: Use helper
    const cooperative = await getCooperativeByAdmin(adminId);

    const operations = transactions.map(tx => ({
      updateOne: {
        filter: { idempotency_key: tx.idempotency_key },
        update: { $setOnInsert: { ...tx, cooperativeId: cooperative._id } },
        upsert: true
      }
    }));

    const results = await Transaction.bulkWrite(operations, { ordered: false });
    
    logger.info('Offline transactions synced', { 
      synced: results.upsertedCount, 
      cooperativeId: cooperative._id 
    });
    
    return {
      success: true,
      synced: results.upsertedCount,
      failed: 0
    };
  } catch (error) {
    logger.error('Sync offline transactions failed', { error: error.message });
    return {
      success: false,
      synced: 0,
      failed: transactions.length,
      error: error.message
    };
  }
};

// Get Farmer History with Cooperative Scoping - FIXED
const getFarmerHistory = async (farmer_code, limit = 50, adminId) => {
  const farmer = await Farmer.findOne({ farmer_code });
  if (!farmer) {
    return { error: 'Farmer not found' };
  }

  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);
  
  if (farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Farmer does not belong to your cooperative');
  }

  const now = new Date();
  const firstDayOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  // ✅ CALCULATE ACTUAL BALANCE FROM TRANSACTIONS
  const balanceSummary = await Transaction.aggregate([
    {
      $match: {
        farmer_id: farmer._id,
        cooperativeId: cooperative._id,
        timestamp_server: { $gte: firstDayOfMonth },
        status: 'completed'
      }
    },
    {
      $group: {
        _id: '$type',
        totalAmount: { $sum: { $cond: [{ $eq: ['$type', 'milk'] }, '$payout', '$cost'] } }
      }
    }
  ]);

  const milkIncome = balanceSummary.find(b => b._id === 'milk')?.totalAmount || 0;
  const feedCost = balanceSummary.find(b => b._id === 'feed')?.totalAmount || 0;
  const calculatedBalance = milkIncome - feedCost;

  const history = await Transaction.find({ 
    farmer_id: farmer._id,
    cooperativeId: cooperative._id 
  })
  .sort({ timestamp_server: -1 })
  .limit(limit)
  .populate('rate_version_id', 'rate')
  .lean();

  return {
    farmer: {
      code: farmer.farmer_code,
      name: farmer.name,
      balance: calculatedBalance,
      milkIncome,
      feedCost
    },
    history,
    balanceDetails: {
      milkIncome,
      feedCost,
      calculatedBalance
    }
  };
};

// Get All Transactions for Admin's Cooperative - FIXED
const getAllTransactions = async (adminId, filters = {}) => {
  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);

  const query = { cooperativeId: cooperative._id };
  
  if (filters.farmerId) query.farmer_id = filters.farmerId;
  if (filters.porterId) query.porter_id = filters.porterId;
  if (filters.type) query.type = filters.type;
  if (filters.startDate) query.timestamp_server = { ...query.timestamp_server, $gte: filters.startDate };
  if (filters.endDate) query.timestamp_server = { ...query.timestamp_server, $lte: filters.endDate };

  const transactions = await Transaction.find(query)
    .sort({ timestamp_server: -1 });

  logger.info('Transactions retrieved', { count: transactions.length, cooperativeId: cooperative._id });
  return transactions;
};

// Get Transaction by ID with Cooperative Scoping - FIXED
const getTransaction = async (transactionId, adminId) => {
  const transaction = await Transaction.findById(transactionId);
  
  if (!transaction) {
    throw new Error('Transaction not found');
  }

  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);
  
  if (transaction.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Transaction does not belong to your cooperative');
  }

  return transaction;
};

// Get Transaction Summary for Admin's Cooperative - FIXED
const getTransactionSummary = async (adminId, period = 'month') => {
  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);

  let startDate;
  const now = new Date();

  if (period === 'today') {
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === 'month') {
    startDate = new Date();
    startDate.setDate(1);
    startDate.setHours(0, 0, 0, 0);
  } else {
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
  }

  const summary = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 },
      totalCost: { $sum: '$cost' }
    }}
  ]);

  return {
    period,
    summary: summary[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0, totalCost: 0 },
    cooperativeId: cooperative._id
  };
};

// Get Transactions by Farmer (Scoped to Cooperative) - FIXED
const getTransactionsByFarmer = async (farmerId, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);
  
  if (farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Farmer does not belong to your cooperative');
  }

  const transactions = await Transaction.find({ 
    farmer_id: farmerId,
    cooperativeId: cooperative._id 
  })
  .sort({ timestamp_server: -1 });

  return transactions;
};

// Get Transactions by Porter (Scoped to Cooperative) - FIXED
const getTransactionsByPorter = async (porterId, adminId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);
  
  if (porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Porter does not belong to your cooperative');
  }

  const transactions = await Transaction.find({ 
    porter_id: porterId,
    cooperativeId: cooperative._id 
  })
  .sort({ timestamp_server: -1 });

  return transactions;
};

// Get Daily Summary for Admin's Cooperative - FIXED
const getDailySummary = async (adminId, date = new Date().toISOString().split('T')[0]) => {
  // ✅ FIXED: Use helper
  const cooperative = await getCooperativeByAdmin(adminId);

  const startDate = new Date(date);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date(startDate);
  endDate.setDate(endDate.getDate() + 1);

  const summary = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id, type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      transactionCount: { $sum: 1 },
      activeFarmers: { $addToSet: '$farmer_id' }
    }}
  ]);

  const topPorter = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id, type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
    { $group: { _id: '$porter_id', totalLitres: { $sum: '$litres' } } },
    { $sort: { totalLitres: -1 } },
    { $limit: 1 }
  ]);

  const topZone = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id, type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
    { $group: { _id: '$zone', totalLitres: { $sum: '$litres' } } },
    { $sort: { totalLitres: -1 } },
    { $limit: 1 }
  ]);

  return {
    date,
    summary: {
      totalLitres: summary[0]?.totalLitres || 0,
      transactionCount: summary[0]?.transactionCount || 0,
      activeFarmers: summary[0]?.activeFarmers?.length || 0
    },
    topPorter: topPorter[0] ? { id: topPorter[0]._id, litres: topPorter[0].totalLitres } : null,
    topZone: topZone[0] ? { zone: topZone[0]._id, litres: topZone[0].totalLitres } : null
  };
};

module.exports = {
  recordMilkTransaction,
  syncOfflineTransactions,
  getFarmerHistory,
  getAllTransactions,
  getTransaction,
  getTransactionSummary,
  getTransactionsByFarmer,
  getTransactionsByPorter,
  getDailySummary,
  generateReceiptNum,
  generateServerSeqNum,
  checkDailyFraudLimit,
  getCooperativeByAdmin // ✅ Export helper if needed elsewhere
};