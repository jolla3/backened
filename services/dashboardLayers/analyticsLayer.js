// services/dashboardLayers/analyticsLayer.js
const { getAnalytics } = require('../analytics');
const logger = require('../../utils/logger');

const getAnalyticsLayer = async (period = 'daily', cooperativeId) => {
  try {
    return await getAnalytics(period, cooperativeId);
  } catch (error) {
    logger.warn('AnalyticsLayer failed', { error: error.message, coopId: cooperativeId, period });
    return getDefaultAnalytics();
  }
};

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

module.exports = { getAnalyticsLayer };