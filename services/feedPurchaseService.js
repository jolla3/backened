const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

const purchaseFeed = async (farmerId, productId, quantity, rate, session) => {
  const product = await Inventory.findById(productId).session(session);
  if (!product) throw new Error('Product not found');
  if (product.stock < quantity) throw new Error('Insufficient stock');

  const cost = quantity * rate;
  const farmer = await Transaction.findOne({ farmer_id: farmerId }).session(session);

  const transaction = await Transaction.create([{
    type: 'feed',
    quantity,
    cost,
    farmer_id: farmerId,
    device_id: 'system',
    status: 'completed',
    idempotency_key: `feed-${Date.now()}-${farmerId}`
  }], { session });

  product.stock -= quantity;
  await product.save({ session });

  logger.info('Feed purchased', { farmerId, quantity, cost });
  return transaction[0];
};

module.exports = { purchaseFeed };