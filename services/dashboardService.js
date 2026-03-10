// const milkAnalytics = require('../analytics/milkAnalytics');
// const porterAnalytics = require('../analytics/porterAnalytics');
// const feedAnalytics = require('../analytics/feedAnalytics');
// const farmerAnalytics = require('../analytics/farmerAnalytics');
// const deviceAnalytics = require('../analytics/deviceAnalytics');
// const fraudAnalytics = require('../analytics/fraudAnalytics');
// const systemAnalytics = require('../analytics/systemAnalytics');
// const predictiveAnalytics = require('../analytics/predictiveAnalytics');
// const financialAnalytics = require('../analytics/financialAnalytics');
// const alertsAndRecommendations = require('../analytics/alertsAndRecommendations');
// const operationalKPIsModule = require('../analytics/operationalKPIs');
// const zoneIntelligenceModule = require('../analytics/zoneIntelligence');
// const farmerBehaviorModule = require('../analytics/farmerBehavior');
// const milkQualityModule = require('../analytics/milkQuality');
// const inventoryVelocityModule = require('../analytics/inventoryVelocity');
// const fraudAdvancedModule = require('../analytics/fraudAdvanced');
// const payoutForecastModule = require('../analytics/payoutForecast');
// const farmerValueModule = require('../analytics/farmerValue');
// const graphReadyDataModule = require('../analytics/graphReady');
// const cooperativeGrowthModule = require('../analytics/cooperativeGrowth');
// const decisionEngine = require('../analytics/decisionEngine');
// const smsAnalyticsModule = require('../analytics/smsAnalytics');
// const aiAdvisoryModule = require('../analytics/aiAdvisory');
// const taskService = require('../services/taskService');
// const deviceHealthModule = require('../analytics/deviceHealth');
// const Inventory = require('../models/inventory');
// const logger = require('../utils/logger');

// // Cache configuration
// const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes
// let cache = new Map();

// // Helper: Safe async execution with error handling
// const safeExecute = async (fn, fallback = null, moduleName = 'Unknown') => {
//   try {
//     return await fn();
//   } catch (error) {
//     logger.warn(`${moduleName} failed`, { error: error.message });
//     return fallback;
//   }
// };

// // Layer 1: System Overview
// const getSystemOverview = async () => {
//   return await safeExecute(async () => ({
//     totalFarmers: await require('../models/farmer').countDocuments(),
//     totalPorters: await require('../models/porter').countDocuments(),
//     totalProducts: await require('../models/inventory').countDocuments(),
//     totalRates: await require('../models/rateVersion').countDocuments(),
//     totalDevices: await require('../models/device').countDocuments(),
//     lowStockAlerts: await Inventory.aggregate([
//       { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
//       { $count: 'count' }
//     ])
//   }), { totalFarmers: 0, totalPorters: 0, totalProducts: 0, totalRates: 0, totalDevices: 0, lowStockAlerts: [] }, 'SystemOverview');
// };

// // Layer 2: Today's Metrics
// const getTodayMetrics = async () => {
//   return await safeExecute(async () => systemAnalytics.getTodayMetrics(), {
//     transactionsToday: 0,
//     milkToday: { litres: 0, payout: 0 },
//     feedToday: { quantity: 0, cost: 0 },
//     farmersToday: 0,
//     portersToday: 0,
//     devicesToday: 0
//   }, 'TodayMetrics');
// };

// // Layer 3: Intelligence Layer
// const getIntelligenceLayer = async () => {
//   const [financialIntelligence, smartAlerts, recommendations, stockoutPredictions, farmerDropoutRisks] = await Promise.all([
//     safeExecute(() => financialAnalytics.getFinancialIntelligence(), { milkRevenue: 0, feedRevenue: 0, netCashFlow: 0, profitMargin: 0, todayMilkPayout: 0, todayMilkLitres: 0 }, 'FinancialIntelligence'),
//     safeExecute(() => alertsAndRecommendations.getSmartAlerts(), [], 'SmartAlerts'),
//     safeExecute(() => alertsAndRecommendations.getRecommendations(), [], 'Recommendations'),
//     safeExecute(() => predictiveAnalytics.predictStockout(), [], 'StockoutPredictions'),
//     safeExecute(() => predictiveAnalytics.predictFarmerDropout(), [], 'FarmerDropoutRisks')
//   ]);

//   return { financialIntelligence, smartAlerts, recommendations, stockoutPredictions, farmerDropoutRisks };
// };

