const mongoose = require('mongoose');
const crypto = require('crypto');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const { queueSMS } = require('../services/smsService');
const { formatDeductionReceipt } = require('../utils/receiptFormatter'); // adjust path
const logger = require('../utils/logger');

const ALLOWED_REASONS = {
  feeds: 'FEED_DEBIT',
  loan: 'LOAN',
  interest: 'INTEREST',
  penalty: 'PENALTY',
  debt: 'MANUAL_ADJUSTMENT',
  other: 'MANUAL_ADJUSTMENT',
};

function generateReference() {
  return `DED-${Date.now()}-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;
}

/**
 * Manual farmer balance deduction.
 *
 * Architecture:
 *   Authenticated user → cooperativeId + adminId
 *   → validate farmer
 *   → calculate amount (feeds = product price × qty, else supplied amount)
 *   → read latest Ledger (source of truth)
 *   → create NEGATIVE Ledger entry
 *   → optimistic update of Farmer.currentBalance cache
 *   → commit
 *   → format receipt → queue SMS
 *
 * Inventory is never modified.
 */
async function createManualDeduction({
  farmerId,
  reason,
  amount,
  productId,
  quantity,
  description = '',
  cooperativeId,
  adminId,
}) {
  if (!farmerId || !reason || !cooperativeId || !adminId) {
    throw new Error('farmerId, reason, cooperativeId and adminId are required');
  }

  const normalizedReason = String(reason).toLowerCase().trim();
  const ledgerType = ALLOWED_REASONS[normalizedReason];
  if (!ledgerType) {
    throw new Error(
      `Invalid reason. Allowed values: ${Object.keys(ALLOWED_REASONS).join(', ')}`
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    // ─── Cooperative ──────────────────────────────────────
    const cooperative = await Cooperative.findById(cooperativeId)
      .select('name allowNegativeBalances')
      .session(session);

    if (!cooperative) {
      throw new Error('Cooperative not found');
    }

    const allowNeg = cooperative.allowNegativeBalances === true;

    // ─── Farmer ───────────────────────────────────────────
    const farmer = await Farmer.findOne({
      _id: farmerId,
      cooperativeId,
      isActive: true,
    }).session(session);

    if (!farmer) {
      throw new Error(
        'Farmer not found, inactive, or does not belong to this cooperative'
      );
    }

    // ─── Amount calculation ───────────────────────────────
    let deductionAmount = 0;
    let metadata = {
      reason: normalizedReason,
      description: description || undefined,
    };
    let productSnapshot = null;

    if (normalizedReason === 'feeds') {
      if (!productId || quantity == null) {
        throw new Error('productId and quantity are required for feed deductions');
      }

      const qty = Number(quantity);
      if (!Number.isFinite(qty) || qty <= 0) {
        throw new Error('quantity must be a positive number');
      }

      const product = await Inventory.findOne({
        _id: productId,
        cooperativeId,
        deleted: { $ne: true },
      }).session(session);

      if (!product) {
        throw new Error('Product not found or does not belong to this cooperative');
      }

      const unitPrice = Number(product.price);
      if (!Number.isFinite(unitPrice) || unitPrice < 0) {
        throw new Error('Invalid product price in database');
      }

      // Exact value – never round here
      deductionAmount = qty * unitPrice;

      productSnapshot = {
        productId: product._id,
        productName: product.name,
        quantity: qty,
        unitPrice,
        unit: product.unit,
      };

      metadata = {
        reason: 'feeds',
        ...productSnapshot,
        description: description || undefined,
      };
    } else {
      if (amount == null) {
        throw new Error('amount is required for non-feed deductions');
      }
      deductionAmount = Number(amount);
      if (!Number.isFinite(deductionAmount) || deductionAmount <= 0) {
        throw new Error('amount must be a positive number');
      }
    }

    // ─── Ledger is source of truth ────────────────────────
    const lastLedger = await Ledger.findOne({
      farmerId: farmer._id,
      cooperativeId,
    })
      .sort({ timestamp: -1, _id: -1 })
      .session(session);

    const previousBalance = lastLedger ? lastLedger.runningBalance : 0;
    const newBalance = previousBalance - deductionAmount;

    if (!allowNeg && newBalance < 0) {
      throw new Error('Insufficient farmer balance');
    }

    // ─── Create Ledger entry (NEGATIVE, full precision) ───
    const reference = generateReference();
    const [ledgerEntry] = await Ledger.create(
      [
        {
          cooperativeId,
          farmerId: farmer._id,
          type: ledgerType,
          amount: -deductionAmount,
          runningBalance: newBalance,
          description: description || `${normalizedReason} deduction`,
          reference,
          createdBy: adminId,
          metadata,
          timestamp: new Date(),
        },
      ],
      { session }
    );

    // ─── Optimistic concurrency on Farmer cache ───────────
    // Succeeds only if currentBalance still equals the value
    // we used to compute the new ledger runningBalance.
    // If another concurrent request already changed it → null → abort.
    const updated = await Farmer.findOneAndUpdate(
      {
        _id: farmer._id,
        cooperativeId,
        currentBalance: previousBalance,
      },
      {
        $set: {
          currentBalance: newBalance,
          lastLedgerId: ledgerEntry._id,
        },
      },
      { session, new: false }
    );

    if (!updated) {
      throw new Error(
        'Concurrent modification detected. Please retry the deduction.'
      );
    }

    // ─── COMMIT ───────────────────────────────────────────
    await session.commitTransaction();

    // ─── SMS after commit (using formatter) ───────────────
    let smsQueued = false;
    try {
      const receipt = formatDeductionReceipt({
        cooperativeName: cooperative.name,
        farmerCode: farmer.farmer_code,
        reason: normalizedReason,
        amount: deductionAmount,
        walletBalance: newBalance,
        productName: productSnapshot?.productName,
        quantity: productSnapshot?.quantity,
        unit: productSnapshot?.unit,
      });

      if (farmer.phone) {
        await queueSMS({
          to: farmer.phone,
          message: receipt.sms,
          type: 'balance_deduction',
          cooperativeId,
          farmerId: farmer._id,
          metadata: {
            ledgerId: ledgerEntry._id,
            reference,
            reason: normalizedReason,
          },
        });
        smsQueued = true;
      }
    } catch (smsErr) {
      logger.error('SMS queue failed after successful deduction', {
        error: smsErr.message,
        farmerId,
        ledgerId: ledgerEntry._id,
        cooperativeId,
      });
    }

    return {
      success: true,
      deduction: {
        amount: deductionAmount,
        reason: normalizedReason,
        type: ledgerType,
      },
      farmer: {
        id: farmer._id,
        name: farmer.name,
        farmer_code: farmer.farmer_code,
        previousBalance,
        newBalance,
      },
      ledgerEntry: {
        id: ledgerEntry._id,
        reference: ledgerEntry.reference,
      },
      smsQueued,
    };
  } catch (err) {
    await session.abortTransaction();
    logger.error('Manual deduction failed – rolled back', {
      error: err.message,
      farmerId,
      reason: normalizedReason,
      cooperativeId,
    });
    throw err;
  } finally {
    session.endSession();
  }
}

module.exports = { createManualDeduction };