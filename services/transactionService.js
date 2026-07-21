// services/transactionService.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Counter = require('../models/counter');
const Ledger = require('../models/ledger');
const Zone = require('../models/zone'); // ✅ ADDED: Zone model for zone lookup
const receiptService = require('./receiptService');
const qrService = require('./qrService');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');
const { updateFarmerBalance } = require('../utils/ledgerUtils');

// ── Helpers ─────────────────────────────────────────────

const getActiveRateVersion = async (cooperativeId, type = 'milk') => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const activeRate = await RateVersion.findOne({
    cooperativeId,
    type,
    effective_date: { $lte: today },
  }).sort({ effective_date: -1 }).lean();

  if (!activeRate) {
    throw new Error(`No active ${type} rate found for today`);
  }
  return {
    rate_version_id: activeRate._id,
    rate: activeRate.rate,
    effective_date: activeRate.effective_date,
  };
};

const generateReceiptNum = async () => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const dateKey = `milk_receipt_seq_${year}${month}${day}`;

  const counter = await Counter.findOneAndUpdate(
    { _id: dateKey },
    { $inc: { sequence: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return `REC-${year}${month}${day}-${String(counter.sequence).padStart(6, '0')}`;
};

const generateServerSeqNum = async (branch_id) => {
  const safeBranch = branch_id || 'DEFAULT';
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const key = `server_tx_seq_${safeBranch}_${year}${month}${day}`;

  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { sequence: 1 } },
    { returnDocument: 'after', upsert: true }
  );
  return `${safeBranch}-${year}${month}${day}-${String(counter.sequence).padStart(6, '0')}`;
};

const checkDailyFraudLimit = async (farmer_id, litres) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const tomorrow = new Date(today);
  tomorrow.setDate(tomorrow.getDate() + 1);

  const transactions = await Transaction.find({
    farmer_id,
    timestamp_server: { $gte: today, $lt: tomorrow },
    type: 'milk',
  }).select('litres');

  const currentTotal = transactions.reduce((sum, tx) => sum + tx.litres, 0);
  if (currentTotal + litres > FRAUD_CONFIG.MAX_MILK_PER_DAY) {
    throw new Error(`Daily milk limit exceeded. Max ${FRAUD_CONFIG.MAX_MILK_PER_DAY}L per day`);
  }
  return currentTotal;
};

