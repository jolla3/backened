const mongoose = require('mongoose');
const RateVersion = require('../models/rateVersion');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// Milk rates (historical versions)
const updateMilkRate = async (rate, effectiveDate, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const newVersion = await RateVersion.create({
    type: 'milk',
    rate,
    effective_date: new Date(effectiveDate),
    admin_id: adminId,
    cooperativeId: cooperative._id
  });
  
  logger.info('Milk rate updated', { rate, adminId });
  return newVersion;
};

// Inventory category pricing (PATCH existing items)
const updateInventoryCategoryPrice = async (category, price, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ PATCH all items in category
  const result = await Inventory.updateMany(
    { 
      category, 
      cooperativeId: cooperative._id 
    },
    { 
      $set: { 
        price: Number(price),
        updated_by: adminId 
      }
    }
  );
  
  if (result.modifiedCount === 0) {
    throw new Error(`No items found in category "${category}"`);
  }
  
  logger.info('Inventory category price updated', { 
    category, 
    price, 
    modifiedCount: result.modifiedCount,
    adminId 
  });
  
  return { 
    success: true, 
    modifiedCount: result.modifiedCount,
    category,
    price 
  };
};

// Get milk rate history
const getMilkHistory = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  return await RateVersion.find({ 
    type: 'milk', 
    cooperativeId: cooperative._id 
  }).sort({ effective_date: -1 });
};

// Get inventory categories
const getInventoryCategories = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  return await Inventory.distinct('category', { 
    cooperativeId: cooperative._id 
  });
};

// Get current prices by category
const getCurrentPrices = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const milkRate = await RateVersion.findOne({ 
    type: 'milk', 
    cooperativeId: cooperative._id 
  }).sort({ effective_date: -1 });
  
  const categories = await Inventory.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    {
      $group: {
        _id: '$category',
        avgPrice: { $avg: '$price' },
        itemCount: { $sum: 1 },
        items: { $push: { name: '$name', price: '$price', stock: '$stock' } }
      }
    }
  ]);
  
  return { milkRate, categories };
};

module.exports = { 
  updateMilkRate, 
  updateInventoryCategoryPrice, 
  getMilkHistory, 
  getInventoryCategories, 
  getCurrentPrices 
};