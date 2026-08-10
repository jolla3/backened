const mongoose = require('mongoose');
const RateVersion = require('../models/rateVersion');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');
const { parseKenyaDate, isValidDateString } = require('../utils/dateUtils');

// ─── Update milk rate with effective date ────────────────────
const updateMilkRate = async (rate, adminId, cooperativeId, effectiveDate) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  if (!rate || Number(rate) <= 0) {
    throw new Error('Valid milk rate is required');
  }

  if (!effectiveDate) {
    throw new Error('effectiveDate is required');
  }

  if (!isValidDateString(effectiveDate)) {
    throw new Error('Invalid effective date. Expected YYYY-MM-DD with a real date.');
  }

  const effectiveDateTime = parseKenyaDate(effectiveDate);

  const newVersion = await RateVersion.create({
    type: 'milk',
    rate: Number(rate),
    effective_date: effectiveDateTime,
    admin_id: adminId,
    cooperativeId: cooperative._id
  });

  return newVersion;
};

// ─── Update inventory item ──────────────────────────────────
const updateInventoryCategory = async (itemId, updates, adminId, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

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
    { _id: itemId, cooperativeId: cooperative._id },
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

// ─── Get milk rate history (latest first) ──────────────────
const getMilkHistory = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  return RateVersion.find({ type: 'milk', cooperativeId: cooperative._id })
    .sort({ effective_date: -1, _id: -1 });
};

// ─── Get inventory categories ──────────────────────────────
const getInventoryCategories = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

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
    { $sort: { _id: 1 } }
  ]);
};

// ─── Get current prices (latest rate) ──────────────────────
const getCurrentPrices = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const milkRate = await RateVersion.findOne({
    type: 'milk',
    cooperativeId: cooperative._id
  })
    .sort({ effective_date: -1, _id: -1 })
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