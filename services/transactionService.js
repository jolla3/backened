const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Counter = require('../models/counter');
const Cooperative = require('../models/cooperative');
const receiptService = require('./receiptService');
const { generateHMAC, generateQRUrl } = require('./qrService');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');

// ✅ Get ACTIVE Rate Version
const getActiveRateVersion = async (cooperativeId, type = 'milk') => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const activeRate = await RateVersion.findOne({
    cooperativeId,
    type,
    effective_date: { $lte: today }
  })
    .sort({ effective_date: -1 })
    .lean();

  if (!activeRate) {
    throw new Error(`No active ${type} rate found for today`);
  }

  return {
    rate_version_id: activeRate._id,
    rate: activeRate.rate,
    effective_date: activeRate.effective_date
  };
};

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

  return `REC-${year}${month}${day}-${String(counter.sequence).padStart(6, '0')}`;
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

  return `${branch_id}-${year}${month}${day}-${String(counter.sequence).padStart(6, '0')}`;
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
  }).select('litres').session(session);

  const currentDailyTotal = transactions.reduce((sum, tx) => sum + tx.litres, 0);

  if (currentDailyTotal + litres > FRAUD_CONFIG.MAX_MILK_PER_DAY) {
    throw new Error('Daily milk limit exceeded');
  }

  return currentDailyTotal;
};

const getCooperativeByAdmin = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId });
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }
  return cooperative;
};

// ✅ MAIN: Record Milk Transaction + Generate Receipt (with fallback)
const recordMilkTransaction = async (session, data) => {
  try {
    const {
      farmer_code, litres, porter_id, zone, device_id, farmer_id,
      branch_id, device_seq_num, timestamp_local, cooperativeId
    } = data;

    // 1. Get active rate
    const rateInfo = await getActiveRateVersion(cooperativeId);
    const payout = parseFloat((litres * rateInfo.rate).toFixed(2));

    // 2. Fraud checks
    if (litres < FRAUD_CONFIG.MIN_MILK_THRESHOLD || litres > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error(`Milk amount ${litres}L exceeds limits`);
    }
    await checkDailyFraudLimit(farmer_id, litres, session);

    // 3. Generate numbers
    const receiptNum = await generateReceiptNum(session);
    const serverSeqNum = await generateServerSeqNum(session, branch_id);
    const idempotencyKey = `${device_id}-${device_seq_num}-${new Date().toISOString().split('T')[0]}`;
    const qrHash = generateHMAC(`${receiptNum}${serverSeqNum}`);

    // 4. Signature
    const signatureData = {
      farmer_code, litres, payout, rate: rateInfo.rate,
      rate_version_id: rateInfo.rate_version_id, receiptNum,
      server_seq_num: serverSeqNum, porter_id, device_id, zone, branch_id,
      timestamp: Date.now()
    };
    const digitalSignature = generateHMAC(signatureData);

    // 5. Create transaction
    const transaction = await Transaction.create([{
      device_id, receipt_num: receiptNum, qr_hash: qrHash, status: 'completed',
      device_seq_num, server_seq_num: serverSeqNum,
      timestamp_local: new Date(timestamp_local), timestamp_server: new Date(),
      digital_signature: digitalSignature, idempotency_key: idempotencyKey,
      soft_delta: 0, type: 'milk', litres, quantity: 0, payout, cost: 0,
      farmer_id, rate_version_id: rateInfo.rate_version_id, porter_id, zone,
      branch_id, cooperativeId
    }], { session });

    // 6. Update balances
    await Farmer.findByIdAndUpdate(farmer_id, { $inc: { balance: payout } }, { session });
    await Porter.findByIdAndUpdate(porter_id, {
      $inc: { 'totals.litresCollected': litres, 'totals.transactionsCount': 1 }
    }, { session });

    // ✅ 7. GENERATE RECEIPT – now passes session!
    let thermalReceipt = null;
    let receiptPreview = null;
    try {
      thermalReceipt = await receiptService.generateThermalReceipt(transaction[0]._id, session); // session added
      receiptPreview = thermalReceipt.previewText;
    } catch (receiptError) {
      logger.error('❌ Receipt generation failed, but transaction saved', {
        transactionId: transaction[0]._id,
        error: receiptError.message
      });
      // Provide a minimal placeholder receipt (as Buffer)
      const fallbackText = `RECEIPT #${receiptNum}\nMILK ${litres}L @ ${rateInfo.rate}/L = ${payout}\nTHANK YOU`;
      thermalReceipt = {
        thermalReceipt: Buffer.from(fallbackText),  // Ensure Buffer for printer
        qrImage: null,
        receiptNum,
        previewText: fallbackText
      };
      receiptPreview = fallbackText;
    }

    logger.info('✅ Milk transaction + receipt COMPLETE', {
      transactionId: transaction[0]._id, receiptNum, serverSeqNum,
      litres, payout, rate: rateInfo.rate
    });

    return {
      transaction: transaction[0],
      receiptNum,
      serverSeqNum,
      qrUrl: generateQRUrl(receiptNum),
      payout,
      farmer_code,
      thermalReceipt,
      receiptPreview
    };

  } catch (error) {
    logger.error('❌ Milk transaction failed', { error: error.message });
    throw error;
  }
};

// Sync offline transactions
const syncOfflineTransactions = async (transactions, adminId) => {
  const cooperative = await getCooperativeByAdmin(adminId);
  const operations = transactions.map(tx => ({
    updateOne: {
      filter: { idempotency_key: tx.idempotency_key },
      update: { $setOnInsert: { ...tx, cooperativeId: cooperative._id } },
      upsert: true
    }
  }));
  const results = await Transaction.bulkWrite(operations, { ordered: false });
  return { success: true, synced: results.upsertedCount, failed: 0 };
};

// ✅ FARMER HISTORY – now accepts cooperativeId (instead of adminId)
const getFarmerHistory = async (farmer_code, limit = 50, cooperativeId) => {
  try {
    const farmer = await Farmer.findOne({ farmer_code });
    if (!farmer) return { error: 'Farmer not found' };

    if (farmer.cooperativeId.toString() !== cooperativeId) {
      return { error: 'Unauthorized: Farmer does not belong to your cooperative' };
    }

    const transactions = await Transaction.find({
      farmer_id: farmer._id,
      cooperativeId
    })
    .sort({ timestamp_server: -1 })
    .limit(limit)
    .lean();

    let balance = 0, milkIncome = 0, feedCost = 0, totalLitres = 0, totalTransactions = 0;
    transactions.forEach(t => {
      if (t.type === 'milk') {
        const income = t.payout || 0;
        balance += income;
        milkIncome += income;
        totalLitres += t.litres || 0;
      } else if (t.type === 'feed') {
        const expense = t.cost || 0;
        balance -= expense;
        feedCost += expense;
      }
      totalTransactions++;
    });

    return {
      farmer: {
        id: farmer._id,
        name: farmer.name,
        code: farmer.farmer_code,
        phone: farmer.phone,
        balance,
        milkIncome,
        feedCost,
        totalLitres,
        totalTransactions,
        netProfit: milkIncome - feedCost
      },
      transactions,
      stats: {
        milkTransactions: transactions.filter(t => t.type === 'milk').length,
        feedTransactions: transactions.filter(t => t.type === 'feed').length,
        period: 'All Time'
      }
    };
  } catch (error) {
    return { error: error.message };
  }
};

module.exports = {
  recordMilkTransaction,
  syncOfflineTransactions,
  getFarmerHistory,
  getActiveRateVersion,
  generateReceiptNum,
  generateServerSeqNum,
  checkDailyFraudLimit,
  getCooperativeByAdmin
};