// // Layer 4: CEO Stats
// const getCEOStats = async () => {
//   const [kpisData, zonesData, branchData, farmerRisksData, milkQualityData, inventoryVelocityData, advancedFraudSignalsData, payoutForecastData, farmerValueData, cooperativeGrowthData] = await Promise.all([
//     safeExecute(() => operationalKPIsModule.getOperationalKPIs(), { avgMilkPerFarmer: 0, growthVsYesterday: '0%', growthVsLastWeek: '0%', peakCollectionHour: 'N/A' }, 'OperationalKPIs'),
//     safeExecute(() => zoneIntelligenceModule.getZoneIntelligence(), [], 'ZoneIntelligence'),
//     safeExecute(async () => {
//       const branches = await require('../models/farmer').aggregate([
//         { $group: { _id: '$branch_id', totalMilk: { $sum: '$balance' } } }
//       ]);
//       return await Promise.all(
//         branches.map(async b => ({
//           branch: b._id || 'main',
//           totalMilk: b.totalMilk,
//           farmers: await require('../models/farmer').countDocuments({ branch_id: b._id })
//         }))
//       );
//     }, [], 'BranchData'),
//     safeExecute(() => farmerBehaviorModule.getFarmerRisks(), [], 'FarmerRisks'),
//     safeExecute(() => milkQualityModule.getMilkQuality(), { rejectedToday: 0, rejectedPercentage: '0%' }, 'MilkQuality'),
//     safeExecute(() => inventoryVelocityModule.getInventoryVelocity(), [], 'InventoryVelocity'),
//     safeExecute(() => fraudAdvancedModule.getAdvancedFraudSignals(), [], 'AdvancedFraudSignals'),
//     safeExecute(() => payoutForecastModule.getPayoutForecast(), { nextPayoutDate: '', estimatedAmount: 0, farmersToPay: 0 }, 'PayoutForecast'),
//     safeExecute(() => farmerValueModule.getFarmerValue(), [], 'FarmerValue'),
//     safeExecute(() => cooperativeGrowthModule.getCooperativeGrowth(), { farmersJoinedThisMonth: 0, milkGrowth: '0%', feedSalesGrowth: '0%' }, 'CooperativeGrowth')
//   ]);

//   return { kpisData, zonesData, branchData, farmerRisksData, milkQualityData, inventoryVelocityData, advancedFraudSignalsData, payoutForecastData, farmerValueData, cooperativeGrowthData };
// };

// // Layer 5: Analytics Data
// const getAnalyticsData = async (period) => {
//   const [
//     graphReadyData,
//     porterPerformanceData,
//     porterRiskData,
//     topMilkProducers,
//     lowPerformingFarmers,
//     milkTrends,
//     topFeedProducts,
//     feedStockRisk,
//     feedTrends,
//     farmersWithDebt,
//     topFarmersByBalance,
//     feedMilkImbalance,
//     deviceSummary,
//     deviceInactive,
//     deviceIntelligence,
//     deviceHealthData,
//     anomalies,
//     actions,
//     smsData,
//     aiAdvisory,
//     tasks
//   ] = await Promise.all([
//     safeExecute(() => graphReadyDataModule.getGraphReadyData(period), { milkTrendGraph: { labels: [], data: [] }, feedTrendGraph: { labels: [], data: [] } }, 'GraphReadyData'),
//     safeExecute(() => porterAnalytics.getPorterPerformanceSummary(), [], 'PorterPerformance'),
//     safeExecute(() => porterAnalytics.getPorterFraudRiskScore(), [], 'PorterRisk'),
//     safeExecute(() => milkAnalytics.getTopMilkProducers(10, period), [], 'MilkProducers'),
//     safeExecute(() => milkAnalytics.getLowPerformingFarmers(period), [], 'LowPerformingFarmers'),
//     safeExecute(() => milkAnalytics.getMilkCollectionTrends(period), [], 'MilkTrends'),
//     safeExecute(() => feedAnalytics.getTopFeedProducts(5), [], 'FeedProducts'),
//     safeExecute(() => feedAnalytics.getFeedStockRisk(), [], 'FeedStockRisk'),
//     safeExecute(() => feedAnalytics.getFeedSalesTrends(period), [], 'FeedTrends'),
//     safeExecute(() => farmerAnalytics.getFarmersWithDebt(10), [], 'FarmersWithDebt'),
//     safeExecute(() => farmerAnalytics.getTopFarmersByBalance(10), [], 'TopFarmersByBalance'),
//     safeExecute(() => farmerAnalytics.getFeedMilkImbalance(10), [], 'FeedMilkImbalance'),
//     safeExecute(() => deviceAnalytics.getDeviceSyncSummary(), { totalDevices: 0, activeDevices: 0, pendingDevices: 0, revokedDevices: 0, inactiveDevices: 0, syncRate: '0' }, 'DeviceSummary'),
//     safeExecute(() => deviceAnalytics.getInactiveDevices(), [], 'InactiveDevices'),
//     safeExecute(() => deviceAnalytics.getActiveDevices(), [], 'ActiveDevices'),
//     safeExecute(() => deviceHealthModule.getDeviceHealth(), [], 'DeviceHealth'),
//     safeExecute(() => fraudAnalytics.detectAnomalies(), [], 'FraudAnomalies'),
//     safeExecute(() => decisionEngine.generateActions(), [], 'DecisionActions'),
//     safeExecute(() => smsAnalyticsModule.getSmsAnalytics(), { smsSent: 0, smsFailed: 0, deliveryRate: '0%', receiptsVerifiedToday: 0 }, 'SmsAnalytics'),
//     safeExecute(() => aiAdvisoryModule.getAiAdvisory(), [], 'AiAdvisory'),
//     safeExecute(() => taskService.getTasks('pending'), [], 'Tasks')
//   ]);