// ── MAIN: Record milk transaction ──────────────────────
const recordMilkTransaction = async (data) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const {
      farmer_code,
      litres,
      porter_id,
      zone, // This is the zone ID from the dropdown
      device_id,
      farmer_id,
      branch_id,
      device_seq_num,
      timestamp_local,
      cooperativeId,
      userId,
    } = data;

    if (!userId) {
      throw new Error('User ID (userId) is required for ledger entry');
    }

    // ── 1. Validation ──────────────────────────────────
    const litresNum = parseFloat(litres);
    if (isNaN(litresNum) || litresNum < FRAUD_CONFIG.MIN_MILK_THRESHOLD) {
      throw new Error(`Milk quantity must be at least ${FRAUD_CONFIG.MIN_MILK_THRESHOLD}L`);
    }
    if (litresNum > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error(`Milk quantity cannot exceed ${FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION}L per transaction`);
    }

    const rateInfo = await getActiveRateVersion(cooperativeId);
    const payout = parseFloat((litresNum * rateInfo.rate).toFixed(2));

    await checkDailyFraudLimit(farmer_id, litresNum);

    // ── 2. Generate numbers ────────────────────────────
    const receiptNum = await generateReceiptNum();
    const serverSeqNum = await generateServerSeqNum(branch_id);

    // ── 3. Build transaction ────────────────────────────
    const now = Date.now();
    const random = Math.random().toString(36).substring(2, 10);
    const finalKey = `${device_id}-${now}-${random}`;

    const qrHash = qrService.generateHMAC(`${receiptNum}${serverSeqNum}`);
    const signatureData = {
      farmer_code,
      litres: litresNum,
      payout,
      rate: rateInfo.rate,
      rate_version_id: rateInfo.rate_version_id,
      receiptNum,
      server_seq_num: serverSeqNum,
      porter_id,
      device_id,
      zone,
      branch_id,
      timestamp: Date.now(),
    };
    const digitalSignature = qrService.generateHMAC(signatureData);

    // ── 4. Get farmer ──────────────────────────────────────
    const farmer = await Farmer.findById(farmer_id).session(session);
    if (!farmer) {
      throw new Error('Farmer not found');
    }
    const previousBalance = farmer.currentBalance || 0;

    // ── 5. Resolve zone: zone is the ID from dropdown ──
    let zoneId = null;
    let zoneName = '';

    if (zone) {
      // zone is the ID from the dropdown
      const zoneDoc = await Zone.findById(zone).session(session);
      if (zoneDoc) {
        zoneId = zoneDoc._id;
        zoneName = zoneDoc.name;
      } else {
        // Fallback: treat zone as a string name
        zoneName = zone;
      }
    } else {
      // Fallback to farmer's zone
      zoneId = farmer.zoneId || null;
      zoneName = farmer.zoneName || '';
    }

    // ── 6. Create Transaction ──────────────────────────────
    const [transaction] = await Transaction.create([{
      device_id,
      receipt_num: receiptNum,
      qr_hash: qrHash,
      status: 'completed',
      device_seq_num,
      server_seq_num: serverSeqNum,
      timestamp_local: new Date(timestamp_local),
      timestamp_server: new Date(),
      digital_signature: digitalSignature,
      idempotency_key: finalKey,
      soft_delta: 0,
      type: 'milk',
      litres: litresNum,
      quantity: 0,
      payout,
      cost: 0,
      farmer_id,
      rate_version_id: rateInfo.rate_version_id,
      porter_id,
      zone: zoneName || farmer.zoneName || zone || '',
      zoneId: zoneId || farmer.zoneId || null,
      branch_id,
      cooperativeId,
    }], { session });

    // ── 7. Create Ledger Entry ────────────────────────────
    const newBalance = previousBalance + payout;
    const [ledgerEntry] = await Ledger.create([{
      cooperativeId,
      farmerId: farmer_id,
      transactionId: transaction._id,
      type: 'MILK_CREDIT',
      amount: payout,
      runningBalance: newBalance,
      description: `Milk delivery ${receiptNum}`,
      reference: receiptNum,
      createdBy: userId,
      metadata: {
        litres: litresNum,
        rate: rateInfo.rate,
        rate_version_id: rateInfo.rate_version_id,
        device_id,
        porter_id,
        zone: zoneName || farmer.zoneName || zone || '',
        zoneId: zoneId || farmer.zoneId || null,
      },
      timestamp: new Date(),
    }], { session });

    // ── 8. Update Farmer.currentBalance and lastLedgerId ──
    await updateFarmerBalance(farmer_id, newBalance, ledgerEntry._id);

    // ── 9. Update Porter totals ──────────────────────────
    await Porter.findByIdAndUpdate(
      porter_id,
      {
        $inc: {
          'totals.litresCollected': litresNum,
          'totals.transactionsCount': 1,
        },
      },
      { session }
    );

    // ── 10. Commit transaction ──────────────────────────
    await session.commitTransaction();
    session.endSession();

    // ── 11. Generate QR and receipts (non‑critical) ──
    let qrImage = null;
    try {
      const qrResult = await qrService.generateQRForTransaction(transaction._id, cooperativeId);
      qrImage = qrResult.qrImage;
    } catch (err) {
      logger.warn('QR generation failed', { transactionId: transaction._id, error: err.message });
    }

    let thermalReceipt;
    try {
      thermalReceipt = await receiptService.generateThermalReceipt(transaction._id, null);
    } catch (err) {
      logger.warn('Receipt generation failed', { transactionId: transaction._id, error: err.message });
      const fallback = `RECEIPT #${receiptNum}\nMILK ${litresNum}L @ ${rateInfo.rate}/L = ${payout}\nTHANK YOU`;
      thermalReceipt = {
        thermalReceipt: Buffer.from(fallback),
        qrImage: null,
        receiptNum,
        previewText: fallback,
      };
    }

    const updatedFarmer = await Farmer.findById(farmer_id).lean();

    logger.info('✅ Milk transaction COMPLETE', {
      transactionId: transaction._id,
      receiptNum,
      serverSeqNum,
      litres: litresNum,
      payout,
      rate: rateInfo.rate,
      previousBalance,
      newBalance,
      zoneId: zoneId || farmer.zoneId,
      zone: zoneName || farmer.zoneName || zone,
    });

    return {
      transaction,
      receiptNum,
      serverSeqNum,
      qrUrl: qrService.generateQRUrl(receiptNum),
      qrImage,
      payout,
      farmer_code,
      farmer_name: updatedFarmer.name,
      previousBalance,
      newBalance,
      ledgerEntry,
      thermalReceipt,
      receiptPreview: thermalReceipt.previewText,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error('❌ Milk transaction failed', { error: error.message });
    throw error;
  }
};

