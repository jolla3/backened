const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getInventory = async (cooperativeId) => {
  const allInventory = await Inventory.find({ 
    cooperativeId,
    stock: { $gte: 0 }
  })
  .sort({ createdAt: -1 })
  .populate('created_by', 'name')
  .lean();

  const lowStock = allInventory.filter(item => 
    item.threshold > 0 && item.stock <= item.threshold
  ).sort((a, b) => a.stock - b.stock);

  return {
    inventory: allInventory,
    lowStock: lowStock
  };
};

const createProduct = async (data, adminId) => {
  const { cooperativeId, name, category, stock, price, threshold, unit } = data;
  
  if (!cooperativeId) throw new Error('Cooperative ID required');
  
  const product = new Inventory({
    name: name.trim(),
    category,
    stock: parseInt(stock) || 0,
    price: parseFloat(price) || 0,
    threshold: parseInt(threshold) || 0,
    unit: unit?.trim() || 'unit',
    cooperativeId,
    created_by: adminId,
    updated_by: adminId
  });

  return await product.save();
};

// ✅ FIXED: Simple stock update - NO full document validation
const deductStock = async (productId, quantity, adminId) => {
  const session = await Inventory.startSession();
  session.startTransaction();
  
  try {
    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error('Product not found');
    
    if (product.stock < quantity) {
      throw new Error(`Insufficient stock: ${product.stock} available`);
    }

    // ✅ SIMPLE STOCK UPDATE - no full validation needed
    product.stock -= quantity;
    product.updated_by = adminId;
    product.updatedAt = new Date();
    
    await product.save({ session });
    await session.commitTransaction();
    
    logger.info('Stock deducted', {
      productId,
      productName: product.name,
      quantity,
      newStock: product.stock,
      adminId
    });
    
    return product;
  } catch (error) {
    await session.abortTransaction();
    logger.error('Deduct stock service failed', { error: error.message });
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = { getInventory, createProduct, deductStock };