//   return {
//     graphReadyData,
//     porterPerformanceData,
//     porterRiskData,
//     topMilkProducers,
//     lowPerformingFarmers,
//     milkTrends,
//     topFeedProducts,
//     feedStockRisk,
//     feedTrends,
//     farmersWithDebt,
//     topFarmersByBalance,
//     feedMilkImbalance,
//     deviceSummary,
//     deviceInactive,
//     deviceIntelligence,
//     deviceHealthData,
//     anomalies,
//     actions,
//     smsData,
//     aiAdvisory,
//     tasks
//   };
// };

// // Layer 6: System Health
// const getSystemHealth = async () => {
//   return await safeExecute(async () => systemAnalytics.getSystemHealth(), {
//     healthScore: 100,
//     status: 'healthy',
//     totalTransactions: 0,
//     pendingTransactions: 0,
//     failedTransactions: 0,
//     totalFarmers: 0,
//     totalPorters: 0,
//     totalDevices: 0,
//     lowStockProducts: 0,
//     issues: []
//   }, 'SystemHealth');
// };

// // Main Dashboard Function
// const getCompleteDashboard = async (period = 'daily') => {
//   const cacheKey = `dashboard_${period}`;
//   const cached = cache.get(cacheKey);
  
//   if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
//     return cached.data;
//   }

//   try {
//     const [
//       systemOverview,
//       todayMetrics,
//       systemHealth,
//       intelligenceLayer,
//       ceoStats,
//       analyticsData
//     ] = await Promise.all([
//       getSystemOverview(),
//       getTodayMetrics(),
//       getSystemHealth(),
//       getIntelligenceLayer(),
//       getCEOStats(),
//       getAnalyticsData(period)
//     ]);

//     const result = {
//       lastUpdated: new Date(),
//       systemHealth,
//       todayMetrics,
//       systemOverview: {
//         totalFarmers: systemOverview.totalFarmers,
//         totalPorters: systemOverview.totalPorters,
//         totalProducts: systemOverview.totalProducts,
//         totalRates: systemOverview.totalRates,
//         totalDevices: systemOverview.totalDevices,
//         lowStockAlerts: systemOverview.lowStockAlerts[0]?.count || 0
//       },
//       financialIntelligence: intelligenceLayer.financialIntelligence,
//       alerts: intelligenceLayer.smartAlerts,
//       recommendations: intelligenceLayer.recommendations,
//       predictions: {
//         stockout: intelligenceLayer.stockoutPredictions,
//         farmerDropout: intelligenceLayer.farmerDropoutRisks
//       },
//       kpis: ceoStats.kpisData,
//       zones: ceoStats.zonesData,
//       branches: ceoStats.branchData,
//       farmerRisks: ceoStats.farmerRisksData,
//       milkQuality: ceoStats.milkQualityData,
//       inventoryVelocity: ceoStats.inventoryVelocityData,
//       fraudSignals: ceoStats.advancedFraudSignalsData,
//       payoutForecast: ceoStats.payoutForecastData,
//       farmerValue: ceoStats.farmerValueData,
//       growth: ceoStats.cooperativeGrowthData,
//       graphReady: analyticsData.graphReadyData,
//       porters: {
//         performance: analyticsData.porterPerformanceData,
//         risk: analyticsData.porterRiskData
//       },
//       milk: {
//         topProducers: analyticsData.topMilkProducers,
//         lowPerformers: analyticsData.lowPerformingFarmers,
//         trends: analyticsData.milkTrends
//       },
//       feed: {
//         topProducts: analyticsData.topFeedProducts,
//         stockRisk: analyticsData.feedStockRisk,
//         trends: analyticsData.feedTrends
//       },
//       farmers: {
//         withDebt: analyticsData.farmersWithDebt,
//         topByBalance: analyticsData.topFarmersByBalance,
//         imbalance: analyticsData.feedMilkImbalance
//       },
//       devices: {
//         summary: analyticsData.deviceSummary,
//         inactive: analyticsData.deviceInactive,
//         intelligence: analyticsData.deviceIntelligence,
//         health: analyticsData.deviceHealthData
//       },
//       fraud: {
//         anomalies: analyticsData.anomalies
//       },
//       actions: analyticsData.actions,
//       sms: analyticsData.smsData,
//       aiAdvisory: analyticsData.aiAdvisory,
//       tasks: analyticsData.tasks
//     };

