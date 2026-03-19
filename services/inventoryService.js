const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// ✅ FIXED: Single service that returns BOTH arrays
const getInventory = async (cooperativeId) => {
  // Get ALL inventory
  const allInventory = await Inventory.find({ 
    cooperativeId,
    stock: { $gte: 0 }  // Only non-deleted items
  })
  .sort({ createdAt: -1 })
  .populate('created_by', 'name')
  .lean();

  // ✅ FIXED: Get LOW STOCK directly from same query (no separate getAlerts needed)
  const lowStock = allInventory.filter(item => 
    item.threshold > 0 && item.stock <= item.threshold
  ).sort((a, b) => a.stock - b.stock); // Sort by lowest stock first

  return {
    inventory: allInventory,  // ALL items
    lowStock: lowStock        // ONLY low stock items
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
    if (product.stock < quantity) throw new Error('Insufficient stock');

    product.stock -= parseInt(quantity);
    product.updated_by = adminId;
    product.updatedAt = new Date();
    
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

module.exports = { getInventory,  createProduct, deductStock };