const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Inventory = require('../models/inventory');
const RateVersion = require('../models/rateVersion');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const reconcileDeltas = async (batch, cooperativeId, session) => {
  const cooperative = await Cooperative.findById(cooperativeId).session(session);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  const results = [];
  const conflicts = [];

  for (const delta of batch) {
    try {
      // Idempotency check
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

      // Basic validation
      if ((delta.litres != null && delta.litres < 0) || (delta.quantity != null && delta.quantity < 0)) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: 'negative_value',
        });
        continue;
      }

      // Cooperative scoping (if client still sends it)
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

      // Get current rate for this cooperative + type
      const rate = await RateVersion.findOne({
        type: delta.type,
        cooperativeId: cooperative._id,
      })
        .sort({ effective_date: -1 })
        .session(session);

      if (!rate) {
        conflicts.push({
          idempotency_key: delta.idempotency_key,
          reason: 'no_rate_found',
        });
        continue;
      }

      // =====================================================
      // CRITICAL: Calculate amount on the server
      // Never trust delta.payout / delta.amount from the phone
      // =====================================================
      let amount = 0;

      if (delta.type === 'milk') {
        const litres = Number(delta.litres) || 0;
        amount = litres * (rate.rate || rate.price || rate.amount || 0);
      } else if (delta.type === 'feed') {
        const quantity = Number(delta.quantity) || 0;
        amount = quantity * (rate.rate || rate.price || rate.amount || 0);
      } else {
        // fallback if you have other types
        amount = Number(delta.payout) || Number(delta.amount) || 0;
      }

      // Create the transaction
      const [tx] = await Transaction.create(
        [
          {
            ...delta,
            amount,                       // server-calculated
            payout: amount,               // keep both fields consistent if needed
            rate_version_id: rate._id,
            status: 'completed',
            timestamp_server: new Date(),
            cooperativeId: cooperative._id,
            // deliberately overwrite any client-supplied payout
          },
        ],
        { session }
      );

      // Update farmer balance (milk)
      if (delta.type === 'milk' && delta.farmer_id) {
        const farmer = await Farmer.findById(delta.farmer_id).session(session);
        if (farmer) {
          farmer.balance = (farmer.balance || 0) + amount;
          await farmer.save({ session });
        }
      }

      // Update inventory (feed)
      if (delta.type === 'feed' && delta.product_id) {
        const product = await Inventory.findById(delta.product_id).session(session);
        if (product) {
          product.stock = (product.stock || 0) - (Number(delta.quantity) || 0);
          await product.save({ session });
        }
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