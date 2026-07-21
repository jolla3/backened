// services/analytics.js
const mongoose = require('mongoose');
const Cooperative = require('../models/cooperative');
const {
  getMilkTrend,
  getPorterPerformance,
  getZoneProduction,
  getTopFarmers,
  getBottomFarmers,
  getMilkPrediction,
  getPeakHours,
  getDailyCollectionTrend,
  getPaymentMethods,
  getProductSales,
  getCollectionTimeDistribution,
} = require('../analytics/shared/transactionAnalytics');
const graphReadyDataModule = require('../analytics/graphReady');
const logger = require('../utils/logger');

const getAnalytics = async (period = 'daily', cooperativeId) => {
  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const cooperative = await Cooperative.findById(coopId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    let startDate;
    if (period === 'daily') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
    } else if (period === 'weekly') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'monthly') {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
    }

    const [
      milkTrends,
      porterPerformance,
      zoneProduction,
      topFarmers,
      bottomFarmers,
      milkPrediction,
      peakHours,
      dailyTrend,
      paymentMethods,
      productSales,
      timeDistribution,
      graphReady,
    ] = await Promise.all([
      getMilkTrend(coopId, startDate),
      getPorterPerformance(coopId, startDate),
      getZoneProduction(coopId, startDate),
      getTopFarmers(coopId, 10),
      getBottomFarmers(coopId, 10),
      getMilkPrediction(coopId),
      getPeakHours(coopId, startDate),
      getDailyCollectionTrend(coopId, startDate),
      getPaymentMethods(coopId, startDate),
      getProductSales(coopId, startDate),
      getCollectionTimeDistribution(coopId, startDate),
      graphReadyDataModule.getGraphReadyData(period, cooperativeId),
    ]);

    return {
      milkTrends: milkTrends.map(t => ({
        date: t.date,
        litres: t.litres,
        transactions: t.transactions,
      })),
      porterPerformance,
      zoneProduction,
      topFarmers,
      bottomFarmers,
      milkPrediction,
      peakHours: peakHours.map(h => ({
        hour: h.hour,
        hourNum: h.hourNum,
        transactions: h.transactions,
        litres: h.litres,
        avgLitres: h.avgLitres,
      })),
      dailyCollectionTrend: dailyTrend,
      paymentMethods,
      productSales,
      collectionTimeDistribution: timeDistribution.map(t => ({
        hour: t.hour,
        hourLabel: t.hourLabel,
        transactions: t.transactions,
        litres: t.litres,
        avgLitres: t.avgLitres,
      })),
      graphReady,
    };
  } catch (error) {
    logger.warn('Analytics failed', { error: error.message, coopId: cooperativeId });
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

module.exports = { getAnalytics };