// ── Sync offline ────────────────────────────────────────
const syncOfflineTransactions = async (transactions, cooperativeId) => {
  if (!cooperativeId) throw new Error('cooperativeId is required for sync');
  const operations = transactions.map((tx) => ({
    updateOne: {
      filter: { idempotency_key: tx.idempotency_key },
      update: { $setOnInsert: { ...tx, cooperativeId } },
      upsert: true,
    },
  }));
  const results = await Transaction.bulkWrite(operations, { ordered: false });
  return { success: true, synced: results.upsertedCount, failed: 0 };
};

// ── Get farmer history ──────────────────────────────────
const getFarmerHistory = async (farmer_code, limit = 50, cooperativeId) => {
  try {
    const farmer = await Farmer.findOne({ farmer_code });
    if (!farmer) throw new Error('Farmer not found');

    const farmerCoop = farmer.cooperativeId.toString();
    const providedCoop = cooperativeId ? cooperativeId.toString() : null;
    if (farmerCoop !== providedCoop) {
      throw new Error('Unauthorized: Farmer does not belong to your cooperative');
    }

    const farmerId = farmer._id;
    const coopId = farmerCoop;

    // ─── 1. Financial summary from Ledger ──────────────────────
    const ledgerSummary = await Ledger.aggregate([
      {
        $match: {
          cooperativeId: new mongoose.Types.ObjectId(coopId),
          farmerId: farmerId,
        },
      },
      {
        $group: {
          _id: null,
          milkIncome: {
            $sum: { $cond: [{ $eq: ['$type', 'MILK_CREDIT'] }, '$amount', 0] },
          },
          feedCost: {
            $sum: { $cond: [{ $eq: ['$type', 'FEED_DEBIT'] }, { $abs: '$amount' }, 0] },
          },
          settlementDeductions: {
            $sum: { $cond: [{ $eq: ['$type', 'SETTLEMENT_DEBIT'] }, { $abs: '$amount' }, 0] },
          },
          bonuses: {
            $sum: { $cond: [{ $eq: ['$type', 'BONUS'] }, '$amount', 0] },
          },
          penalties: {
            $sum: { $cond: [{ $eq: ['$type', 'PENALTY'] }, { $abs: '$amount' }, 0] },
          },
          loans: {
            $sum: { $cond: [{ $eq: ['$type', 'LOAN'] }, { $abs: '$amount' }, 0] },
          },
          interest: {
            $sum: { $cond: [{ $eq: ['$type', 'INTEREST'] }, { $abs: '$amount' }, 0] },
          },
          manualAdjustments: {
            $sum: { $cond: [{ $eq: ['$type', 'MANUAL_ADJUSTMENT'] }, '$amount', 0] },
          },
        },
      },
    ]);

    const summary = ledgerSummary[0] || {
      milkIncome: 0,
      feedCost: 0,
      settlementDeductions: 0,
      bonuses: 0,
      penalties: 0,
      loans: 0,
      interest: 0,
      manualAdjustments: 0,
    };

    // ─── 2. Current balance from latest Ledger entry ────────────
    const lastLedger = await Ledger.findOne({
      cooperativeId: coopId,
      farmerId: farmerId,
    })
      .sort({ timestamp: -1 })
      .lean();

    const currentBalance = lastLedger ? lastLedger.runningBalance : 0;

    let status = 'SETTLED';
    if (currentBalance > 0) status = 'PAYABLE';
    else if (currentBalance < 0) status = 'OWES_COOPERATIVE';

    // ─── 3. Lifetime operational metrics from Transactions ──────
    const operationalStats = await Transaction.aggregate([
      {
        $match: {
          farmer_id: farmerId,
          cooperativeId: new mongoose.Types.ObjectId(coopId),
        },
      },
      {
        $facet: {
          milk: [
            { $match: { type: 'milk' } },
            {
              $group: {
                _id: null,
                totalLitres: { $sum: '$litres' },
                count: { $sum: 1 },
                avgLitres: { $avg: '$litres' },
                firstDelivery: { $min: '$timestamp_server' },
                lastDelivery: { $max: '$timestamp_server' },
              },
            },
          ],
          feed: [
            { $match: { type: 'feed' } },
            {
              $group: {
                _id: null,
                totalQuantity: { $sum: '$quantity' },
                count: { $sum: 1 },
                totalCost: { $sum: '$cost' },
              },
            },
          ],
          all: [{ $count: 'total' }],
        },
      },
    ]);

    const stats = operationalStats[0] || {};
    const milkStats = stats.milk?.[0] || {
      totalLitres: 0,
      count: 0,
      avgLitres: 0,
      firstDelivery: null,
      lastDelivery: null,
    };
    const feedStats = stats.feed?.[0] || {
      totalQuantity: 0,
      count: 0,
      totalCost: 0,
    };
    const totalTransactions = stats.all?.[0]?.total || 0;

    // ─── 4. Opening balance ──────────────────────────────────────
    const firstLedger = await Ledger.findOne({
      cooperativeId: coopId,
      farmerId: farmerId,
    })
      .sort({ timestamp: 1 })
      .lean();
    const openingBalance = firstLedger ? firstLedger.runningBalance - firstLedger.amount : 0;

    // ─── 5. Ledger history (financial statement) ──────────────────
    const ledgerHistory = await Ledger.find({
      cooperativeId: coopId,
      farmerId: farmerId,
    })
      .sort({ timestamp: -1 })
      .limit(limit)
      .lean();

    const formattedLedgerHistory = ledgerHistory.map(entry => ({
      date: entry.timestamp,
      type: entry.type,
      amount: entry.amount,
      balanceAfter: entry.runningBalance,
      description: entry.description || entry.reference || '',
      reference: entry.reference,
    }));

    // ─── 6. Transaction history (operational) with porter name ──
    const transactions = await Transaction.aggregate([
      {
        $match: {
          farmer_id: farmerId,
          cooperativeId: new mongoose.Types.ObjectId(coopId),
        },
      },
      {
        $sort: { timestamp_server: -1 },
      },
      { $limit: parseInt(limit) },
      {
        $lookup: {
          from: 'porters',
          localField: 'porter_id',
          foreignField: '_id',
          as: 'porterInfo',
        },
      },
      {
        $unwind: { path: '$porterInfo', preserveNullAndEmptyArrays: true },
      },
      {
        $project: {
          receipt: '$receipt_num',
          date: '$timestamp_server',
          type: '$type',
          litres: 1,
          quantity: 1,
          payout: 1,
          cost: 1,
          paymentMethod: 1,
          zone: 1,
          porterName: { $ifNull: ['$porterInfo.name', null] },
          porterId: '$porter_id',
          device_id: 1,
        },
      },
    ]);

    // Format transactions for frontend
    const cleanTransactions = transactions.map(t => ({
      receipt: t.receipt || '',
      date: t.date,
      event: t.type === 'milk' ? 'Milk Delivery' : 'Feed Purchase',
      litres: t.litres || 0,
      quantity: t.quantity || 0,
      amount: t.type === 'milk' ? (t.payout || 0) : (t.cost || 0),
      paymentMethod: t.paymentMethod || 'balance',
      zone: t.zone || '',
      porter: t.porterName || 'Unknown',
      device_id: t.device_id,
    }));

    // ─── 7. Net earnings ──────────────────────────────────────────
    const netEarnings = summary.milkIncome - summary.feedCost - summary.settlementDeductions;

    // ─── 8. Assemble response ────────────────────────────────────
    return {
      farmer: {
        id: farmer._id,
        name: farmer.name,
        code: farmer.farmer_code,
        phone: farmer.phone,
        branch: farmer.branch_id || 'main',
        isActive: farmer.isActive,
      },
      summary: {
        currentBalance,
        status,
        milkIncome: summary.milkIncome,
        feedCost: summary.feedCost,
        settlementDeductions: summary.settlementDeductions,
        bonuses: summary.bonuses,
        penalties: summary.penalties,
        loans: summary.loans,
        interest: summary.interest,
        manualAdjustments: summary.manualAdjustments,
        netEarnings,
        lifetimeLitres: milkStats.totalLitres,
        deliveries: milkStats.count,
        averageLitresPerDelivery: milkStats.avgLitres || 0,
        firstDelivery: milkStats.firstDelivery,
        lastDelivery: milkStats.lastDelivery,
        feedPurchases: feedStats.count,
        totalFeedQuantity: feedStats.totalQuantity,
        totalTransactions,
      },
      statement: {
        openingBalance,
        credits: summary.milkIncome + summary.bonuses + (summary.manualAdjustments > 0 ? summary.manualAdjustments : 0),
        debits: summary.feedCost + summary.settlementDeductions + summary.penalties + summary.loans + summary.interest + (summary.manualAdjustments < 0 ? Math.abs(summary.manualAdjustments) : 0),
        closingBalance: currentBalance,
      },
      transactions: cleanTransactions,
      ledgerHistory: formattedLedgerHistory,
    };
  } catch (error) {
    logger.error('FarmerHistory failed', { error: error.message, farmer_code, cooperativeId });
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
};