const Inventory = require('../models/inventory');
const logger = require('../utils/logger');

const deductStock = async (productId, quantity, adminId) => {
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

const getAlerts = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  return await Inventory.find({ 
    cooperativeId: cooperative._id,
    stock: { $lte: '$threshold' } 
  });
};

const createProduct = async (data, adminId) => {
  const { cooperativeId, ...productData } = data;
  const cooperative = await Cooperative.findById(adminId);
  
  if (cooperativeId !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot create in another cooperative');
  }

  return await Inventory.create({ ...productData, cooperativeId, created_by: adminId });
};

module.exports = { deductStock, getAlerts, createProduct };