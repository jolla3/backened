// services/bulkSmsService.js
/**
 * Bulk SMS Service
 * 
 * Sends SMS to multiple farmers efficiently:
 * - Queue SMS for multiple farmers
 * - Handle deduplication
 * - Generate deterministic idempotency keys
 * - Batch operations
 * - Prevent duplicate sending
 * 
 * Each farmer gets their OWN SMS message (not one giant SMS).
 * Messages are queued asynchronously; actual sending happens in the worker.
 */
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const OutboundSms = require('../models/OutboundSms');
const Ledger = require('../models/ledger');
const smsService = require('./smsService');
const { normalizePhone } = require('../utils/phoneUtils');
const { formatMilkReceipt } = require('../utils/receiptFormatterExtended');
const { getCumulativeMilkForFarmers } = require('./cumulativeMilkService');
const logger = require('../utils/logger');
const {
  SMS_TYPES,
  SMS_PRIORITY,
  IDEMPOTENCY_KEY_PREFIX,
} = require('../constants/smsConstants');

/**
 * Send milk receipt SMS to farmers for a collection round
 * 
 * Usage: After collecting milk from a group of farmers,
 *        call this to queue receipt SMS for all.
 * 
 * @param {ObjectId} cooperativeId - Cooperative ID
 * @param {string} collectionDate - Date collected (YYYY-MM-DD)
 * @param {string} collectionShift - 'AM' or 'PM'
 * @param {object} options - Additional options
 * 
 * @returns {object} { queued, duplicates, failedToQueue, errors }
 */
