// services/monitoringService.js
const { getDateRange } = require('./monitoring/helpers');
const { getDashboardKPIs } = require('./monitoring/dashboard');
const { getGraphData } = require('./monitoring/graphs');
const { getZoneAnalytics } = require('./monitoring/zones');
const { getFarmerRanking, getFarmerDetails: getFarmerDetailsFromFarmers } = require('./monitoring/farmers');
const { getPorterRanking } = require('./monitoring/porters');
const { getSessionComparison } = require('./monitoring/sessions');
const { getForecast } = require('./monitoring/forecast');
const { getAlerts } = require('./monitoring/alerts');
const { getExportData, toCSV } = require('./monitoring/export');
const { getDailyFarmers, getDailyInventory, getFarmerPerformance, getFarmerPurchases } = require('./monitoring/dailyFarmers');
const logger = require('../utils/logger');

// ─── All functions ───────────────────────────────────────────────
const getDashboard = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, zone = null, session = 'all') => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getDashboardKPIs(cooperativeId, range, zone, session);
  } catch (error) {
    logger.error('Monitoring dashboard failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getGraphs = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, zone = null, session = 'all') => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getGraphData(cooperativeId, range, zone, session);
  } catch (error) {
    logger.error('Monitoring graphs failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getZones = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, zone = null) => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getZoneAnalytics(cooperativeId, range, zone);
  } catch (error) {
    logger.error('Monitoring zones failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getFarmers = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, limit = 20, sortBy = 'litres') => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getFarmerRanking(cooperativeId, range, parseInt(limit), sortBy);
  } catch (error) {
    logger.error('Monitoring farmers failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getFarmerDetails = async (cooperativeId, farmerId, period = 'today', date = null, startDate = null, endDate = null) => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getFarmerDetailsFromFarmers(cooperativeId, farmerId, range);
  } catch (error) {
    logger.error('Monitoring farmer details failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getFarmerPerformanceData = async (cooperativeId, farmerId, days = 30) => {
  try {
    return await getFarmerPerformance(cooperativeId, farmerId, parseInt(days));
  } catch (error) {
    logger.error('Monitoring farmer performance failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getFarmerPurchasesData = async (cooperativeId, farmerId, date = null) => {
  try {
    const dateObj = date ? new Date(date) : new Date();
    return await getFarmerPurchases(cooperativeId, farmerId, dateObj);
  } catch (error) {
    logger.error('Farmer purchases failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getPorters = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, limit = 10) => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getPorterRanking(cooperativeId, range, parseInt(limit));
  } catch (error) {
    logger.error('Monitoring porters failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getSessions = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, zone = null) => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    return await getSessionComparison(cooperativeId, range, zone);
  } catch (error) {
    logger.error('Monitoring sessions failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getDailyFarmerList = async (cooperativeId, date = null) => {
  try {
    const dateObj = date ? new Date(date) : new Date();
    return await getDailyFarmers(cooperativeId, dateObj);
  } catch (error) {
    logger.error('Daily farmer list failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getDailyInventoryTransactions = async (cooperativeId, date = null) => {
  try {
    const dateObj = date ? new Date(date) : new Date();
    return await getDailyInventory(cooperativeId, dateObj);
  } catch (error) {
    logger.error('Daily inventory failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getForecastData = async (cooperativeId) => {
  try {
    return await getForecast(cooperativeId);
  } catch (error) {
    logger.error('Monitoring forecast failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const getAlertsData = async (cooperativeId) => {
  try {
    return await getAlerts(cooperativeId);
  } catch (error) {
    logger.error('Monitoring alerts failed', { error: error.message, cooperativeId });
    throw error;
  }
};

const exportData = async (cooperativeId, period = 'today', date = null, startDate = null, endDate = null, zone = null, session = 'all', format = 'csv') => {
  try {
    const range = getDateRange(period, date, startDate, endDate);
    const data = await getExportData(cooperativeId, range, zone, session);
    if (format === 'json') return data;
    return toCSV(data);
  } catch (error) {
    logger.error('Monitoring export failed', { error: error.message, cooperativeId });
    throw error;
  }
};

module.exports = {
  getDashboard,
  getGraphs,
  getZones,
  getFarmers,
  getFarmerDetails,
  getFarmerPerformanceData,
  getFarmerPurchasesData,
  getPorters,
  getSessions,
  getDailyFarmerList,
  getDailyInventoryTransactions,
  getForecastData,
  getAlertsData,
  exportData,
};