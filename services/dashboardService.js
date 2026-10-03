// services/dashboardService.js
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

/**
 * Run a layer; on failure return default + degraded metadata (never silent "healthy zeros").
 */
const safeLayer = async (name, fn, defaultFactory, cooperativeId, extra = {}) => {
  try {
    const data = await fn();
    if (data && typeof data === 'object' && !Array.isArray(data)) {
      return { ...data, degraded: false, layerError: null };
    }
    return data;
  } catch (error) {
    logger.warn(`${name} failed`, {
      error: error.message,
      coopId: cooperativeId,
      ...extra,
    });
    const fallback = defaultFactory();
    if (fallback && typeof fallback === 'object' && !Array.isArray(fallback)) {
      return {
        ...fallback,
        degraded: true,
        layerError: error.message,
      };
    }
    return fallback;
  }
};

const getSummary = (cooperativeId) =>
  safeLayer('Summary', () => summaryLayer.getSummary(cooperativeId), getDefaultSummary, cooperativeId);

const getFinancial = (cooperativeId) =>
  safeLayer('Financial', () => financialLayer.getFinancial(cooperativeId), getDefaultFinancial, cooperativeId);

const getAnalytics = (period = 'daily', cooperativeId) =>
  safeLayer(
    'Analytics',
    () => analyticsLayer.getAnalyticsLayer(period, cooperativeId),
    getDefaultAnalytics,
    cooperativeId,
    { period }
  );

const getDevices = (cooperativeId) =>
  safeLayer('Devices', () => deviceLayer.getDevices(cooperativeId), getDefaultDevices, cooperativeId);

const getAlerts = (cooperativeId) =>
  safeLayer('Alerts', () => alertLayer.getAlerts(cooperativeId), getDefaultAlerts, cooperativeId);

const getInventory = (cooperativeId) =>
  safeLayer('Inventory', () => inventoryLayer.getInventory(cooperativeId), getDefaultInventory, cooperativeId);

const getCEOStats = (cooperativeId) =>
  safeLayer('CEOStats', () => ceoStatsLayer.getCEOStats(cooperativeId), getDefaultCEOStats, cooperativeId);

const getIntelligence = (cooperativeId) =>
  safeLayer(
    'Intelligence',
    () => intelligenceLayer.getIntelligenceLayer(cooperativeId),
    getDefaultIntelligence,
    cooperativeId
  );

const getSystemOverview = (cooperativeId) =>
  safeLayer(
    'SystemOverview',
    () => systemOverviewLayer.getSystemOverview(cooperativeId),
    getDefaultSystemOverview,
    cooperativeId
  );

const getTasks = async (cooperativeId) => {
  try {
    return await taskLayer.getTasks(cooperativeId);
  } catch (error) {
    logger.warn('Tasks failed', { error: error.message, coopId: cooperativeId });
    return { tasks: [], degraded: true, layerError: error.message };
  }
};

const getCompleteOverview = async (period = 'daily', cooperativeId) => {
  const [summary, financial, analytics, devices, alerts, inventory] = await Promise.all([
    getSummary(cooperativeId),
    getFinancial(cooperativeId),
    getAnalytics(period, cooperativeId),
    getDevices(cooperativeId),
    getAlerts(cooperativeId),
    getInventory(cooperativeId),
  ]);

  const layerErrors = [];
  for (const [name, block] of Object.entries({
    summary,
    financial,
    analytics,
    devices,
    alerts,
    inventory,
  })) {
    if (block && block.degraded) {
      layerErrors.push({ layer: name, error: block.layerError || 'unknown' });
    }
  }

  return {
    lastUpdated: new Date().toISOString(),
    degraded: layerErrors.length > 0,
    layerErrors,
    summary,
    financial,
    analytics,
    devices,
    alerts,
    inventory,
  };
};

