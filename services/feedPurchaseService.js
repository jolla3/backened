const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const purchaseFeed = async (farmerId, productId, quantity, rate, adminId, session) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const product = await Inventory.findById(productId).session(session);
  if (!product) throw new Error('Product not found');
  if (product.stock < quantity) throw new Error('Insufficient stock');

  // Verify product belongs to admin's cooperative
  if (product.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Product does not belong to your cooperative');
  }

  const cost = quantity * rate;
  const farmer = await Transaction.findOne({ farmer_id: farmerId }).session(session);

  const transaction = await Transaction.create([{
    type: 'feed',
    quantity,
    cost,
    farmer_id: farmerId,
    device_id: 'system',
    status: 'completed',
    idempotency_key: `feed-${Date.now()}-${farmerId}`,
    cooperativeId: cooperative._id
  }], { session });

  product.stock -= quantity;
  await product.save({ session });

  logger.info('Feed purchased', { farmerId, quantity, cost, cooperativeId: cooperative._id });
  return transaction[0];
};

module.exports = { purchaseFeed };