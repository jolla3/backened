const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Ledger = require('../models/ledger');
const { updateFarmerBalance } = require('../utils/ledgerUtils');
const { generateServerSeqNum, getActiveRateVersion } = require('../services/transactionService');
const { generateReceiptNum } = require('../utils/receiptNumberGenerator'); // ← correct source
const receiptFormatter = require('../utils/receiptFormatter');
const smsService = require('./smsService');
const logger = require('../utils/logger');
const {
  getKenyaDateString,
  parseKenyaDate,
  isValidDateString
} = require('../utils/dateUtils');
const { getCumulativeMilk } = require('./cumulativeMilkService');


// ─── Read functions ──────────────────────────────────────────

const getDailyTotal = async (cooperativeId, date = null) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const targetDate = date || getKenyaDateString();
  if (!isValidDateString(targetDate)) {
    throw new Error('Invalid date. Expected YYYY-MM-DD with a real date.');
  }

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

  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    throw new Error('Invalid year');
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error('Invalid month');
  }

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
  createdBy,
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
    if (!isValidDateString(collectionDate)) {
      throw new Error('Invalid collection date. Expected YYYY-MM-DD with a real date.');
    }
    if (!collectionShift || !['AM', 'PM'].includes(collectionShift)) {
      throw new Error('collectionShift must be AM or PM');
    }
    if (!createdBy) throw new Error('createdBy (user ID) is required');

    const litresNum = parseFloat(litres);
    const collectionDateTime = parseKenyaDate(collectionDate);

    // ── 2. Validate cooperative ────────────────────────────
    const cooperative = await Cooperative.findById(cooperativeId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    // ── 3. Validate farmer ──────────────────────────────────
    const farmer = await Farmer.findOne({
      _id: farmerId,
      cooperativeId: cooperative._id,
      isActive: true,
    }).session(session);
    if (!farmer) throw new Error('Farmer not found or inactive');

    // ── 4. Validate porter ──────────────────────────────────
    const porter = await Porter.findOne({
      _id: porterId,
      cooperativeId: cooperative._id,
      isActive: true,
    }).session(session);
    if (!porter) throw new Error('Porter not found or inactive');

    // ── 5. Get active milk rate ─────────────────────────────
    const rateInfo = await getActiveRateVersion(
      cooperativeId,
      'milk',
      collectionDate
    );

    if (!rateInfo || !rateInfo.rate || rateInfo.rate <= 0) {
      throw new Error('Invalid milk rate');
    }

    const payout = parseFloat((litresNum * rateInfo.rate).toFixed(2));

    // ── 6. Generate receipt number (new coded format) ───────
    const receiptNum = await generateReceiptNum(cooperative.name);
    const serverSeqNum = await generateServerSeqNum(cooperativeId);

    // ── 7. Business idempotency key ─────────────────────────
    const idempotencyKey =
      `manual:${cooperativeId}:${farmerId}:${collectionDate}:${collectionShift}`;

    // ── 8. Duplicate check ──────────────────────────────────
    const existing = await Transaction.findOne({ idempotency_key: idempotencyKey })
      .session(session);
    if (existing) {
      const error = new Error(
        `Milk already recorded for ${farmer.name} on ${collectionDate} (${collectionShift})`
      );
      error.code = 'DUPLICATE_MILK_ENTRY';
      error.statusCode = 409;
      throw error;
    }

    // ── 9. Create Transaction ───────────────────────────────
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
      rate_version_id: rateInfo.rate_version_id,
      cooperativeId: cooperative._id,
      zoneId: zoneId || null,
      zone: zone || '',
      collectionDate,
      collectionShift,
      createdBy,
      entryMethod: 'manual',
      idempotency_key: idempotencyKey,
    };

    let transaction;
    try {
      [transaction] = await Transaction.create([transactionData], { session });
    } catch (error) {
      if (error.code === 11000) {
        const dupError = new Error(
          `Milk already recorded for this farmer on ${collectionDate} (${collectionShift})`
        );
        dupError.code = 'DUPLICATE_MILK_ENTRY';
        dupError.statusCode = 409;
        throw dupError;
      }
      throw error;
    }

    // ── 10. Balance & Ledger ────────────────────────────────
    const previousBalance = farmer.currentBalance || 0;
    const newBalance = previousBalance + payout;

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
        rate_version_id: rateInfo.rate_version_id,
        porter_id: porter._id,
        collectionShift,
        collectionDate,
      },
      timestamp: new Date(),
    }], { session });

    await updateFarmerBalance(farmer._id, newBalance, ledgerEntry._id, session);

    // ── 11. Porter totals ───────────────────────────────────
    await Porter.findByIdAndUpdate(
      porter._id,
      {
        $inc: {
          'totals.litresCollected': litresNum,
          'totals.transactionsCount': 1,
        },
      },
      { session }
    );

    // ── 12. Commit ──────────────────────────────────────────
    await session.commitTransaction();
    session.endSession();

    // ── 13. Receipt + SMS (outside transaction) ─────────────
    let receipt = null;
    if (farmer.phone) {
      try {
        const cumulative = await getCumulativeMilk({
          farmerId: farmer._id,
          cooperativeId: cooperative._id,
          asOfDate: collectionDate,
          asOfShift: collectionShift,
        });
        const cumulativeLitres = cumulative.litres;

        const receiptData = {
          cooperativeName: cooperative.name,
          receiptNumber: receiptNum,
          farmerName: farmer.name,
          farmerCode: farmer.farmer_code || farmer.code || 'N/A',
          litres: litresNum,
          payout,
          walletBalance: newBalance,
          cumulativeMilk: cumulativeLitres,
          collectionDate,
          collectionShift,
        };

        receipt = receiptFormatter.formatMilkReceipt(receiptData);

        logger.info('FINAL MILK SMS', {
          receiptNum,
          length: receipt.smsLength,
          message: receipt.sms,
          cumulativeMilk: cumulativeLitres,
          collectionDate,
          collectionShift,
        });

        await smsService.queueSMS({
          to: farmer.phone,
          message: receipt.sms,
          type: 'milk_receipt',
          cooperativeId: cooperative._id,
          farmerId: farmer._id,
          metadata: {
            receiptNumber: receiptNum,
            collectionDate,
            collectionShift,
            litres: litresNum,
            cumulativeMilk: cumulativeLitres,
            entryMethod: 'manual',
          },
        });

        logger.info('Manual milk receipt SMS queued', {
          phone: farmer.phone,
          receiptNum,
          cumulative: cumulativeLitres,
        });
      } catch (err) {
        logger.warn('Receipt generation or SMS queue failed (non-critical)', {
          farmerId: farmer._id,
          error: err.message,
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
      collectionDate,
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
      receipt,
    };
  } catch (error) {
    if (session.inTransaction()) {
      await session.abortTransaction();
    }
    session.endSession();

    if (error.code === 'DUPLICATE_MILK_ENTRY') {
      throw error;
    }

    logger.error('Manual milk entry failed', { error: error.message });
    throw error;
  }
};

module.exports = {
  getKenyaDateString,
  getDailyTotal,
  getMonthlySummary,
  addManualMilkEntry
};