/**
 * Milk correction (farmer-scoped)
 *
 * Flow: pick farmer → list their milk transactions → correct litres (and optional date/shift).
 * Does NOT key off receipt number in the UI.
 *
 * Money: never rewrite historical MILK_CREDIT rows (would break later runningBalance).
 * Instead post a signed REVERSAL for payout delta and update Farmer.currentBalance.
 * Metrics: update the Transaction litres/payout so volume reports stay correct.
 * SMS: optional re-queue only (notification).
 */
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Ledger = require('../models/ledger');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const { updateFarmerBalance } = require('../utils/ledgerUtils');
const { getActiveRateVersion } = require('./transactionService');
const { isValidDateString, getKenyaDateString } = require('../utils/dateUtils');
const { getCumulativeMilk } = require('./cumulativeMilkService');
const receiptFormatter = require('../utils/receiptFormatter');
const smsService = require('./smsService');
const logger = require('../utils/logger');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/**
 * List recent milk transactions for a farmer (for the correction UI).
 */
const listFarmerMilkEntries = async ({
  farmerId,
  cooperativeId,
  limit = 30,
  startDate = null,
  endDate = null,
}) => {
  const coopId = new mongoose.Types.ObjectId(cooperativeId);
  const fid = new mongoose.Types.ObjectId(farmerId);

  const farmer = await Farmer.findOne({ _id: fid, cooperativeId: coopId })
    .select('name farmer_code phone currentBalance')
    .lean();
  if (!farmer) throw new Error('Farmer not found');

  const filter = {
    cooperativeId: coopId,
    farmer_id: fid,
    type: 'milk',
    status: { $in: ['completed', 'pending'] },
  };

  if (startDate || endDate) {
    filter.collectionDate = {};
    if (startDate) {
      if (!isValidDateString(startDate)) throw new Error('Invalid startDate (YYYY-MM-DD)');
      filter.collectionDate.$gte = startDate;
    }
    if (endDate) {
      if (!isValidDateString(endDate)) throw new Error('Invalid endDate (YYYY-MM-DD)');
      filter.collectionDate.$lte = endDate;
    }
  }

  const lim = Math.min(Math.max(parseInt(limit, 10) || 30, 1), 100);

  const entries = await Transaction.find(filter)
    .sort({ collectionDate: -1, timestamp_server: -1 })
    .limit(lim)
    .select(
      'litres payout collectionDate collectionShift receipt_num status timestamp_server porter_id zone metadata rate_version_id wallet_balance_before wallet_balance_after'
    )
    .lean();

  return {
    farmer: {
      id: farmer._id,
      name: farmer.name,
      farmerCode: farmer.farmer_code,
      phone: farmer.phone,
      currentBalance: farmer.currentBalance,
    },
    entries: entries.map((t) => ({
      id: t._id,
      litres: t.litres,
      payout: t.payout,
      collectionDate: t.collectionDate,
      collectionShift: t.collectionShift,
      receiptNum: t.receipt_num,
      status: t.status,
      recordedAt: t.timestamp_server,
      porterId: t.porter_id,
      zone: t.zone,
      corrected: Boolean(t.metadata?.correctedAt),
      correctionCount: Array.isArray(t.metadata?.corrections)
        ? t.metadata.corrections.length
        : 0,
    })),
  };
};

/**
 * Correct one milk transaction for a farmer.
 * Body is farmer-scoped: transactionId must belong to that farmer.
 */
