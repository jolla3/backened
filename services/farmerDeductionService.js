const mongoose = require('mongoose');
const crypto = require('crypto');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const { queueSMS } = require('../services/smsService');
const { formatDeductionReceipt } = require('../utils/receiptFormatter');
const { updateFarmerBalance } = require('../utils/ledgerUtils');
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
 * Supports multiple products for feed deductions.
 * Inventory is READ-ONLY: product price is used for calculation.
 * No stock is deducted – this is purely a financial transaction.
 */
async function createManualDeduction({
  farmerId,
  reason,
  amount,
  items,
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
    if (!cooperative) throw new Error('Cooperative not found');
    const allowNeg = cooperative.allowNegativeBalances === true;

    // ─── Farmer ───────────────────────────────────────────
    const farmer = await Farmer.findOne({
      _id: farmerId,
      cooperativeId,
      isActive: true,
    }).session(session);
    if (!farmer) {
      throw new Error('Farmer not found, inactive, or does not belong to this cooperative');
    }

    // ─── Amount calculation ───────────────────────────────
    let deductionAmount = 0;
    let productSnapshots = [];
    let metadata = { reason: normalizedReason, description: description || undefined };

    if (normalizedReason === 'feeds') {
      // ─── Validate items ──────────────────────────────────
      if (!items || !Array.isArray(items) || items.length === 0) {
        throw new Error('For feed deductions, provide an `items` array with productId and quantity');
      }

      for (const [idx, item] of items.entries()) {
        if (!item || typeof item !== 'object') {
          throw new Error(`Item at index ${idx} must be an object`);
        }
        if (!item.productId) {
          throw new Error(`Item at index ${idx} is missing productId`);
        }
        if (item.quantity == null || item.quantity === '') {
          throw new Error(`Item at index ${idx} is missing quantity`);
        }
      }

      const productIds = items.map(item => String(item.productId));
      const dupCheck = new Set(productIds);
      if (dupCheck.size !== productIds.length) {
        throw new Error('Duplicate product IDs are not allowed');
      }

      for (const id of productIds) {
        if (!mongoose.Types.ObjectId.isValid(id)) {
          throw new Error(`Invalid product ID: ${id}`);
        }
      }

      // ─── Fetch products (READ ONLY) ──────────────────────
      const products = await Inventory.find({
        _id: { $in: productIds },
        cooperativeId,
        deleted: { $ne: true },
      })
        .select('name price unit')
        .session(session);

      const productMap = new Map(products.map(p => [p._id.toString(), p]));

      for (const item of items) {
        const productId = String(item.productId);
        const product = productMap.get(productId);
        if (!product) {
          throw new Error(`Product ${productId} not found or does not belong to this cooperative`);
        }

        const qty = Number(item.quantity);
        if (!Number.isFinite(qty) || qty <= 0) {
          throw new Error(`Invalid quantity for product ${product.name}`);
        }

        const unitPrice = Number(product.price);
        if (!Number.isFinite(unitPrice) || unitPrice < 0) {
          throw new Error(`Invalid price for product ${product.name}`);
        }

        const itemTotal = qty * unitPrice;
        deductionAmount += itemTotal;

        productSnapshots.push({
          productId: product._id,
          productName: product.name,
          quantity: qty,
          unitPrice,
          unit: product.unit || 'unit',
          itemTotal,
        });
      }

      metadata = {
        reason: 'feeds',
        items: productSnapshots,
        description: description || undefined,
      };
    } else {
      // ─── Non-feed deduction ──────────────────────────────
      if (amount == null) throw new Error('amount is required for non-feed deductions');
      deductionAmount = Number(amount);
      if (!Number.isFinite(deductionAmount) || deductionAmount <= 0) {
        throw new Error('amount must be a positive number');
      }
    }

    // ─── Ledger balance calculation ──────────────────────
    const previousBalance = farmer.currentBalance || 0;
    const newBalance = previousBalance - deductionAmount;

    if (!allowNeg && newBalance < 0) {
      throw new Error('Insufficient farmer balance');
    }

    // ─── Create ONE Ledger entry ────────────────────────────
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

    // ─── Update Farmer cache using ledgerUtil ─────────────
    const updatedFarmer = await updateFarmerBalance(
      farmer._id,
      newBalance,
      ledgerEntry._id,
      session,
      { currentBalance: previousBalance }
    );

    if (!updatedFarmer) {
      throw new Error('Concurrent modification detected. Please retry the deduction.');
    }

    await session.commitTransaction();

    // ─── SMS after commit ──────────────────────────────────
    let smsQueued = false;
    try {
      let receipt;
      if (normalizedReason === 'feeds' && productSnapshots.length > 0) {
        receipt = formatDeductionReceipt({
          cooperativeName: cooperative.name,
          farmerName: farmer.name,
          farmerCode: farmer.farmer_code,
          reason: normalizedReason,
          amount: deductionAmount,
          walletBalance: newBalance,
          items: productSnapshots,
        });
      } else {
        receipt = formatDeductionReceipt({
          cooperativeName: cooperative.name,
          farmerName: farmer.name,
          farmerCode: farmer.farmer_code,
          reason: normalizedReason,
          amount: deductionAmount,
          walletBalance: newBalance,
        });
      }

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

    // ─── Response ────────────────────────────────────────────
    const response = {
      success: true,
      deduction: {
        amount: deductionAmount,
        reason: normalizedReason,
        type: ledgerType,
        reference,
      },
      farmer: {
        id: farmer._id,
        name: farmer.name,
        farmer_code: farmer.farmer_code,
        previousBalance,
        newBalance,
      },
      items: productSnapshots.length > 0 ? productSnapshots : undefined,
      ledgerEntry: {
        id: ledgerEntry._id,
        reference: ledgerEntry.reference,
      },
      smsQueued,
    };

    return response;
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