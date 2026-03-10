const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Counter = require('../models/counter');
const { generateHMAC, verifyHMAC, generateQRUrl } = require('./qrService');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');

// 1️⃣ Generate Sequential Receipt Number (Reset Per Day)
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

// 2️⃣ Generate Server Sequence Number (Branch + Daily Pattern)
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

// 3️⃣ Record milk transaction with all fixes
const recordMilkTransaction = async (session, data) => {
  try {
    const { farmer_code, litres, payout, porter_id, zone, device_id, farmer_id, rate_version_id, branch_id, device_seq_num, timestamp_local, rate } = data;

    // Fraud detection
    if (litres < FRAUD_CONFIG.MIN_MILK_THRESHOLD || litres > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error('Milk amount exceeds limits');
    }

    // Generate transaction data
    const receiptNum = await generateReceiptNum(session);
    const serverSeqNum = await generateServerSeqNum(session, branch_id);
    
    // 6️⃣ Idempotency with date
    const idempotencyKey = `${device_id}-${device_seq_num}-${new Date().toISOString().split('T')[0]}`;
    
    // 7️⃣ QR hash with more entropy
    const qrHash = generateHMAC(`${receiptNum}${serverSeqNum}`);
    
    // 10️⃣ Include rate in signature
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

// 4️⃣ Sync offline transactions with bulkWrite (Idempotent)
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

// 5️⃣ Get farmer history (query from transactions, not stored in farmer)
const getFarmerHistory = async (farmer_code, limit = 50) => {
  const farmer = await Farmer.findOne({ farmer_code }).lean();
  if (!farmer) {
    return { error: 'Farmer not found' };
  }

  const history = await Transaction.find({ farmer_id: farmer._id })
    .sort({ timestamp_server: -1 })
    .limit(limit)
    .populate('rate_version_id', 'rate')
    .lean();

  return {
    farmer: {
      code: farmer.farmer_code,
      name: farmer.name,
      balance: farmer.balance
    },
    history
  };
};

module.exports = {
  recordMilkTransaction,
  syncOfflineTransactions,
  getFarmerHistory
};