// ─── Defaults (explicit empty / unavailable — not "healthy") ─
const getDefaultSummary = () => ({
  milk: {
    today: 0,
    yesterday: 0,
    week: 0,
    month: 0,
    trend: 'stable',
    change: null,
    averagePerActiveFarmer: 0,
    averagePerTransaction: 0,
    bestDayThisMonth: 0,
  },
  finance: {
    farmerPayable: 0,
    farmerDebt: 0,
    netPayable: 0,
    farmersToPay: 0,
    farmersInDebt: 0,
    netWalletMovementToday: 0,
    settlementStatus: 'unknown',
  },
  operations: {
    totalFarmers: 0,
    activeFarmersToday: 0,
    participation: 0,
    activePortersToday: 0,
    activeDevices: 0,
    transactionsToday: 0,
    activeBranches: 0,
  },
  production: {
    litresPerTransaction: 0,
    averageLitresPerActiveFarmer: 0,
    litresPerPorter: 0,
  },
  alerts: {
    production: { status: 'unknown', message: 'Summary unavailable' },
    cash: { status: 'unknown', message: 'Summary unavailable' },
    inventory: { status: 'unknown', message: 'Summary unavailable' },
  },
  kpi: {
    milkCollected: 0,
    expectedSettlement: 0,
    activeFarmers: 0,
    healthScore: 0,
  },
  summary: {
    status: 'Unavailable',
    headline: 'Dashboard summary could not be loaded.',
  },
});

const getDefaultFinancial = () => ({
  milkLitres: 0,
  milkValueGenerated: 0,
  feedRevenue: 0,
  feedQuantity: 0,
  feedRevenueCash: 0,
  feedRevenueBalance: 0,
  todayMilkPayout: 0,
  todayMilkLitres: 0,
  amountToPayFarmers: 0,
  amountFarmersOweCoop: 0,
  farmersToPay: 0,
  farmersOwingCoop: 0,
  farmersWithZero: 0,
  avgPricePerLiter: 0,
  hasRealData: false,
});

const getDefaultAnalytics = () => ({
  milkTrends: [],
  porterPerformance: [],
  zoneProduction: [],
  topFarmers: [],
  bottomFarmers: [],
  milkPrediction: null,
  peakHours: [],
  dailyCollectionTrend: [],
  paymentMethods: {},
  productSales: [],
  collectionTimeDistribution: [],
  graphReady: {
    milkTrendGraph: { labels: [], data: [], transactions: [] },
    feedTrendGraph: { labels: [], data: [], revenue: [] },
    farmerGrowthGraph: { labels: [], data: [] },
    timeDistributionGraph: { labels: [], data: [], litres: [], avgLitres: [] },
    peakHours: [],
  },
});

const getDefaultDevices = () => ({
  health: [],
  summary: {
    totalDevices: 0,
    approvedDevices: 0,
    pendingApproval: 0,
    activeDevices: 0,
    inactiveDevices: 0,
    pendingDevices: 0,
    syncRate: 0,
  },
});

const getDefaultAlerts = () => ({ alerts: [], tasks: [] });
const getDefaultInventory = () => ({ lowStock: [], stockoutRisk: [] });

const getDefaultCEOStats = () => ({
  kpis: {
    avgMilkPerFarmer: 0,
    growthVsYesterday: '0%',
    totalLitresToday: 0,
  },
  zones: [],
  branches: [],
  milkQuality: { rejectedToday: 0, rejectedPercentage: '0%' },
  payoutForecast: { estimatedAmount: 0, farmersToPay: 0 },
});

const getDefaultIntelligence = () => ({
  status: 'ERROR',
  reason: 'Intelligence layer unavailable',
  todaySummary: {
    milkCollected: 0,
    transactions: 0,
    activeFarmers: 0,
    expectedSettlement: 0,
    lowStockItems: 0,
  },
  financialIntelligence: {},
  alerts: [],
  predictions: { stockout: [], farmerDropout: [] },
  sms: { smsSent: 0, deliveryRate: '0%' },
});

const getDefaultSystemOverview = () => ({
  systemHealth: { healthScore: 0, status: 'unknown' },
  todayMetrics: { transactionsToday: 0 },
  totals: { totalFarmers: 0, totalDevices: 0 },
});

module.exports = {
  getSummary,
  getFinancial,
  getAnalytics,
  getDevices,
  getAlerts,
  getInventory,
  getCEOStats,
  getIntelligence,
  getSystemOverview,
  getTasks,
  getCompleteOverview,
};