const correctMilkEntry = async ({
  farmerId,
  cooperativeId,
  userId,
  transactionId,
  litres,
  collectionDate = null,
  collectionShift = null,
  reason = '',
  resendSms = false,
}) => {
  if (!transactionId) throw new Error('transactionId is required');
  const litresNum = parseFloat(litres);
  if (!Number.isFinite(litresNum) || litresNum <= 0) {
    throw new Error('litres must be a positive number');
  }
  if (collectionDate && !isValidDateString(collectionDate)) {
    throw new Error('Invalid collectionDate (YYYY-MM-DD)');
  }
  if (collectionShift && !['AM', 'PM'].includes(String(collectionShift).toUpperCase())) {
    throw new Error('collectionShift must be AM or PM');
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const fid = new mongoose.Types.ObjectId(farmerId);

    const cooperative = await Cooperative.findById(coopId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    const farmer = await Farmer.findOne({
      _id: fid,
      cooperativeId: coopId,
      isActive: true,
    }).session(session);
    if (!farmer) throw new Error('Farmer not found or inactive');

    const transaction = await Transaction.findOne({
      _id: transactionId,
      farmer_id: fid,
      cooperativeId: coopId,
      type: 'milk',
    }).session(session);

    if (!transaction) {
      throw new Error('Milk transaction not found for this farmer');
    }
    if (transaction.status === 'failed') {
      throw new Error('Cannot correct a failed transaction');
    }

    const oldLitres = Number(transaction.litres) || 0;
    const oldPayout = round2(Number(transaction.payout) || 0);

    const effectiveDate = collectionDate || transaction.collectionDate || getKenyaDateString();
    const effectiveShift = collectionShift
      ? String(collectionShift).toUpperCase()
      : transaction.collectionShift || 'AM';

    // Rate: prefer original rate version day, then active rate for effective date
    let rate = null;
    let rateVersionId = transaction.rate_version_id || null;
    const rateInfo = await getActiveRateVersion(cooperativeId, 'milk', effectiveDate);
    if (rateInfo && rateInfo.rate > 0) {
      rate = rateInfo.rate;
      rateVersionId = rateInfo.rate_version_id || rateVersionId;
    }
    if (!rate || rate <= 0) {
      // Fallback: implied rate from original entry
      rate = oldLitres > 0 ? oldPayout / oldLitres : 0;
    }
    if (!rate || rate <= 0) {
      throw new Error('Cannot resolve milk rate for correction');
    }

    const newPayout = round2(litresNum * rate);
    const deltaPayout = round2(newPayout - oldPayout);
    const deltaLitres = round2(litresNum - oldLitres);

    // Latest wallet from ledger (source of truth)
    const lastLedger = await Ledger.findOne({
      cooperativeId: coopId,
      farmerId: fid,
    })
      .sort({ timestamp: -1, _id: -1 })
      .session(session)
      .lean();

    const previousBalance = lastLedger
      ? round2(lastLedger.runningBalance)
      : round2(farmer.currentBalance || 0);
    const newBalance = round2(previousBalance + deltaPayout);

    // ── Update transaction metrics ─────────────────────────
    const priorMeta = transaction.metadata && typeof transaction.metadata === 'object'
      ? { ...transaction.metadata }
      : {};
    const corrections = Array.isArray(priorMeta.corrections) ? [...priorMeta.corrections] : [];
    corrections.push({
      at: new Date().toISOString(),
      by: userId,
      reason: reason || '',
      oldLitres,
      newLitres: litresNum,
      oldPayout,
      newPayout,
      deltaPayout,
      rate,
    });

    transaction.litres = litresNum;
    transaction.payout = newPayout;
    transaction.collectionDate = effectiveDate;
    transaction.collectionShift = effectiveShift;
    if (rateVersionId) transaction.rate_version_id = rateVersionId;
    transaction.metadata = {
      ...priorMeta,
      correctedAt: new Date().toISOString(),
      correctedBy: userId,
      correctionReason: reason || '',
      corrections,
    };
    // Keep wallet_balance_after as historical snapshot of original post;
    // live wallet is Farmer.currentBalance + ledger.
    await transaction.save({ session });

    let ledgerEntry = null;
    if (Math.abs(deltaPayout) >= 0.01) {
      const [created] = await Ledger.create(
        [
          {
            cooperativeId: coopId,
            farmerId: fid,
            transactionId: transaction._id,
            type: 'REVERSAL',
            amount: deltaPayout, // signed: + credit farmer, − debit farmer
            runningBalance: newBalance,
            description: `Milk correction ${transaction.receipt_num || transaction._id} (${oldLitres}L→${litresNum}L)`,
            reference: transaction.receipt_num || String(transaction._id),
            createdBy: userId,
            metadata: {
              correction: true,
              originalTransactionId: String(transaction._id),
              oldLitres,
              newLitres: litresNum,
              oldPayout,
              newPayout,
              deltaPayout,
              rate,
              reason: reason || '',
            },
            timestamp: new Date(),
          },
        ],
        { session }
      );
      ledgerEntry = created;

      const updated = await updateFarmerBalance(
        fid,
        newBalance,
        ledgerEntry._id,
        session,
        { cooperativeId: coopId }
      );
      if (!updated) {
        // Soft path: force update without optimistic currentBalance match
        await Farmer.findOneAndUpdate(
          { _id: fid, cooperativeId: coopId },
          { $set: { currentBalance: newBalance, lastLedgerId: ledgerEntry._id } },
          { session }
        );
      }
    }

    // Porter volume totals (best-effort)
    if (transaction.porter_id && Math.abs(deltaLitres) >= 0.001) {
      await Porter.findByIdAndUpdate(
        transaction.porter_id,
        { $inc: { 'totals.litresCollected': deltaLitres } },
        { session }
      );
    }

    await session.commitTransaction();
    session.endSession();

    // ── Optional SMS (outside transaction) ─────────────────
    let smsQueued = false;
    if (resendSms && farmer.phone) {
      try {
        const cumulative = await getCumulativeMilk({
          farmerId: fid,
          cooperativeId: coopId,
          asOfDate: effectiveDate,
          asOfShift: effectiveShift,
        });
        const message = receiptFormatter.formatMilkReceipt({
          cooperativeName: cooperative.name,
          receiptNumber: transaction.receipt_num,
          farmerName: farmer.name,
          farmerCode: farmer.farmer_code || farmer.code || '',
          litres: litresNum,
          payout: newPayout,
          walletBalance: newBalance,
          cumulativeMilk: cumulative?.litres,
          collectionDate: effectiveDate,
          collectionShift: effectiveShift,
        });
        await smsService.queueSMS({
          to: farmer.phone,
          message,
          type: 'milk_receipt',
          cooperativeId: coopId,
          farmerId: fid,
          metadata: {
            correction: true,
            transactionId: String(transaction._id),
          },
        });
        smsQueued = true;
      } catch (smsErr) {
        logger.warn('Milk correction SMS failed', { error: smsErr.message });
      }
    }

    logger.info('Milk entry corrected', {
      farmerId: String(fid),
      transactionId: String(transaction._id),
      oldLitres,
      newLitres: litresNum,
      oldPayout,
      newPayout,
      deltaPayout,
      newBalance,
    });

    return {
      success: true,
      farmerId: fid,
      transactionId: transaction._id,
      oldLitres,
      newLitres: litresNum,
      oldPayout,
      newPayout,
      deltaPayout,
      deltaLitres,
      balanceAfter: newBalance,
      ledgerEntryId: ledgerEntry?._id || null,
      smsQueued,
      collectionDate: effectiveDate,
      collectionShift: effectiveShift,
    };
  } catch (error) {
    await session.abortTransaction().catch(() => {});
    session.endSession();
    throw error;
  }
};

module.exports = {
  listFarmerMilkEntries,
  correctMilkEntry,
};