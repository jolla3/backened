const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

const deductStock = async (productId, quantity, session) => {
  const product = await Inventory.findById(productId).session(session);
  if (!product) throw new Error('Product not found');
  if (product.stock < quantity) throw new Error('Insufficient stock');

  product.stock -= quantity;
  await product.save({ session });
  return product;
};

const getAlerts = async () => {
  return await Inventory.find({ stock: { $lte: '$threshold' } });
};

const createProduct = async (data) => {
  return await Inventory.create(data);
};

module.exports = { deductStock, getAlerts, createProduct };