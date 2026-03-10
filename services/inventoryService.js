const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

const deductStock = async (productId, quantity) => {
  const session = await Inventory.startSession();
  session.startTransaction();
  try {
    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error('Product not found');
    if (product.stock < quantity) throw new Error('Insufficient stock');

    product.stock -= quantity;
    await product.save({ session });
    
    await session.commitTransaction();
    return product;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getAlerts = async () => {
  return await Inventory.find({ stock: { $lte: '$threshold' } });
};

const createProduct = async (data) => {
  return await Inventory.create(data);
};

module.exports = { deductStock, getAlerts, createProduct };