//     cache.set(cacheKey, { timestamp: Date.now(), data: result });
//     return result;
//   } catch (error) {
//     logger.error('Dashboard failed', { error: error.message });
//     throw error;
//   }
// };
const summaryLayer = require('./dashboardLayers/summaryLayer');
const financialLayer = require('./dashboardLayers/financialLayer');
const analyticsLayer = require('./dashboardLayers/analyticsLayer');
const deviceLayer = require('./dashboardLayers/deviceLayer');
const alertLayer = require('./dashboardLayers/alertLayer');
const inventoryLayer = require('./dashboardLayers/inventoryLayer');
const logger = require('../utils/logger');

const getSummary = async () => {
  try {
    return await summaryLayer.getSummary();
  } catch (error) {
    logger.warn('Summary failed', { error: error.message });
    return getDefaultSummary();
  }
};

const getFinancial = async () => {
  try {
    return await financialLayer.getFinancial();
  } catch (error) {
    logger.warn('Financial failed', { error: error.message });
    return getDefaultFinancial();
  }
};

const getAnalytics = async (period = 'daily') => {
  try {
    return await analyticsLayer.getAnalytics(period);
  } catch (error) {
    logger.warn('Analytics failed', { error: error.message });
    return getDefaultAnalytics();
  }
};

const getDevices = async () => {
  try {
    return await deviceLayer.getDevices();
  } catch (error) {
    logger.warn('Devices failed', { error: error.message });
    return getDefaultDevices();
  }
};

const getAlerts = async () => {
  try {
    return await alertLayer.getAlerts();
  } catch (error) {
    logger.warn('Alerts failed', { error: error.message });
    return getDefaultAlerts();
  }
};

const getInventory = async () => {
  try {
    return await inventoryLayer.getInventory();
  } catch (error) {
    logger.warn('Inventory failed', { error: error.message });
    return getDefaultInventory();
  }
};

const getCompleteOverview = async (period = 'daily') => {
  try {
    const [summary, financial, analytics, devices, alerts, inventory] = await Promise.all([
      getSummary(),
      getFinancial(),
      getAnalytics(period),
      getDevices(),
      getAlerts(),
      getInventory()
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
    logger.error('Overview failed', { error: error.message });
    throw error;
  }
};

// ✅ FIXED: Consistent structure for all defaults
const getDefaultSummary = () => ({
  milkToday: 0,
  milkYesterday: 0,
  milkThisWeek: 0,
  milkThisMonth: 0,
  milkChange: 0,
  farmersToday: 0,
  transactionsToday: 0,
  totalFarmers: 0,
  totalPorters: 0,
  totalDevices: 0
});

const getDefaultFinancial = () => ({
  milkRevenue: 0,
  feedRevenue: 0,
  netCashFlow: 0,
  profitMargin: null,
  hasRealData: false
});

const getDefaultAnalytics = () => ({
  milkTrends: [],
  porterPerformance: [],
  zoneProduction: [],
  topFarmer: null,
  lowestProducer: null,
  milkPrediction: null,
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
  summary: {
    totalDevices: 0,
    activeDevices: 0,
    inactiveDevices: 0,
    pendingDevices: 0,
    syncRate: 0
  }
});

const getDefaultAlerts = () => ({
  alerts: [],
  tasks: []
});

const getDefaultInventory = () => ({
  lowStock: [],
  stockoutRisk: []
});

module.exports = {
  getSummary,
  getFinancial,
  getAnalytics,
  getDevices,
  getAlerts,
  getInventory,
  getCompleteOverview
};