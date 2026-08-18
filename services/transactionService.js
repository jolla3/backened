// services/transactionService.js
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Counter = require('../models/counter');
const Ledger = require('../models/ledger');
const Zone = require('../models/zone');
const receiptService = require('./receiptService');
const qrService = require('./qrService');
const logger = require('../utils/logger');
const FRAUD_CONFIG = require('../config/fraudConfig');
const { updateFarmerBalance } = require('../utils/ledgerUtils');
const { formatMilkReceipt } = require('../utils/receiptFormatter');
const Cooperative = require('../models/cooperative');
const smsService = require('./smsService');

// ─── Import date utilities ────────────────────────────────
const {
  parseKenyaDate,
  isValidDateString,
  getKenyaDateString,   // ✅ added
} = require('../utils/dateUtils');

// ─── Rate lookup (requires effectiveDate) ──────────────────
const getActiveRateVersion = async (cooperativeId, type = 'milk', effectiveDate) => {
  if (!effectiveDate) {
    throw new Error('effectiveDate is required');
  }

  if (!isValidDateString(effectiveDate)) {
    throw new Error('Invalid effective date. Expected YYYY-MM-DD with a real date.');
  }

  const targetDate = parseKenyaDate(effectiveDate);

  const activeRate = await RateVersion.findOne({
    cooperativeId,
    type,
    effective_date: { $lte: targetDate }
  })
    .sort({ effective_date: -1, _id: -1 })
    .lean();

  if (!activeRate) {
    throw new Error(`No active ${type} rate found for ${effectiveDate}`);
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

const recordMilkTransaction = async (data) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  let farmer;
  let transaction;
  let receiptNum;
  let payout;
  let newBalance;
  let previousBalance;
  let cooperativeId;
  let farmer_id;
  let ledgerEntry;
  let effectiveDate;
  let collectionShift = 'AM';
  let litresNum;

  try {
    const {
      farmer_code,
      litres,
      porter_id,
      zone,
      device_id,
      farmer_id: fId,
      branch_id,
      device_seq_num,
      timestamp_local,
      cooperativeId: coopId,
      userId,
      clientIdempotencyKey,
    } = data;

    cooperativeId = coopId;
    farmer_id = fId;

    if (!userId) {
      throw new Error('User ID (userId) is required for ledger entry');
    }
    if (!device_id) {
      throw new Error('device_id is required');
    }

    // ── 1. Validation ──────────────────────────────────
    litresNum = parseFloat(litres);
    if (isNaN(litresNum) || litresNum < FRAUD_CONFIG.MIN_MILK_THRESHOLD) {
      throw new Error(`Milk quantity must be at least ${FRAUD_CONFIG.MIN_MILK_THRESHOLD}L`);
    }
    if (litresNum > FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION) {
      throw new Error(`Milk quantity cannot exceed ${FRAUD_CONFIG.MAX_MILK_PER_TRANSACTION}L per transaction`);
    }

    // ── Request-level idempotency ───────────────────────
    const requestIdempotencyKey =
      clientIdempotencyKey ||
      (device_seq_num != null
        ? `milk:${cooperativeId}:${device_id}:${device_seq_num}`
        : null);

    if (requestIdempotencyKey) {
      const existing = await Transaction.findOne({
        cooperativeId,
        idempotency_key: requestIdempotencyKey,
        type: 'milk',
      }).session(session);

      if (existing) {
        await session.abortTransaction();
        session.endSession();

        const cooperative = await Cooperative.findById(cooperativeId).lean();
        const farmerDoc = await Farmer.findById(farmer_id).lean();

        const { getCumulativeMilkForMonth } = require('./cumulativeMilkService');
        const monthly = await getCumulativeMilkForMonth(
          farmer_id,
          cooperativeId,
          existing.timestamp_server || new Date()
        );

        const historicalBalance =
          existing.wallet_balance_after != null
            ? existing.wallet_balance_after
            : (farmerDoc?.currentBalance || 0);

        const receipt = formatMilkReceipt({
          cooperativeName: cooperative?.name || 'COOPERATIVE',
          receiptNumber: existing.receipt_num,
          farmerName: farmerDoc?.name || '',
          farmerCode: farmerDoc?.farmer_code || farmerDoc?.code || '',
          litres: existing.litres,
          payout: existing.payout,
          walletBalance: historicalBalance,
          monthlyMilk: monthly.litres,
          collectionDate: existing.collectionDate,
          transactionDate: existing.timestamp_server,
        });

        return {
          transaction: existing,
          receiptNum: existing.receipt_num,
          serverSeqNum: existing.server_seq_num,
          qrUrl: qrService.generateQRUrl(existing.receipt_num),
          qrImage: null,
          payout: existing.payout,
          farmer_code: farmerDoc?.farmer_code || farmerDoc?.code,
          farmer_name: farmerDoc?.name,
          previousBalance: existing.wallet_balance_before ?? null,
          newBalance: historicalBalance,
          ledgerEntry: null,
          receipt,
          duplicate: true,
        };
      }
    }

    // ── Derive effective date / shift ───────────────────
    if (timestamp_local) {
      const dateObj = new Date(timestamp_local);
      if (!isNaN(dateObj.getTime())) {
        effectiveDate = getKenyaDateString(dateObj);
        const hour = dateObj.getHours();
        collectionShift = hour >= 12 ? 'PM' : 'AM';
      }
    }
    if (!effectiveDate) {
      logger.warn("timestamp_local missing or invalid; using today's Nairobi date");
      effectiveDate = getKenyaDateString();
    }

    // ── Rate lookup ─────────────────────────────────────
    const rateInfo = await getActiveRateVersion(cooperativeId, 'milk', effectiveDate);
    payout = parseFloat((litresNum * rateInfo.rate).toFixed(2));

    await checkDailyFraudLimit(farmer_id, litresNum);

    // ── Generate numbers ────────────────────────────────
    receiptNum = await generateReceiptNum();
    const serverSeqNum = await generateServerSeqNum(branch_id);

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

    // ── Farmer (under session) ──────────────────────────
    farmer = await Farmer.findById(farmer_id).session(session);
    if (!farmer) {
      throw new Error('Farmer not found');
    }

    // ── Zone resolution ─────────────────────────────────
    let zoneId = null;
    let zoneName = '';
    if (zone) {
      const zoneDoc = await Zone.findById(zone).session(session);
      if (zoneDoc) {
        zoneId = zoneDoc._id;
        zoneName = zoneDoc.name;
      } else {
        zoneName = zone;
      }
    } else {
      zoneId = farmer.zoneId || null;
      zoneName = farmer.zoneName || '';
    }

    // ── Atomic balance from latest ledger (same session) ─
    const lastLedger = await Ledger.findOne({
      cooperativeId,
      farmerId: farmer_id,
    })
      .sort({ timestamp: -1, _id: -1 })
      .session(session)
      .lean();

    previousBalance = lastLedger ? lastLedger.runningBalance : 0;
    newBalance = previousBalance + payout;

    // ── Create Transaction ──────────────────────────────
    const finalKey =
      requestIdempotencyKey ||
      `${device_id}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

    [transaction] = await Transaction.create(
      [{
        device_id,
        receipt_num: receiptNum,
        qr_hash: qrHash,
        status: 'completed',
        device_seq_num,
        server_seq_num: serverSeqNum,
        timestamp_local: timestamp_local ? new Date(timestamp_local) : new Date(),
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
        createdBy: userId,
        collectionDate: effectiveDate,
        collectionShift,
        wallet_balance_before: previousBalance,
        wallet_balance_after: newBalance,
      }],
      { session }
    );

    // ── Create Ledger Entry ─────────────────────────────
    [ledgerEntry] = await Ledger.create(
      [{
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
      }],
      { session }
    );

    // ── Update farmer balance INSIDE the same session ───
    await updateFarmerBalance(farmer_id, newBalance, ledgerEntry._id, session);

    // ── Porter totals ───────────────────────────────────
    if (porter_id) {
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
    }

    // ── Commit ──────────────────────────────────────────
    await session.commitTransaction();
    session.endSession();

    // =====================================================
    // OUTSIDE TRANSACTION – SMS failure must not roll back
    // =====================================================

    const cooperative = await Cooperative.findById(cooperativeId).lean();
    if (!cooperative) {
      throw new Error('Cooperative not found for receipt');
    }

    const { getCumulativeMilkForMonth } = require('./cumulativeMilkService');
    const monthly = await getCumulativeMilkForMonth(
      farmer_id,
      cooperativeId,
      transaction.timestamp_server || new Date()
    );

    const receipt = formatMilkReceipt({
      cooperativeName: cooperative.name,
      receiptNumber: receiptNum,
      farmerName: farmer.name,
      farmerCode: farmer.farmer_code || farmer.code,
      litres: litresNum,
      payout,
      walletBalance: newBalance,
      monthlyMilk: monthly.litres,
      collectionDate: transaction.collectionDate || effectiveDate,
      transactionDate: transaction.timestamp_server,
    });

    if (farmer.phone) {
      try {
        const smsResult = await smsService.sendSMS({
          to: farmer.phone,
          message: receipt.sms,
          from: process.env.CELCOM_SENDER_ID || 'JOMUGITAGRI',
          type: 'milk_receipt',
          cooperativeId,
          farmerId: farmer_id,
          priority: 80,
          idempotencyKey: `milk_receipt:${transaction._id}`,
          metadata: {
            transactionId: transaction._id.toString(),
            receiptNumber: receiptNum,
            litres: litresNum,
            payout,
            monthlyMilk: monthly.litres,
          },
        });

        if (smsResult.queued) {
          logger.info('Milk SMS queued', {
            jobId: smsResult.jobId,
            phone: farmer.phone,
            duplicate: !!smsResult.duplicate,
          });
        }
      } catch (smsError) {
        logger.error('SMS failed but transaction committed', {
          phone: farmer.phone,
          error: smsError.message,
        });
      }
    }

    let qrImage = null;
    try {
      const qrResult = await qrService.generateQRForTransaction(
        transaction._id,
        cooperativeId
      );
      qrImage = qrResult.qrImage;
    } catch (err) {
      logger.warn('QR generation failed', {
        transactionId: transaction._id,
        error: err.message,
      });
    }

    const updatedFarmer = await Farmer.findById(farmer_id).lean();

    logger.info('Milk transaction complete', {
      transactionId: transaction._id,
      receiptNum,
      litres: litresNum,
      payout,
      previousBalance,
      newBalance,
      monthlyMilk: monthly.litres,
    });

    return {
      transaction,
      receiptNum,
      serverSeqNum: transaction.server_seq_num,
      qrUrl: qrService.generateQRUrl(receiptNum),
      qrImage,
      payout,
      farmer_code: farmer.farmer_code || farmer.code,
      farmer_name: updatedFarmer?.name,
      previousBalance,
      newBalance,
      ledgerEntry,
      receipt,
      duplicate: false,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();
    logger.error('Milk transaction failed', {
      error: error.message,
      stack: error.stack,
    });
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