// controllers/porterController.js
const porterService = require('../services/porterService');
const logger = require('../utils/logger');

// ─── CRUD (unchanged) ──────────────────────────────────────
const createPorter = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    if (!cooperativeId) return res.status(400).json({ error: 'Cooperative ID missing from token' });
    const porter = await porterService.createPorter(req.body, cooperativeId);
    logger.info('Porter created', { porterId: porter._id, cooperativeId, correlationId: req.correlationId || 'unknown' });
    res.status(201).json(porter);
  } catch (error) {
    logger.error('Create porter failed', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

const getPorter = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const porter = await porterService.getPorter(req.params.id, cooperativeId);
    res.json(porter);
  } catch (error) {
    logger.error('Get porter failed', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

const getAllPorters = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const porters = await porterService.getAllPorters(cooperativeId);
    res.json({ success: true, porters });
  } catch (error) {
    logger.error('Get all porters failed', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

const updatePorter = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const porter = await porterService.updatePorter(req.params.id, req.body, cooperativeId);
    logger.info('Porter updated', { porterId: porter._id, correlationId: req.correlationId || 'unknown' });
    res.json(porter);
  } catch (error) {
    logger.error('Update porter failed', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

const deletePorter = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const result = await porterService.deletePorter(req.params.id, cooperativeId);
    logger.info('Porter deleted', { porterId: req.params.id, correlationId: req.correlationId || 'unknown' });
    res.json(result);
  } catch (error) {
    logger.error('Delete porter failed', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

// ─── PERFORMANCE (legacy) ──────────────────────────────────
const getPerformance = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { period = 'monthly', groupBy } = req.query;
    const performance = await porterService.getPerformance(req.params.id, cooperativeId, period, groupBy);
    res.json(performance);
  } catch (error) {
    logger.error('Get performance failed', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

// ─── NEW PERFORMANCE ENDPOINTS ─────────────────────────────

const getSummary = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { period = 'weekly' } = req.query;
    const data = await porterService.getPerformanceSummary(req.params.id, cooperativeId, period);
    res.json(data);
  } catch (error) {
    logger.error('Performance summary error', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

const getTrends = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { period = 'weekly', granularity = 'day' } = req.query;
    const data = await porterService.getPerformanceTrends(req.params.id, cooperativeId, period, granularity);
    res.json(data);
  } catch (error) {
    logger.error('Performance trends error', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

const getFarmers = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { period = 'weekly', limit = 20 } = req.query;
    const data = await porterService.getPerformanceFarmers(req.params.id, cooperativeId, period, parseInt(limit, 10));
    res.json(data);
  } catch (error) {
    logger.error('Performance farmers error', { error: error.message, correlationId: req.correlationId || 'unknown' });
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createPorter,
  getPorter,
  getAllPorters,
  updatePorter,
  deletePorter,
  getPerformance,     // legacy
  getSummary,
  getTrends,
  getFarmers
};