const sendMilkReceiptsBatch = async (cooperativeId, collectionDate, collectionShift = 'AM', options = {}) => {
  if (!cooperativeId || !collectionDate) {
    throw new Error('cooperativeId and collectionDate are required');
  }

  const cooperative = await Cooperative.findById(cooperativeId).select('name').lean();
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  try {
    logger.info('Starting milk receipt batch send', {
      cooperativeId: cooperativeId.toString(),
      collectionDate,
      collectionShift,
    });

    // ── 1. Get all transactions for this collection ──────────
    const transactions = await Transaction.find({
      cooperativeId,
      collectionDate,
      collectionShift,
      type: 'milk',
      status: 'completed',
    })
      .populate('farmer_id', 'name farmer_code phone currentBalance isActive cooperativeId')
      .lean();

    if (transactions.length === 0) {
      logger.warn('No transactions found for batch', {
        cooperativeId: cooperativeId.toString(),
        collectionDate,
        collectionShift,
      });
      return {
        queued: 0,
        duplicates: 0,
        failedToQueue: 0,
        skipped: 0,
        errors: [],
      };
    }

    // ── 2. Get farmer IDs and fetch cumulative milk ─────────
    const farmerIds = transactions.map(tx => tx.farmer_id._id);
    const cumulativeMilkMap = await getCumulativeMilkForFarmers(
      farmerIds,
      cooperativeId,
      new Date(collectionDate)
    );

    // ── 3. Queue SMS for each transaction ────────────────────
    const results = {
      queued: 0,
      duplicates: 0,
      failedToQueue: 0,
      skipped: 0,
      errors: [],
    };

    for (const transaction of transactions) {
      try {
        const farmer = transaction.farmer_id;

        // Skip if farmer has no phone
        if (!farmer.phone) {
          results.skipped++;
          logger.debug('Skipped SMS: farmer has no phone', {
            farmerCode: farmer.farmer_code,
            farmerId: farmer._id.toString(),
          });
          continue;
        }

        // Skip inactive farmers
        if (!farmer.isActive) {
          results.skipped++;
          logger.debug('Skipped SMS: farmer inactive', {
            farmerCode: farmer.farmer_code,
            farmerId: farmer._id.toString(),
          });
          continue;
        }

        // Skip farmers from different cooperatives (should not happen, but check)
        if (farmer.cooperativeId.toString() !== cooperativeId.toString()) {
          results.skipped++;
          logger.warn('Skipped SMS: cooperative mismatch', {
            farmerCode: farmer.farmer_code,
            farmerId: farmer._id.toString(),
            expectedCoop: cooperativeId.toString(),
            actualCoop: farmer.cooperativeId.toString(),
          });
          continue;
        }

        // ── Build receipt message ──────────────────────────
        const cumulative = cumulativeMilkMap[farmer._id.toString()] || {
          litres: 0,
          transactionCount: 0,
        };

        const receipt = formatMilkReceipt({
          cooperativeName: cooperative.name,
          receiptNumber: transaction.receipt_num,
          farmerName: farmer.name,
          farmerCode: farmer.farmer_code || 'N/A',
          litres: transaction.litres,
          payout: transaction.payout,
          walletBalance: farmer.currentBalance,
          cumulativeMilk: cumulative.litres,
          collectionDate: _formatDateForReceipt(collectionDate),
          transactionDate: transaction.timestamp_server,
        });

        // ── Generate deterministic idempotency key ──────────
        // Key pattern: sms_milk_receipt:<transactionId>:<cooperativeId>
        const idempotencyKey = `${IDEMPOTENCY_KEY_PREFIX.MILK_RECEIPT}:${transaction._id.toString()}:${cooperativeId.toString()}`;

        // ── Queue SMS ──────────────────────────────────────
        const queueResult = await smsService.queueSMS({
          to: farmer.phone,
          message: receipt.sms,
          from: process.env.SMS_SENDER || cooperative.name,
          type: SMS_TYPES.MILK_RECEIPT,
          cooperativeId,
          farmerId: farmer._id,
          priority: SMS_PRIORITY.MILK_RECEIPT,
          idempotencyKey,
          metadata: {
            receiptNumber: transaction.receipt_num,
            litres: transaction.litres,
            payout: transaction.payout,
            transactionId: transaction._id.toString(),
            collectionDate,
            collectionShift,
          },
        });

        if (queueResult.duplicate) {
          results.duplicates++;
          logger.info('SMS already queued (duplicate prevention)', {
            farmerCode: farmer.farmer_code,
            farmerId: farmer._id.toString(),
            jobId: queueResult.jobId,
          });
        } else if (queueResult.queued) {
          results.queued++;
          logger.debug('SMS queued', {
            jobId: queueResult.jobId.toString(),
            farmerCode: farmer.farmer_code,
            phone: this._maskPhone(farmer.phone),
          });
        }

      } catch (error) {
        results.failedToQueue++;
        results.errors.push({
          farmerCode: transaction.farmer_id?.farmer_code || 'unknown',
          farmerId: transaction.farmer_id?._id?.toString() || 'unknown',
          error: error.message,
        });
        logger.error('Failed to queue SMS for farmer', {
          farmerCode: transaction.farmer_id?.farmer_code,
          farmerId: transaction.farmer_id?._id?.toString(),
          error: error.message,
        });
      }
    }

    logger.info('Milk receipt batch send complete', {
      ...results,
      totalTransactions: transactions.length,
      cooperativeId: cooperativeId.toString(),
      collectionDate,
    });

    return results;

  } catch (error) {
    logger.error('Milk receipt batch send failed', {
      cooperativeId: cooperativeId.toString(),
      collectionDate,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Send monthly summary SMS to farmers
 * Shows total milk, earnings, and deductions for the month
 * 
 * @param {ObjectId} cooperativeId - Cooperative ID
 * @param {number} year - Year (e.g., 2026)
 * @param {number} month - Month (1-12)
 * @param {object} options - Additional options
 * 
 * @returns {object} { queued, failedToQueue, errors }
 */
const sendMonthlySummaryBatch = async (cooperativeId, year, month, options = {}) => {
  if (!cooperativeId || !year || !month) {
    throw new Error('cooperativeId, year, and month are required');
  }

  if (month < 1 || month > 12) {
    throw new Error('month must be 1-12');
  }

  const cooperative = await Cooperative.findById(cooperativeId).select('name').lean();
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  try {
    logger.info('Starting monthly summary batch send', {
      cooperativeId: cooperativeId.toString(),
      year,
      month,
    });

    // ── Get all active farmers ───────────────────────────
    const farmers = await Farmer.find({
      cooperativeId,
      isActive: true,
      phone: { $exists: true, $ne: null },
    })
      .select('name farmer_code phone currentBalance')
      .lean();

    if (farmers.length === 0) {
      logger.warn('No active farmers found', { cooperativeId: cooperativeId.toString() });
      return { queued: 0, failedToQueue: 0, errors: [] };
    }

    // ── Build month boundaries ───────────────────────────
    const startDate = `${year}-${String(month).padStart(2, '0')}-01`;
    const lastDay = new Date(year, month, 0).getDate();
    const endDate = `${year}-${String(month).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

    // ── Get financial summary per farmer ─────────────────
    const results = {
      queued: 0,
      failedToQueue: 0,
      skipped: 0,
      errors: [],
    };

    for (const farmer of farmers) {
      try {
        // ── Get milk stats ───────────────────────────────
        const milkStats = await Transaction.aggregate([
          {
            $match: {
              farmer_id: farmer._id,
              cooperativeId,
              type: 'milk',
              collectionDate: { $gte: startDate, $lte: endDate },
              status: 'completed',
            },
          },
          {
            $group: {
              _id: null,
              totalLitres: { $sum: '$litres' },
              totalPayout: { $sum: '$payout' },
              transactionCount: { $sum: 1 },
            },
          },
        ]);

        const milkData = milkStats[0] || {
          totalLitres: 0,
          totalPayout: 0,
          transactionCount: 0,
        };

        // ── Get deductions (from ledger) ─────────────────
        const deductionStats = await Ledger.aggregate([
          {
            $match: {
              farmerId: farmer._id,
              cooperativeId,
              type: { $in: ['FEED_DEBIT', 'SETTLEMENT_DEBIT', 'PENALTY', 'INTEREST'] },
              timestamp: { $gte: new Date(startDate), $lte: new Date(endDate) },
            },
          },
          {
            $group: {
              _id: null,
              totalDeductions: { $sum: { $abs: '$amount' } },
            },
          },
        ]);

        const deductionData = deductionStats[0] || { totalDeductions: 0 };

        const netPayout = milkData.totalPayout - deductionData.totalDeductions;

        // ── Skip if no activity this month ───────────────
        if (milkData.transactionCount === 0 && deductionData.totalDeductions === 0) {
          results.skipped++;
          continue;
        }

        // ── Generate message ────────────────────────────
        const message = _formatMonthlySummaryMessage({
          cooperativeName: cooperative.name,
          farmerName: farmer.name,
          month,
          year,
          totalLitres: milkData.totalLitres,
          totalPayout: milkData.totalPayout,
          totalDeductions: deductionData.totalDeductions,
          netPayout,
          walletBalance: farmer.currentBalance,
        });

        // ── Generate idempotency key ─────────────────────
        const idempotencyKey = `${IDEMPOTENCY_KEY_PREFIX.MONTHLY_SUMMARY}:${farmer._id.toString()}:${year}${String(month).padStart(2, '0')}`;

        // ── Queue SMS ────────────────────────────────────
        const queueResult = await smsService.queueSMS({
          to: farmer.phone,
          message,
          from: process.env.SMS_SENDER || cooperative.name,
          type: SMS_TYPES.MONTHLY_SUMMARY,
          cooperativeId,
          farmerId: farmer._id,
          priority: SMS_PRIORITY.MONTHLY_SUMMARY,
          idempotencyKey,
          metadata: {
            year,
            month,
            totalLitres: milkData.totalLitres,
            totalPayout: milkData.totalPayout,
            totalDeductions: deductionData.totalDeductions,
          },
        });

        if (queueResult.queued && !queueResult.duplicate) {
          results.queued++;
        }

      } catch (error) {
        results.failedToQueue++;
        results.errors.push({
          farmerCode: farmer.farmer_code,
          farmerId: farmer._id.toString(),
          error: error.message,
        });
        logger.error('Failed to queue monthly summary SMS', {
          farmerId: farmer._id.toString(),
          error: error.message,
        });
      }
    }

    logger.info('Monthly summary batch send complete', {
      ...results,
      totalFarmers: farmers.length,
      cooperativeId: cooperativeId.toString(),
      year,
      month,
    });

    return results;

  } catch (error) {
    logger.error('Monthly summary batch send failed', {
      cooperativeId: cooperativeId.toString(),
      year,
      month,
      error: error.message,
    });
    throw error;
  }
};

/**
 * Helper: Format date for receipt display
 */
const _formatDateForReceipt = (dateString) => {
  // dateString is YYYY-MM-DD
  if (!dateString) return '';

  const [year, month, day] = dateString.split('-').map(Number);
  const date = new Date(year, month - 1, day);

  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(date);
};

/**
 * Helper: Format monthly summary message
 */
const _formatMonthlySummaryMessage = ({
  cooperativeName,
  farmerName,
  month,
  year,
  totalLitres,
  totalPayout,
  totalDeductions,
  netPayout,
  walletBalance,
}) => {
  const monthName = new Date(year, month - 1, 1).toLocaleString('en-KE', {
    timeZone: 'Africa/Nairobi',
    month: 'long',
  });

  const formatCurrency = (amount) => {
    return `KES ${Number(amount).toLocaleString('en-KE', {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    })}`;
  };

  return `${cooperativeName}\n\nMONTHLY SUMMARY\n\nDear ${farmerName},\n\n${monthName} ${year}\n\nMilk: ${Number(totalLitres).toFixed(1)}L\nEarnings: ${formatCurrency(totalPayout)}\nDeductions: ${formatCurrency(totalDeductions)}\nNet: ${formatCurrency(netPayout)}\n\nBalance: ${formatCurrency(walletBalance)}\n\nThank you.`;
};

/**
 * Helper: Mask phone for logging
 */
const _maskPhone = (phone) => {
  if (!phone || phone.length < 6) return phone;
  const start = phone.substring(0, 7);
  const end = phone.substring(phone.length - 2);
  return `${start}****${end}`;
};

module.exports = {
  sendMilkReceiptsBatch,
  sendMonthlySummaryBatch,
};