// services/dashboardService.js
const summaryLayer = require('./dashboardLayers/summaryLayer');
const financialLayer = require('./dashboardLayers/financialLayer');
const analyticsLayer = require('./dashboardLayers/analyticsLayer');
const deviceLayer = require('./dashboardLayers/deviceLayer');
const alertLayer = require('./dashboardLayers/alertLayer');
const inventoryLayer = require('./dashboardLayers/inventoryLayer');
const logger = require('../utils/logger');

// ✅ FIXED: All functions now accept adminId
// ✅ FIXED: Accept & pass cooperativeId everywhere
const getSummary = async (cooperativeId) => {
  try {
    return await summaryLayer.getSummary(cooperativeId);
  } catch (error) {
    logger.warn('Summary failed', { error: error.message, coopId: cooperativeId });
    return getDefaultSummary();
  }
};

const getFinancial = async (cooperativeId) => {
  try {
    return await financialLayer.getFinancial(cooperativeId);
  } catch (error) {
    logger.warn('Financial failed', { error: error.message, coopId: cooperativeId });
    return getDefaultFinancial();
  }
};

const getAnalytics = async (period = 'daily', cooperativeId) => {
  try {
    return await analyticsLayer.getAnalytics(period, cooperativeId);
  } catch (error) {
    logger.warn('Analytics failed', { error: error.message, coopId: cooperativeId });
    return getDefaultAnalytics();
  }
};

const getDevices = async (cooperativeId) => {
  try {
    return await deviceLayer.getDevices(cooperativeId);
  } catch (error) {
    logger.warn('Devices failed', { error: error.message, coopId: cooperativeId });
    return getDefaultDevices();
  }
};

const getAlerts = async (cooperativeId) => {
  try {
    return await alertLayer.getAlerts(cooperativeId);
  } catch (error) {
    logger.warn('Alerts failed', { error: error.message, coopId: cooperativeId });
    return getDefaultAlerts();
  }
};

const getInventory = async (cooperativeId) => {
  try {
    return await inventoryLayer.getInventory(cooperativeId);
  } catch (error) {
    logger.warn('Inventory failed', { error: error.message, coopId: cooperativeId });
    return getDefaultInventory();
  }
};

const getCompleteOverview = async (period = 'daily', cooperativeId) => {
  try {
    const [summary, financial, analytics, devices, alerts, inventory] = await Promise.all([
      getSummary(cooperativeId),
      getFinancial(cooperativeId),
      getAnalytics(period, cooperativeId),
      getDevices(cooperativeId),
      getAlerts(cooperativeId),
      getInventory(cooperativeId)
    ]);

    return {
      lastUpdated: new Date().toISOString(),
      summary,
      financial,
      analytics,
      devices,
      alerts,
      inventory
    };
  } catch (error) {
    logger.error('Overview failed', { error: error.message, coopId: cooperativeId });
    throw error;
  }
};
// ✅ Defaults (Keep as is)
const getDefaultSummary = () => ({
  milkToday: 0, milkYesterday: 0, milkThisWeek: 0, milkThisMonth: 0,
  milkChange: 0, farmersToday: 0, transactionsToday: 0,
  totalFarmers: 0, totalPorters: 0, totalDevices: 0
});

const getDefaultFinancial = () => ({
  milkRevenue: 0, feedRevenue: 0, netCashFlow: 0,
  profitMargin: null, hasRealData: false
});

const getDefaultAnalytics = () => ({
  milkTrends: [], porterPerformance: [], zoneProduction: [],
  topFarmer: null, lowestProducer: null, milkPrediction: null,
  graphReady: {
    milkTrendGraph: { labels: [], data: [], color: '#3498db' },
    feedTrendGraph: { labels: [], data: [], color: '#2ecc71' },
    porterTrendGraph: { labels: [], data: [], color: '#9b59b6' },
    farmerGrowthGraph: { labels: [], data: [], color: '#e74c3c' },
    zoneTrendGraph: { labels: [], data: [], color: '#f39c12' },
    peakHours: []
  }
});

const getDefaultDevices = () => ({
  health: [],
  summary: { totalDevices: 0, activeDevices: 0, inactiveDevices: 0, pendingDevices: 0, syncRate: 0 }
});

const getDefaultAlerts = () => ({ alerts: [], tasks: [] });

const getDefaultInventory = () => ({ lowStock: [], stockoutRisk: [] });

module.exports = {
  getSummary,
  getFinancial,
  getAnalytics,
  getDevices,
  getAlerts,
  getInventory,
  getCompleteOverview
};