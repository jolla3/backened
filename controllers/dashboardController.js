const dashboardService = require('../services/dashboardService');
const logger = require('../utils/logger');

const getSummary = async (req, res) => {
  try {
    const summary = await dashboardService.getSummary();
    res.json(summary);
  } catch (error) {
    logger.error('Summary failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getFinancial = async (req, res) => {
  try {
    const financial = await dashboardService.getFinancial();
    res.json(financial);
  } catch (error) {
    logger.error('Financial failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getAnalytics = async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const analytics = await dashboardService.getAnalytics(period);
    res.json(analytics);
  } catch (error) {
    logger.error('Analytics failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getDevices = async (req, res) => {
  try {
    const devices = await dashboardService.getDevices();
    res.json(devices);
  } catch (error) {
    logger.error('Devices failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getAlerts = async (req, res) => {
  try {
    const alerts = await dashboardService.getAlerts();
    res.json(alerts);
  } catch (error) {
    logger.error('Alerts failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getInventory = async (req, res) => {
  try {
    const inventory = await dashboardService.getInventory();
    res.json(inventory);
  } catch (error) {
    logger.error('Inventory failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getCompleteOverview = async (req, res) => {
  try {
    const { period = 'daily' } = req.query;
    const overview = await dashboardService.getCompleteOverview(period);
    res.json(overview);
  } catch (error) {
    logger.error('Overview failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getSummary,
  getFinancial,
  getAnalytics,
  getDevices,
  getAlerts,
  getInventory,
  getCompleteOverview
};