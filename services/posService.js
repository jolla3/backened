const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Counter = require('../models/counter');
const Cooperative = require('../models/cooperative');
const { generateHMAC, generateQRUrl } = require('./qrService');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');

// --- Helper Functions ---

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

// --- Business Logic Functions ---

const findFarmerByCode = async (farmer_code) => {
  const farmer = await Farmer.findOne({ farmer_code }).lean();
  
  if (!farmer) {
    return { error: 'Farmer not found' };
  }

  const lastTx = await Transaction.findOne({ farmer_id: farmer._id })
    .sort({ timestamp_server: -1 });

  return {
    farmer: {
      code: farmer.farmer_code,
      name: farmer.name,
      phone: farmer.phone,
      branch: farmer.branch_id,
      balance: farmer.balance,
      lastDelivery: lastTx ? lastTx.timestamp_server : null
    }
  };
};

const recordMilkTransaction = async (session, data) => {
  try {
    const { farmer_code, litres, payout, porter_id, zone, device_id, farmer_id, rate_version_id, branch_id, device_seq_num, timestamp_local, rate, isOffline } = data;

    // Fraud detection (Thresholds)
    if (litres < FRAUD_CONFIG.MIN_MILK_THRESHOLD || litres > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error('Milk amount exceeds limits');
    }

    // Fraud detection (Daily Limit)
    await checkDailyFraudLimit(farmer_id, litres, session);

    // Generate transaction data
    const receiptNum = await generateReceiptNum(session);
    const serverSeqNum = await generateServerSeqNum(session, branch_id);
    
    // Idempotency with date
    const idempotencyKey = `${device_id}-${device_seq_num}-${new Date().toISOString().split('T')[0]}`;
    
    // QR hash with more entropy
    const qrHash = generateHMAC(`${receiptNum}${serverSeqNum}`);
    
    // Signature Data (Internal use only - Rate included for integrity)
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

    // Create transaction
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
        branch_id
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

    // SMS Fallback: If offline, send monthly summary to farmer (DIRECT INTEGRATION)
    if (isOffline) {
      const farmer = await Farmer.findById(farmer_id).lean();
      const coop = await Cooperative.findOne();
      
      if (farmer && coop && coop.contact && coop.contact.phone) {
        const today = new Date();
        const firstDay = new Date(today.getFullYear(), today.getMonth(), 1);
        const lastDay = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        const monthlyTransactions = await Transaction.find({
          farmer_id,
          timestamp_server: { $gte: firstDay, $lt: lastDay },
          type: 'milk'
        });

        const totalLitres = monthlyTransactions.reduce((sum, tx) => sum + tx.litres, 0);
        const totalPayout = monthlyTransactions.reduce((sum, tx) => sum + tx.payout, 0);

        const message = `Dear ${farmer.name}, this month you delivered ${totalLitres}L of milk. Expected payout: ${totalPayout}. Thank you.`;
        
        logger.info('SMS fallback sent', {
          sender: coop.contact.phone,
          recipient: farmer.phone,
          message
        });
      }
    }

    // Return data WITHOUT exposing rate
    return {
      transaction: transaction[0],
      receiptNum,
      qrUrl: generateQRUrl(receiptNum),
      payout,
      farmer_code,
      farmer_name: data.farmer_name || (await Farmer.findById(farmer_id).select('name').lean()).name,
      newBalance: data.farmer_balance + payout
    };
  } catch (error) {
    logger.error('Record milk transaction failed', { error: error.message });
    throw error;
  }
};

const verifyTransaction = async (receiptNum) => {
  const transaction = await Transaction.findOne({ receipt_num: receiptNum })
    .populate('farmer_id', 'name farmer_code')
    .populate('porter_id', 'name')
    .populate('rate_version_id', 'rate');

  if (!transaction) {
    return { valid: false, error: 'Transaction not found' };
  }

  const signatureData = {
    farmer_code: transaction.farmer_id.farmer_code,
    litres: transaction.litres,
    payout: transaction.payout,
    rate: transaction.rate_version_id.rate,
    rate_version_id: transaction.rate_version_id._id,
    receiptNum: transaction.receipt_num,
    server_seq_num: transaction.server_seq_num,
    porter_id: transaction.porter_id._id,
    device_id: transaction.device_id,
    zone: transaction.zone,
    branch_id: transaction.branch_id,
    timestamp: transaction.timestamp_server
  };

  const expectedSignature = generateHMAC(signatureData);
  const isValid = expectedSignature === transaction.digital_signature;

  return {
    valid: isValid,
    transaction: {
      receiptNum: transaction.receipt_num,
      farmer: {
        code: transaction.farmer_id.farmer_code,
        name: transaction.farmer_id.name
      },
      milk: {
        litres: transaction.litres,
        payout: transaction.payout
      },
      porter: transaction.porter_id.name,
      zone: transaction.zone,
      timestamp: transaction.timestamp_server,
      status: transaction.status
    }
  };
};

const getPorterPerformance = async (porter_id, period) => {
  const porter = await Porter.findById(porter_id);
  if (!porter) {
    return { error: 'Porter not found' };
  }

  let startDate;
  if (period === 'today') {
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'week') {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === 'month') {
    startDate = new Date();
    startDate.setDate(startDate.getDate() - 30);
  } else {
    startDate = new Date();
    startDate.setHours(0, 0, 0, 0);
  }

  const stats = await Transaction.aggregate([
    { $match: { porter_id: porter._id, timestamp_server: { $gte: startDate } } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      transactionCount: { $sum: 1 },
      totalPayout: { $sum: '$payout' }
    }}
  ]);

  return {
    porter: { id: porter._id, name: porter.name, zones: porter.zones },
    stats: stats[0] || { totalLitres: 0, transactionCount: 0, totalPayout: 0 },
    period
  };
};

const getDailySummary = async (date) => {
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

  const topPorter = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
    { $group: { _id: '$porter_id', totalLitres: { $sum: '$litres' } } },
    { $sort: { totalLitres: -1 } },
    { $limit: 1 }
  ]);

  const topZone = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: startDate, $lt: endDate } } },
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

const syncOfflineTransactions = async (transactions) => {
  try {
    const operations = transactions.map(tx => ({
      updateOne: {
        filter: { idempotency_key: tx.idempotency_key },
        update: { $setOnInsert: tx },
        upsert: true
      }
    }));

    const results = await Transaction.bulkWrite(operations, { ordered: false });
    
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

const getFarmerHistory = async (farmer_code, limit = 50) => {
  const farmer = await Farmer.findOne({ farmer_code }).lean();
  if (!farmer) {
    return { error: 'Farmer not found' };
  }

  const history = await Transaction.find({ farmer_id: farmer._id })
    .sort({ timestamp_server: -1 })
    .limit(limit)
    .lean();

  return {
    farmer: {
      code: farmer.farmer_code,
      name: farmer.name,
      balance: farmer.balance
    },
    history: history.map(tx => ({
      id: tx._id,
      receiptNum: tx.receipt_num,
      litres: tx.litres,
      payout: tx.payout,
      timestamp: tx.timestamp_server,
      status: tx.status
    }))
  };
};

module.exports = {
  recordMilkTransaction,
  getFarmerHistory,
  syncOfflineTransactions,
  verifyTransaction,
  findFarmerByCode,
  getPorterPerformance,
  getDailySummary
};