// controllers/zoneController.js
const zoneService = require('../services/zoneService');
const logger = require('../utils/logger');

/**
 * POST /zones
 * Create a new zone
 */
const createZone = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const zone = await zoneService.createZone(req.body, cooperativeId);
    res.status(201).json({ success: true, data: zone });
  } catch (error) {
    logger.error('Create zone error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * GET /zones
 * Get all zones for the cooperative
 */
const getAllZones = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const zones = await zoneService.getAllZones(cooperativeId);
    res.json({ success: true, data: zones });
  } catch (error) {
    logger.error('Get all zones error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /zones/active
 * Get only active zones
 */
const getActiveZones = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const zones = await zoneService.getActiveZones(cooperativeId);
    res.json({ success: true, data: zones });
  } catch (error) {
    logger.error('Get active zones error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /zones/:id
 * Get a single zone by ID
 */
const getZoneById = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const zone = await zoneService.getZoneById(req.params.id, cooperativeId);
    res.json({ success: true, data: zone });
  } catch (error) {
    logger.error('Get zone error', { error: error.message, zoneId: req.params.id, cooperativeId: req.user.cooperativeId });
    res.status(404).json({ success: false, error: error.message });
  }
};

/**
 * PUT /zones/:id
 * Update a zone
 */
const updateZone = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const zone = await zoneService.updateZone(req.params.id, req.body, cooperativeId);
    res.json({ success: true, data: zone });
  } catch (error) {
    logger.error('Update zone error', { error: error.message, zoneId: req.params.id, cooperativeId: req.user.cooperativeId });
    res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * DELETE /zones/:id
 * Delete a zone (soft delete)
 */
const deleteZone = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const result = await zoneService.deleteZone(req.params.id, cooperativeId);
    res.json({ success: true, data: result });
  } catch (error) {
    logger.error('Delete zone error', { error: error.message, zoneId: req.params.id, cooperativeId: req.user.cooperativeId });
    res.status(404).json({ success: false, error: error.message });
  }
};

module.exports = {
  createZone,
  getAllZones,
  getActiveZones,
  getZoneById,
  updateZone,
  deleteZone,
};