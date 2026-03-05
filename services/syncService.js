const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Inventory = require('../models/inventory');
const RateVersion = require('../models/rateVersion');
const logger = require('../utils/logger');

const reconcileDeltas = async (batch, session) => {
  const results = [];
  const conflicts = [];

  for (const delta of batch) {
    try {
      // Idempotency check
      const existing = await Transaction.findOne({ idempotency_key: delta.idempotency_key });
      if (existing) {
        results.push({ idempotency_key: delta.idempotency_key, status: 'duplicate', data: existing });
        continue;
      }

      // Validate data
      if (delta.litres < 0 || delta.quantity < 0) {
        conflicts.push({ idempotency_key: delta.idempotency_key, reason: 'negative_value' });
        continue;
      }

      // Get current rate
      const rate = await RateVersion.findOne({ type: delta.type }).sort({ effective_date: -1 });
      if (!rate) throw new Error('No rate found');

      // Create transaction
      const tx = await Transaction.create([{
        ...delta,
        rate_version_id: rate._id,
        status: 'completed',
        timestamp_server: new Date()
      }], { session });

      // Update farmer balance
      if (delta.type === 'milk') {
        const farmer = await Farmer.findById(delta.farmer_id).session(session);
        if (farmer) {
          farmer.balance += delta.payout;
          farmer.history.push(tx[0]._id);
          await farmer.save({ session });
        }
      }

      // Update inventory
      if (delta.type === 'feed') {
        const product = await Inventory.findById(delta.product_id).session(session);
        if (product) {
          product.stock -= delta.quantity;
          await product.save({ session });
        }
      }

      results.push({ idempotency_key: delta.idempotency_key, status: 'success', data: tx[0] });
    } catch (error) {
      conflicts.push({ idempotency_key: delta.idempotency_key, reason: error.message });
    }
  }

  return { results, conflicts };
};

module.exports = { reconcileDeltas };