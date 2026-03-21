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

const deductStock = async (productId, quantity, adminId) => {
  const session = await Inventory.startSession();
  session.startTransaction();
  
  try {
    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error('Product not found');
    
    if (product.stock < quantity) {
      throw new Error(`Insufficient stock: ${product.stock} available`);
    }

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

// ✅ NEW: Soft delete - set stock to -1 (deleted flag)
const deleteProduct = async (productId, adminId) => {
  const session = await Inventory.startSession();
  session.startTransaction();
  
  try {
    const product = await Inventory.findById(productId).session(session);
    if (!product) throw new Error('Product not found');
    
    if (product.stock > 0) {
      throw new Error('Cannot delete product with stock > 0. Deduct stock first.');
    }

    // ✅ SOFT DELETE: Set stock to -1 (deleted flag)
    product.stock = -1;
    product.deleted = true;
    product.deletedAt = new Date();
    product.deleted_by = adminId;
    product.updated_by = adminId;
    product.updatedAt = new Date();
    
    await product.save({ session });
    await session.commitTransaction();
    
    logger.info('Product soft deleted', {
      productId,
      productName: product.name,
      adminId
    });
    
    return { 
      success: true, 
      message: 'Product deleted successfully',
      productId 
    };
  } catch (error) {
    await session.abortTransaction();
    logger.error('Delete product service failed', { error: error.message });
    throw error;
  } finally {
    session.endSession();
  }
};

module.exports = { getInventory, createProduct, deductStock, deleteProduct };