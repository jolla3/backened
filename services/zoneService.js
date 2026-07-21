// services/zoneService.js
const Zone = require('../models/zone');
const logger = require('../utils/logger');

/**
 * Create a new zone
 */
const createZone = async (data, cooperativeId) => {
  try {
    const zone = await Zone.create({
      ...data,
      cooperativeId,
    });
    logger.info('Zone created', { zoneId: zone._id, cooperativeId, name: zone.name });
    return zone;
  } catch (error) {
    logger.error('Create zone failed', { error: error.message, cooperativeId });
    throw error;
  }
};

/**
 * Get all zones for a cooperative
 */
const getAllZones = async (cooperativeId) => {
  try {
    const zones = await Zone.find({ cooperativeId })
      .sort({ name: 1 })
      .lean();
    return zones;
  } catch (error) {
    logger.error('Get all zones failed', { error: error.message, cooperativeId });
    throw error;
  }
};

/**
 * Get a zone by ID
 */
const getZoneById = async (zoneId, cooperativeId) => {
  try {
    const zone = await Zone.findOne({ _id: zoneId, cooperativeId });
    if (!zone) throw new Error('Zone not found');
    return zone;
  } catch (error) {
    logger.error('Get zone by ID failed', { error: error.message, zoneId, cooperativeId });
    throw error;
  }
};

/**
 * Update a zone
 */
const updateZone = async (zoneId, data, cooperativeId) => {
  try {
    const zone = await Zone.findOneAndUpdate(
      { _id: zoneId, cooperativeId },
      { $set: data },
      { new: true, runValidators: true }
    );
    if (!zone) throw new Error('Zone not found');
    logger.info('Zone updated', { zoneId, cooperativeId, name: zone.name });
    return zone;
  } catch (error) {
    logger.error('Update zone failed', { error: error.message, zoneId, cooperativeId });
    throw error;
  }
};

/**
 * Delete a zone (soft delete by setting isActive = false)
 */
const deleteZone = async (zoneId, cooperativeId) => {
  try {
    const zone = await Zone.findOneAndUpdate(
      { _id: zoneId, cooperativeId },
      { $set: { isActive: false } },
      { new: true }
    );
    if (!zone) throw new Error('Zone not found');
    logger.info('Zone deleted', { zoneId, cooperativeId, name: zone.name });
    return { message: 'Zone deleted successfully' };
  } catch (error) {
    logger.error('Delete zone failed', { error: error.message, zoneId, cooperativeId });
    throw error;
  }
};

/**
 * Get active zones only
 */
const getActiveZones = async (cooperativeId) => {
  try {
    const zones = await Zone.find({ cooperativeId, isActive: true })
      .sort({ name: 1 })
      .lean();
    return zones;
  } catch (error) {
    logger.error('Get active zones failed', { error: error.message, cooperativeId });
    throw error;
  }
};

module.exports = {
  createZone,
  getAllZones,
  getZoneById,
  updateZone,
  deleteZone,
  getActiveZones,
};