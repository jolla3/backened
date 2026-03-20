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
const updateInventoryCategory = async (itemId, updates, adminId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  // ✅ FLEXIBLE UPDATES - stock, unit, threshold, price
  const updateFields = {};
  
  if (updates.price !== undefined) {
    updateFields.price = Number(updates.price);
  }
  if (updates.stock !== undefined) {
    updateFields.stock = Number(updates.stock);
  }
  if (updates.unit !== undefined) {
    updateFields.unit = updates.unit.trim();
  }
  if (updates.threshold !== undefined) {
    updateFields.threshold = Number(updates.threshold);
  }

  if (Object.keys(updateFields).length === 0) {
    throw new Error('No valid fields to update');
  }

  const result = await Inventory.updateOne(
    { 
      _id: itemId, 
      cooperativeId: cooperative._id
    },
    { 
      $set: { 
        ...updateFields,
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
    itemName: updatedItem.name,
    category: updatedItem.category,
    changes: updateFields,
    newStock: updatedItem.stock,
    newPrice: updatedItem.price
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
// ✅ PROPER SERVICE
const getCurrentPrices = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const milkRate = await RateVersion.findOne({ 
    type: 'milk', 
    cooperativeId: cooperative._id 
  })
  .sort({ effective_date: -1 })
  .lean();
  
  const categories = await Inventory.aggregate([
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
    { $sort: { _id: 1 } }
  ]);
  
  return { 
    milkRate, 
    categories,
    totalItems: categories.reduce((sum, cat) => sum + (cat.itemCount || 0), 0)
  };
};

module.exports = { 
  updateMilkRate, 
  updateInventoryCategory, 
  getMilkHistory, 
  getInventoryCategories, 
  getCurrentPrices 
};