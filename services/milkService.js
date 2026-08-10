const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Ledger = require('../models/ledger');
const { updateFarmerBalance } = require('../utils/ledgerUtils');
const { generateReceiptNum, generateServerSeqNum } = require('../services/transactionService');
const receiptFormatter = require('../utils/receiptFormatter');
const smsService = require('./smsService');
const logger = require('../utils/logger');

// ─── Existing read functions ──────────────────────────────

const getDailyTotal = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const endOfDay = new Date(startOfDay);
  endOfDay.setHours(23, 59, 59, 999);

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      timestamp_local: { $gte: startOfDay, $lte: endOfDay }
    }},
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }}
  ]);

  return result[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0 };
};

const getMonthlySummary = async (year, month, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const startOfMonth = new Date(year, month - 1, 1);
  const endOfMonth = new Date(year, month, 0, 23, 59, 59, 999);

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      timestamp_local: { $gte: startOfMonth, $lte: endOfMonth }
    }},
    { $group: {
      _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_local' } },
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }},
    { $sort: { _id: 1 } }
  ]);

  return result;
};

// ─── Manual Milk Entry ──────────────────────────────────────

const addManualMilkEntry = async ({
  cooperativeId,
  farmerId,
  porterId,
  litres,
  collectionDate,
  collectionShift,
  zoneId,
  zone,
  createdBy
}) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ── 1. Validate inputs ──────────────────────────────────
    if (!cooperativeId) throw new Error('cooperativeId is required');
    if (!farmerId) throw new Error('farmerId is required');
    if (!porterId) throw new Error('porterId is required');
    if (!litres || isNaN(parseFloat(litres)) || parseFloat(litres) <= 0) {
      throw new Error('Valid litres value is required');
    }
    if (!collectionDate) throw new Error('collectionDate is required');
    if (!collectionShift || !['AM', 'PM'].includes(collectionShift)) {
      throw new Error('collectionShift must be AM or PM');
    }
    if (!createdBy) throw new Error('createdBy (user ID) is required');

    const litresNum = parseFloat(litres);
    const collectionDateTime = new Date(collectionDate);
    // ✅ Validate date
    if (isNaN(collectionDateTime.getTime())) {
      throw new Error('Invalid collection date');
    }

    // ── 2. Validate cooperative ────────────────────────────
    const cooperative = await Cooperative.findById(cooperativeId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    // ── 3. Validate farmer ──────────────────────────────────
    const farmer = await Farmer.findOne({
      _id: farmerId,
      cooperativeId: cooperative._id,
      isActive: true
    }).session(session);
    if (!farmer) throw new Error('Farmer not found or inactive');

    // ── 4. Validate porter ──────────────────────────────────
    const porter = await Porter.findOne({
      _id: porterId,
      cooperativeId: cooperative._id,
      isActive: true
    }).session(session);
    if (!porter) throw new Error('Porter not found or inactive');

    // ── 5. Get active milk rate at collection date ───────────
    const rateInfo = await RateVersion.findOne({
      cooperativeId: cooperative._id,
      type: 'milk',
      effective_date: { $lte: collectionDateTime }
    }).sort({ effective_date: -1 }).session(session);

    if (!rateInfo) throw new Error('No active milk rate found for the collection date');
    if (rateInfo.rate <= 0) throw new Error('Invalid milk rate');

    const payout = parseFloat((litresNum * rateInfo.rate).toFixed(2));

    // ── 6. Generate receipt numbers ────────────────────────
    const receiptNum = await generateReceiptNum(session);
    const serverSeqNum = await generateServerSeqNum(cooperativeId, session);

    // ── 7. Generate idempotency key ─────────────────────────
    // Business rule: one manual milk entry per farmer per date+shift+porter
    // If you want to allow multiple entries per shift, add a timestamp component.
    const dateStr = collectionDateTime.toISOString().split('T')[0];
    const idempotencyKey =
      `manual:${cooperativeId}:${farmerId}:${dateStr}:${collectionShift}:${porterId}`;

    // Optional: check if transaction already exists for this key
    const existing = await Transaction.findOne({ idempotency_key: idempotencyKey }).session(session);
    if (existing) {
      logger.info('Duplicate manual milk entry prevented', { idempotencyKey });
      // Return the existing transaction without creating a new one
      return {
        success: true,
        duplicate: true,
        transaction: existing,
        receiptNum: existing.receipt_num,
        payout: existing.payout,
        farmerName: farmer.name,
        porterName: porter.name,
        previousBalance: farmer.currentBalance,
        newBalance: farmer.currentBalance, // unchanged
      };
    }

    // ── 8. Create Transaction ──────────────────────────────
    const transactionData = {
      receipt_num: receiptNum,
      status: 'completed',
      server_seq_num: serverSeqNum,
      timestamp_local: collectionDateTime,
      timestamp_server: new Date(),
      type: 'milk',
      litres: litresNum,
      payout,
      farmer_id: farmer._id,
      porter_id: porter._id,
      rate_version_id: rateInfo._id,
      cooperativeId: cooperative._id,
      zoneId: zoneId || null,
      zone: zone || '',
      collectionShift,
      createdBy,
      entryMethod: 'manual',
      idempotency_key: idempotencyKey,   // ✅ set it
    };

    const [transaction] = await Transaction.create([transactionData], { session });

    // ── 9. Get previous balance ────────────────────────────
    const previousBalance = farmer.currentBalance || 0;
    const newBalance = previousBalance + payout;

    // ── 10. Create Ledger Entry ─────────────────────────────
    const [ledgerEntry] = await Ledger.create([{
      cooperativeId: cooperative._id,
      farmerId: farmer._id,
      transactionId: transaction._id,
      type: 'MILK_CREDIT',
      amount: payout,
      runningBalance: newBalance,
      description: `Milk delivery ${receiptNum}`,
      reference: receiptNum,
      createdBy,
      metadata: {
        litres: litresNum,
        rate: rateInfo.rate,
        rate_version_id: rateInfo._id,
        porter_id: porter._id,
        collectionShift,
        collectionDate: collectionDateTime
      },
      timestamp: new Date()
    }], { session });

    // ── 11. Update Farmer balance ──────────────────────────
    await updateFarmerBalance(farmer._id, newBalance, ledgerEntry._id, session);

    // ── 12. Update Porter totals ──────────────────────────
    await Porter.findByIdAndUpdate(
      porter._id,
      {
        $inc: {
          'totals.litresCollected': litresNum,
          'totals.transactionsCount': 1,
        }
      },
      { session }
    );

    // ── 13. Commit transaction ────────────────────────────
    await session.commitTransaction();
    session.endSession();

    // ── 14. Generate receipt and queue SMS ────────────────
    let receipt = null;
    if (farmer.phone) {
      try {
        const receiptData = {
          receiptNumber: receiptNum,
          cooperativeName: cooperative.name,
          farmerName: farmer.name,
          farmerCode: farmer.farmer_code || 'N/A',
          litres: litresNum,
          payout,
          walletBalance: newBalance,
          transactionDate: collectionDateTime,
          createdAt: new Date()
        };
        receipt = receiptFormatter.formatMilkReceipt(receiptData);

        await smsService.queueSMS({
          to: farmer.phone,
          message: receipt.sms,
          type: 'milk_receipt',
          cooperativeId: cooperative._id,
          farmerId: farmer._id,
          metadata: { receiptNumber: receiptNum, entryMethod: 'manual' }
        });
        logger.info('Manual milk receipt SMS queued', { phone: farmer.phone, receiptNum });
      } catch (err) {
        logger.warn('Receipt generation or SMS queue failed (non-critical)', {
          farmerId: farmer._id,
          error: err.message
        });
      }
    }

    logger.info('✅ Manual milk entry added', {
      transactionId: transaction._id,
      receiptNum,
      litres: litresNum,
      payout,
      farmer: farmer.name,
      porter: porter.name,
      createdBy,
      collectionShift
    });

    return {
      success: true,
      transaction,
      receiptNum,
      payout,
      farmerName: farmer.name,
      porterName: porter.name,
      previousBalance,
      newBalance,
      ledgerEntry,
      receipt
    };

  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    logger.error('Manual milk entry failed', { error: error.message });
    throw error;
  }
};

module.exports = {
  getDailyTotal,
  getMonthlySummary,
  addManualMilkEntry
};