const summaryLayer = require('./dashboardLayers/summaryLayer');
const financialLayer = require('./dashboardLayers/financialLayer');
const analyticsLayer = require('./dashboardLayers/analyticsLayer');
const deviceLayer = require('./dashboardLayers/deviceLayer');
const alertLayer = require('./dashboardLayers/alertLayer');
const inventoryLayer = require('./dashboardLayers/inventoryLayer');
const ceoStatsLayer = require('./dashboardLayers/ceoLayer');
const intelligenceLayer = require('./dashboardLayers/intelligenceLayer');
const systemOverviewLayer = require('./dashboardLayers/systemLayer');
const taskLayer = require('./dashboardLayers/taskLayer');
const logger = require('../utils/logger');

const getSummary = async (cooperativeId) => {
  try { return await summaryLayer.getSummary(cooperativeId); }
  catch (error) { 
    logger.warn('Summary failed', { error: error.message, coopId: cooperativeId });
    return getDefaultSummary();
  }
};

const getFinancial = async (cooperativeId) => {
  try { return await financialLayer.getFinancial(cooperativeId); }
  catch (error) { 
    logger.warn('Financial failed', { error: error.message, coopId: cooperativeId });
    return getDefaultFinancial();
  }
};

const getAnalytics = async (period = 'daily', cooperativeId) => {
  try { return await analyticsLayer.getAnalytics(period, cooperativeId); }
  catch (error) { 
    logger.warn('Analytics failed', { error: error.message, coopId: cooperativeId });
    return getDefaultAnalytics();
  }
};

const getDevices = async (cooperativeId) => {
  try { return await deviceLayer.getDevices(cooperativeId); }
  catch (error) { 
    logger.warn('Devices failed', { error: error.message, coopId: cooperativeId });
    return getDefaultDevices();
  }
};

const getAlerts = async (cooperativeId) => {
  try { return await alertLayer.getAlerts(cooperativeId); }
  catch (error) { 
    logger.warn('Alerts failed', { error: error.message, coopId: cooperativeId });
    return getDefaultAlerts();
  }
};

const getInventory = async (cooperativeId) => {
  try { return await inventoryLayer.getInventory(cooperativeId); }
  catch (error) { 
    logger.warn('Inventory failed', { error: error.message, coopId: cooperativeId });
    return getDefaultInventory();
  }
};

// ✅ NEW ENDPOINTS
const getCEOStats = async (cooperativeId) => {
  try { return await ceoStatsLayer.getCEOStats(cooperativeId); }
  catch (error) { 
    logger.warn('CEOStats failed', { error: error.message, coopId: cooperativeId });
    return getDefaultCEOStats();
  }
};

const getIntelligence = async (cooperativeId) => {
  try { return await intelligenceLayer.getIntelligenceLayer(cooperativeId); }
  catch (error) { 
    logger.warn('Intelligence failed', { error: error.message, coopId: cooperativeId });
    return getDefaultIntelligence();
  }
};

const getSystemOverview = async (cooperativeId) => {
  try { return await systemOverviewLayer.getSystemOverview(cooperativeId); }
  catch (error) { 
    logger.warn('SystemOverview failed', { error: error.message, coopId: cooperativeId });
    return getDefaultSystemOverview();
  }
};

const getTasks = async (cooperativeId) => {
  try { return await taskLayer.getTasks(cooperativeId); }
  catch (error) { 
    logger.warn('Tasks failed', { error: error.message, coopId: cooperativeId });
    return [];
  }
};

// Enhanced overview with new modules
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

// ✅ NEW DEFAULTS
const getDefaultCEOStats = () => ({
  kpis: { avgMilkPerFarmer: 0, growthVsYesterday: '0%', totalLitresToday: 0 },
  zones: [],
  branches: [],
  milkQuality: { rejectedToday: 0, rejectedPercentage: '0%' },
  payoutForecast: { estimatedAmount: 0, farmersToPay: 0 }
});

const getDefaultIntelligence = () => ({
  financialIntelligence: {},
  alerts: [],
  predictions: { stockout: [], farmerDropout: [] },
  sms: { smsSent: 0, deliveryRate: '0%' }
});

const getDefaultSystemOverview = () => ({
  systemHealth: { healthScore: 0, status: 'unknown' },
  todayMetrics: { transactionsToday: 0 },
  totals: { totalFarmers: 0, totalDevices: 0 }
});

// Existing defaults...
const getDefaultSummary = () => ({ milkToday: 0, totalFarmers: 0, totalDevices: 0 });
const getDefaultFinancial = () => ({ milkRevenue: 0, feedRevenue: 0 });
const getDefaultAnalytics = () => ({ milkTrends: [], graphReady: {} });
const getDefaultDevices = () => ({ health: [], summary: { totalDevices: 0 } });
const getDefaultAlerts = () => ({ alerts: [], tasks: [] });
const getDefaultInventory = () => ({ lowStock: [], stockoutRisk: [] });

module.exports = {
  getSummary, getFinancial, getAnalytics, getDevices, getAlerts, getInventory,
  getCEOStats, getIntelligence, getSystemOverview, getTasks, getCompleteOverview
};