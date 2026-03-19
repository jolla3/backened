const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getInventory = async (cooperativeId) => {
  return await Inventory.find({ 
    cooperativeId,
    stock: { $gt: 0 } 
  })
  .sort({ name: 1 })
  .populate('created_by', 'name email')
  .lean();
};

const getAlerts = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId });
  if (!cooperative) throw new Error('Cooperative not found');

  // ✅ FIXED: Proper aggregation for low stock alerts
  return await Inventory.aggregate([
    { $match: { 
        cooperativeId: cooperative._id,
        stock: { $gt: 0 }
      } 
    },
    { $match: { 
        $expr: { $lte: ['$stock', '$threshold'] } 
      }
    },
    { $sort: { stock: 1 } },
    { $limit: 10 }
  ]);
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

module.exports = { getInventory, getAlerts, createProduct, deductStock };