const mongoose = require('mongoose');
const RateVersion = require('../models/rateVersion');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// ✅ SIMPLIFIED - Only needs adminId for audit trail, cooperativeId from controller
const updateMilkRate = async (rate, effectiveDate, adminId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const newVersion = await RateVersion.create({
    type: 'milk',
    rate,
    effective_date: new Date(effectiveDate),
    admin_id: adminId,
    cooperativeId: cooperative._id
  });
  
  return newVersion;
};

// ✅ NEW: Update SINGLE inventory item by ID
const updateInventoryCategoryPrice = async (itemId, price, adminId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const result = await Inventory.updateOne(
    { 
      _id: itemId, 
      cooperativeId: cooperative._id  // Security: only own coop items
    },
    { 
      $set: { 
        price: Number(price),
        updated_by: adminId,
        updatedAt: new Date()
      } 
    }
  );
  
  if (result.modifiedCount === 0) {
    throw new Error('Item not found or no changes made');
  }
  
  // Return updated item
  const updatedItem = await Inventory.findById(itemId).lean();
  return { 
    success: true, 
    itemId, 
    newPrice: Number(price),
    itemName: updatedItem.name,
    category: updatedItem.category 
  };
};

// ✅ GET methods only need cooperativeId
const getMilkHistory = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  return RateVersion.find({ type: 'milk', cooperativeId: cooperative._id })
    .sort({ effective_date: -1 });
};

// Get inventory categories WITH items grouped by category
const getInventoryCategories = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ NEW: Return categories + ALL items grouped by category
  return await Inventory.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    {
      $group: {
        _id: '$category',
        items: {
          $push: {
            _id: '$_id',
            name: '$name',
            price: '$price',
            stock: '$stock',
            unit: '$unit',
            threshold: '$threshold'
          }
        },
        itemCount: { $sum: 1 },
        avgPrice: { $avg: '$price' }
      }
    },
    { $sort: { _id: 1 } } // Sort categories alphabetically
  ]);
};
const getCurrentPrices = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const milkRate = await RateVersion.findOne({ 
    type: 'milk', cooperativeId: cooperative._id 
  }).sort({ effective_date: -1 });
  
  const categories = await Inventory.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    {
      $group: {
        _id: '$category',
        avgPrice: { $avg: '$price' },
        itemCount: { $sum: 1 }
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