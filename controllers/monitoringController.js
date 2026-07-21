// controllers/monitoringController.js
const monitoringService = require('../services/monitoringService');
const logger = require('../utils/logger');

/**
 * GET /monitoring/dashboard
 */
const getDashboard = async (req, res) => {
  try {
    const { period, date, startDate, endDate, zone, session } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getDashboard(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      zone,
      session
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Dashboard error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/graphs
 */
const getGraphs = async (req, res) => {
  try {
    const { period, date, startDate, endDate, zone, session } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getGraphs(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      zone,
      session
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Graphs error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/zones
 */
const getZones = async (req, res) => {
  try {
    const { period, date, startDate, endDate, zone } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getZones(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      zone
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Zones error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/farmers
 */
const getFarmers = async (req, res) => {
  try {
    const { period, date, startDate, endDate, limit = 20, sortBy = 'litres' } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getFarmers(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      limit,
      sortBy
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Farmers error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/farmers/:id/details
 */
const getFarmerDetails = async (req, res) => {
  try {
    const { period, date, startDate, endDate } = req.query;
    const cooperativeId = req.user.cooperativeId;
    const farmerId = req.params.id;

    const data = await monitoringService.getFarmerDetails(
      cooperativeId,
      farmerId,
      period,
      date,
      startDate,
      endDate
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Farmer details error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/farmers/:id/performance
 */
const getFarmerPerformance = async (req, res) => {
  try {
    const { id } = req.params;
    const { days = 30 } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getFarmerPerformanceData(
      cooperativeId,
      id,
      days
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Farmer performance error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/farmers/:id/purchases
 */
const getFarmerPurchases = async (req, res) => {
  try {
    const { id } = req.params;
    const { date } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getFarmerPurchasesData(
      cooperativeId,
      id,
      date
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Farmer purchases error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/porters
 */
const getPorters = async (req, res) => {
  try {
    const { period, date, startDate, endDate, limit = 10 } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getPorters(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      limit
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Porters error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/sessions
 */
const getSessions = async (req, res) => {
  try {
    const { period, date, startDate, endDate, zone } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getSessions(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      zone
    );

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Sessions error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/daily-farmers
 */
const getDailyFarmers = async (req, res) => {
  try {
    const { date } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getDailyFarmerList(cooperativeId, date);

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Daily farmers error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/daily-inventory
 */
const getDailyInventory = async (req, res) => {
  try {
    const { date } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getDailyInventoryTransactions(cooperativeId, date);

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Daily inventory error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/forecast
 */
const getForecast = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getForecastData(cooperativeId);

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Forecast error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/alerts
 */
const getAlerts = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.getAlertsData(cooperativeId);

    res.json({ success: true, data });
  } catch (error) {
    logger.error('Alerts error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

/**
 * GET /monitoring/export
 */
const exportData = async (req, res) => {
  try {
    const { period, date, startDate, endDate, zone, session, format = 'csv' } = req.query;
    const cooperativeId = req.user.cooperativeId;

    const data = await monitoringService.exportData(
      cooperativeId,
      period,
      date,
      startDate,
      endDate,
      zone,
      session,
      format
    );

    if (format === 'json') {
      return res.json({ success: true, data });
    }

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=milk_collection_${new Date().toISOString().slice(0,10)}.csv`);
    res.send(data);
  } catch (error) {
    logger.error('Export error', { error: error.message, cooperativeId: req.user.cooperativeId });
    res.status(500).json({ success: false, error: error.message });
  }
};

module.exports = {
  getDashboard,
  getGraphs,
  getZones,
  getFarmers,
  getFarmerDetails,
  getFarmerPerformance,
  getFarmerPurchases,
  getPorters,
  getSessions,
  getDailyFarmers,
  getDailyInventory,
  getForecast,
  getAlerts,
  exportData,
};