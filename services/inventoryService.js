const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative'); // ✅ Keep this import
const logger = require('../utils/logger');

const getInventory = async (cooperativeId) => {
  try {
    // ✅ Get all inventory for this cooperative
    const inventory = await Inventory.find({ 
      cooperativeId,
      stock: { $gt: 0 } // Only active stock
    }).sort({ name: 1 }).lean(); // lean() for better performance
    
    logger.debug('Inventory fetched', { 
      cooperativeId, 
      count: inventory.length 
    });
    
    return inventory;
  } catch (error) {
    logger.error('Get inventory service failed', { error: error.message, cooperativeId });
    throw new Error('Failed to fetch inventory');
  }
};

const deductStock = async (productId, quantity, adminId) => {
  const session = await Inventory.startSession();
  session.startTransaction();
  try {
    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error('Product not found');
    if (product.stock < quantity) throw new Error('Insufficient stock');

    product.stock -= quantity;
    product.updated_by = adminId;
    product.updated_at = new Date();
    
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
  // ✅ FIXED: Use cooperativeId from token, not adminId
  const cooperative = await Cooperative.findOne({ adminId });
  
  if (!cooperative) {
    throw new Error('Cooperative not found for admin');
  }

  return await Inventory.find({ 
    cooperativeId: cooperative._id,
    stock: { $lte: '$threshold' } // Low stock alerts
  }).lean();
};

const createProduct = async (data, adminId) => {
  const { cooperativeId, name, quantity, unit, threshold, ...rest } = data;
  
  // ✅ FIXED: Use cooperativeId from data (passed from controller), validate it exists
  if (!cooperativeId) {
    throw new Error('Cooperative ID is required');
  }

  // Optional: Validate cooperative exists and admin belongs to it
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) {
    throw new Error('Invalid cooperative ID');
  }

  // Create product with proper fields
  const product = new Inventory({
    name: name.trim(),
    stock: parseInt(quantity) || 0,
    unit,
    threshold: parseInt(threshold) || 0,
    cooperativeId,
    created_by: adminId,
    updated_by: adminId,
    ...rest
  });

  const savedProduct = await product.save();
  return savedProduct;
};

module.exports = { 
  getInventory, 
  deductStock, 
  getAlerts, 
  createProduct 
};