const dashboardService = require('../services/dashboardService');
const logger = require('../utils/logger');

const getSummary = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const summary = await dashboardService.getSummary(cooperativeId);
    res.json(summary);
  } catch (error) {
    logger.error('Summary failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

// ... existing endpoints (getFinancial, getAnalytics, etc.)

const getFinancial = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const financial = await dashboardService.getFinancial(cooperativeId);
    res.json(financial);
  } catch (error) {
    logger.error('Financial failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const cooperativeId = req.user.cooperativeId;
    const analytics = await dashboardService.getAnalytics(period, cooperativeId);
    res.json(analytics);
  } catch (error) {
    logger.error('Analytics failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getDevices = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const devices = await dashboardService.getDevices(cooperativeId);
    res.json(devices);
  } catch (error) {
    logger.error('Devices failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getAlerts = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;  // ✅ FIXED
    const alerts = await dashboardService.getAlerts(cooperativeId);
    res.json(alerts);
  } catch (error) {
    logger.error('Alerts failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};


const getInventory = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;  // ✅ FIXED
    const inventory = await dashboardService.getInventory(cooperativeId);
    res.json(inventory);
  } catch (error) {
    logger.error('Inventory failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getCompleteOverview = async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const cooperativeId = req.user.cooperativeId;  // ✅ FIXED
    const overview = await dashboardService.getCompleteOverview(period, cooperativeId);
    res.json(overview);
  } catch (error) {
    logger.error('Overview failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};



// ✅ NEW ENDPOINTS
const getCEOStats = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const stats = await dashboardService.getCEOStats(cooperativeId);
    res.json(stats);
  } catch (error) {
    logger.error('CEOStats failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getIntelligence = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const intelligence = await dashboardService.getIntelligence(cooperativeId);
    res.json(intelligence);
  } catch (error) {
    logger.error('Intelligence failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getSystemOverview = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const overview = await dashboardService.getSystemOverview(cooperativeId);
    res.json(overview);
  } catch (error) {
    logger.error('SystemOverview failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

const getTasks = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const tasks = await dashboardService.getTasks(cooperativeId);
    res.json(tasks);
  } catch (error) {
    logger.error('Tasks failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getSummary, getFinancial, getAnalytics, getDevices, getAlerts, getInventory, getCompleteOverview,
  getCEOStats, getIntelligence, getSystemOverview, getTasks  // ✅ NEW
};