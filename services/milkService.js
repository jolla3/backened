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

// ─── Helper: get current Kenya date as YYYY-MM-DD ──────────
const getKenyaDateString = (date = new Date()) => {
  return date.toLocaleDateString('en-CA', { timeZone: 'Africa/Nairobi' });
};

// ─── Helper: validate collection date ──────────────────────
const COLLECTION_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

const isValidCollectionDate = (dateString) => {
  if (!COLLECTION_DATE_REGEX.test(dateString)) {
    return false;
  }
  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

// ─── Existing read functions ──────────────────────────────

const getDailyTotal = async (cooperativeId, date = null) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const targetDate = date || getKenyaDateString();
  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      collectionDate: targetDate
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

  const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2,'0')}-${String(lastDay).padStart(2,'0')}`;

  const result = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      collectionDate: { $gte: startDate, $lte: endDate }
    }},
    { $group: {
      _id: '$collectionDate',
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }},
    { $sort: { _id: 1 } }
  ]);

  return result.map(item => ({
    _id: item._id,
    totalLitres: item.totalLitres,
    totalPayout: item.totalPayout,
    transactionCount: item.transactionCount
  }));
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
    if (!isValidCollectionDate(collectionDate)) {
      throw new Error('Invalid collection date. Expected YYYY-MM-DD with a real date.');
    }
    if (!collectionShift || !['AM', 'PM'].includes(collectionShift)) {
      throw new Error('collectionShift must be AM or PM');
    }
    if (!createdBy) throw new Error('createdBy (user ID) is required');

    const litresNum = parseFloat(litres);

    // ── 2. Build Kenya‑local timestamp for legacy timestamp_local ──
    const collectionDateTime = new Date(`${collectionDate}T00:00:00+03:00`);
    if (isNaN(collectionDateTime.getTime())) {
      throw new Error('Unable to parse collection date');
    }

    // ── 3. Validate cooperative ────────────────────────────
    const cooperative = await Cooperative.findById(cooperativeId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    // ── 4. Validate farmer ──────────────────────────────────
    const farmer = await Farmer.findOne({
      _id: farmerId,
      cooperativeId: cooperative._id,
      isActive: true
    }).session(session);
    if (!farmer) throw new Error('Farmer not found or inactive');

    // ── 5. Validate porter ──────────────────────────────────
    const porter = await Porter.findOne({
      _id: porterId,
      cooperativeId: cooperative._id,
      isActive: true
    }).session(session);
    if (!porter) throw new Error('Porter not found or inactive');

    // ── 6. Get active milk rate at collection date ───────────
    const rateInfo = await RateVersion.findOne({
      cooperativeId: cooperative._id,
      type: 'milk',
      effective_date: { $lte: collectionDateTime }
    }).sort({ effective_date: -1 }).session(session);

    if (!rateInfo) throw new Error('No active milk rate found for the collection date');
    if (rateInfo.rate <= 0) throw new Error('Invalid milk rate');

    const payout = parseFloat((litresNum * rateInfo.rate).toFixed(2));

    // ── 7. Generate receipt numbers ────────────────────────
    const receiptNum = await generateReceiptNum(session);
    const serverSeqNum = await generateServerSeqNum(cooperativeId, session);

    // ── 8. Generate idempotency key ─────────────────────────
    const idempotencyKey =
      `manual:${cooperativeId}:${farmerId}:${collectionDate}:${collectionShift}:${porterId}`;

    // ── 9. Check duplicate (with proper error) ──────────────
    const existing = await Transaction.findOne({ idempotency_key: idempotencyKey }).session(session);
    if (existing) {
      const error = new Error(
        `Milk already recorded for ${farmer.name} on ${collectionDate} (${collectionShift}) by ${porter.name}`
      );
      error.code = 'DUPLICATE_MILK_ENTRY';
      error.statusCode = 409;
      throw error;
    }

    // ── 10. Create Transaction ─────────────────────────────
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
      collectionDate,
      collectionShift,
      createdBy,
      entryMethod: 'manual',
      idempotency_key: idempotencyKey,
    };

    const [transaction] = await Transaction.create([transactionData], { session });

    // ── 11. Get previous balance ────────────────────────────
    const previousBalance = farmer.currentBalance || 0;
    const newBalance = previousBalance + payout;

    // ── 12. Create Ledger Entry ─────────────────────────────
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
        collectionDate
      },
      timestamp: new Date()
    }], { session });

    // ── 13. Update Farmer balance ──────────────────────────
    await updateFarmerBalance(farmer._id, newBalance, ledgerEntry._id, session);

    // ── 14. Update Porter totals ──────────────────────────
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

    // ── 15. Commit transaction ────────────────────────────
    await session.commitTransaction();
    session.endSession();

    // ── 16. Generate receipt and queue SMS ────────────────
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
      collectionShift,
      collectionDate
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
    // Re-throw the error with its code intact
    throw error;
  }
};

module.exports = {
  getKenyaDateString,
  getDailyTotal,
  getMonthlySummary,
  addManualMilkEntry
};