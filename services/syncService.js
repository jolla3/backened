const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Inventory = require('../models/inventory');
const RateVersion = require('../models/rateVersion');
const Cooperative = require('../models/cooperative');
const Ledger = require('../models/ledger');
const { updateFarmerBalance } = require('../utils/ledgerUtils');
const { getActiveRateVersion } = require('../services/transactionService');
const { parseKenyaDate, isValidDateString } = require('../utils/dateUtils');
const logger = require('../utils/logger');

/**
 * Reconcile a batch of offline deltas (milk/feed transactions) with full financial logic.
 * This replicates the same accounting flow as addManualMilkEntry().
 */
const reconcileDeltas = async (batch, cooperativeId, session) => {
  const cooperative = await Cooperative.findById(cooperativeId).session(session);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  const results = [];
  const conflicts = [];

  for (const delta of batch) {
    try {
      // ── 1. Idempotency check ──────────────────────────────
      const existing = await Transaction.findOne({
        idempotency_key: delta.idempotency_key,
      }).session(session);

      if (existing) {
        results.push({
          idempotency_key: delta.idempotency_key,
          status: 'duplicate',
          data: existing,
        });
        continue;
      }

      // ── 2. Basic validation ──────────────────────────────
      if ((delta.litres != null && delta.litres < 0) || (delta.quantity != null && delta.quantity < 0)) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: 'negative_value',
        });
        continue;
      }

      if (
        delta.cooperativeId &&
        delta.cooperativeId.toString() !== cooperative._id.toString()
      ) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: 'cooperative_mismatch',
        });
        continue;
      }

      // ── 3. Determine collection date ──────────────────────
      // Use delta.collectionDate if available, else fallback to timestamp_local or today.
      let collectionDate = delta.collectionDate;
      if (!collectionDate) {
        if (delta.timestamp_local) {
          const d = new Date(delta.timestamp_local);
          collectionDate = d.toISOString().split('T')[0];
        } else {
          collectionDate = new Date().toISOString().split('T')[0];
        }
      }

      // Validate collection date
      if (!isValidDateString(collectionDate)) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: 'invalid_collection_date',
        });
        continue;
      }

      // ── 4. Resolve rate based on collection date ──────────
      let rateInfo;
      try {
        rateInfo = await getActiveRateVersion(
          cooperative._id,
          delta.type || 'milk',
          collectionDate
        );
      } catch (err) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: `rate_error: ${err.message}`,
        });
        continue;
      }

      if (!rateInfo || !rateInfo.rate) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: 'no_rate_found',
        });
        continue;
      }

      // ── 5. Calculate payout/amount on the server ──────────
      let amount = 0;
      const type = delta.type || 'milk';

      if (type === 'milk') {
        const litres = Number(delta.litres) || 0;
        amount = litres * rateInfo.rate;
      } else if (type === 'feed') {
        const quantity = Number(delta.quantity) || 0;
        // For feed, you might have a separate price lookup – but here we use the rate as fallback
        // In a real system, feed items have their own prices from inventory.
        // We'll assume delta.price is sent, or use rate.
        amount = quantity * (delta.price || rateInfo.rate);
      } else {
        amount = Number(delta.payout) || Number(delta.amount) || 0;
      }

      // ── 6. Create Transaction ──────────────────────────────
      const transactionData = {
        receipt_num: delta.receipt_num || `SYNC-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        status: 'completed',
        server_seq_num: delta.server_seq_num || `SYNC-${cooperativeId}-${Date.now()}`,
        timestamp_local: new Date(delta.timestamp_local || collectionDate),
        timestamp_server: new Date(),
        type,
        litres: delta.litres || 0,
        quantity: delta.quantity || 0,
        payout: amount,
        cost: type === 'feed' ? amount : 0,
        farmer_id: delta.farmer_id || null,
        porter_id: delta.porter_id || null,
        rate_version_id: rateInfo.rate_version_id,
        cooperativeId: cooperative._id,
        zoneId: delta.zoneId || null,
        zone: delta.zone || '',
        collectionDate,
        collectionShift: delta.collectionShift || 'AM',
        createdBy: delta.createdBy || null, // optional
        entryMethod: 'pos', // or 'sync'
        idempotency_key: delta.idempotency_key,
        // Additional fields from client (e.g., device_id, etc.) can be added carefully
        device_id: delta.device_id || null,
        device_seq_num: delta.device_seq_num || 0,
        qr_hash: delta.qr_hash || null,
        digital_signature: delta.digital_signature || null,
      };

      const [tx] = await Transaction.create([transactionData], { session });

      // ── 7. Financial processing (milk only, but can extend to feed) ──
      if (type === 'milk' && delta.farmer_id) {
        // ── 7a. Get farmer ──────────────────────────────────
        const farmer = await Farmer.findById(delta.farmer_id).session(session);
        if (!farmer) {
          conflicts.push({
            idempotency_key: delta.idempotency_key,
            reason: 'farmer_not_found',
          });
          // We still have a transaction, but we'll roll back later
          continue;
        }

        // ── 7b. Calculate new balance ──────────────────────
        const previousBalance = farmer.currentBalance || 0;
        const newBalance = previousBalance + amount;

        // ── 7c. Create Ledger Entry ────────────────────────
        const [ledgerEntry] = await Ledger.create([{
          cooperativeId: cooperative._id,
          farmerId: farmer._id,
          transactionId: tx._id,
          type: 'MILK_CREDIT',
          amount: amount,
          runningBalance: newBalance,
          description: `Milk delivery ${tx.receipt_num} (sync)`,
          reference: tx.receipt_num,
          createdBy: delta.createdBy || null,
          metadata: {
            litres: delta.litres || 0,
            rate: rateInfo.rate,
            rate_version_id: rateInfo.rate_version_id,
            porter_id: delta.porter_id || null,
            collectionShift: delta.collectionShift || 'AM',
            collectionDate,
          },
          timestamp: new Date(),
        }], { session });

        // ── 7d. Update Farmer balance ──────────────────────
        await updateFarmerBalance(farmer._id, newBalance, ledgerEntry._id, session);

        // ── 7e. Update Porter totals ──────────────────────
        if (delta.porter_id) {
          await Porter.findByIdAndUpdate(
            delta.porter_id,
            {
              $inc: {
                'totals.litresCollected': delta.litres || 0,
                'totals.transactionsCount': 1,
              }
            },
            { session }
          );
        }
      }

      // ── 8. Feed processing (inventory) ────────────────────
      if (type === 'feed' && delta.product_id) {
        const product = await Inventory.findById(delta.product_id).session(session);
        if (product) {
          product.stock = (product.stock || 0) - (Number(delta.quantity) || 0);
          await product.save({ session });
        }
        // For feed, you might also want a ledger entry (FEED_DEBIT) if it's on balance.
        // We'll leave that for future enhancement.
      }

      results.push({
        idempotency_key: delta.idempotency_key,
        status: 'success',
        data: tx,
      });

    } catch (error) {
      conflicts.push({
        idempotency_key: delta.idempotency_key,
        reason: error.message,
      });
    }
  }

  logger.info('Reconciliation completed', {
    success: results.length,
    conflicts: conflicts.length,
    cooperativeId: cooperative._id,
  });

  return { results, conflicts };
};

module.exports = { reconcileDeltas };