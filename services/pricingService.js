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

const updateInventoryCategoryPrice = async (category, price, adminId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  
  const result = await Inventory.updateMany(
    { category, cooperativeId: cooperative._id },
    { $set: { price: Number(price), updated_by: adminId } }
  );
  
  if (result.modifiedCount === 0) {
    throw new Error(`No items found in category "${category}"`);
  }
  
  return { success: true, modifiedCount: result.modifiedCount, category, price };
};

// ✅ GET methods only need cooperativeId
const getMilkHistory = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  return RateVersion.find({ type: 'milk', cooperativeId: cooperative._id })
    .sort({ effective_date: -1 });
};

const getInventoryCategories = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  return Inventory.distinct('category', { cooperativeId: cooperative._id });
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