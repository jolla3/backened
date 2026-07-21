// analytics/graphReady.js
const mongoose = require('mongoose');
const Cooperative = require('../models/cooperative');
const {
  getMilkTrend,
  getFeedTrend,
  getPeakHours,
  getFarmerGrowth,
  getCollectionTimeDistribution,
} = require('./shared/transactionAnalytics');
const logger = require('../utils/logger');

const getGraphReadyData = async (period = 'daily', cooperativeId) => {
  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const cooperative = await Cooperative.findById(coopId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    let startDate;
    let previousStartDate;

    if (period === 'daily') {
      startDate = new Date(now);
      startDate.setHours(0, 0, 0, 0);
      previousStartDate = new Date(startDate);
      previousStartDate.setDate(previousStartDate.getDate() - 1);
    } else if (period === 'weekly') {
      startDate = new Date(now);
      startDate.setDate(startDate.getDate() - 7);
      previousStartDate = new Date(startDate);
      previousStartDate.setDate(previousStartDate.getDate() - 7);
    } else if (period === 'monthly') {
      startDate = new Date(now);
      startDate.setMonth(startDate.getMonth() - 1);
      previousStartDate = new Date(startDate);
      previousStartDate.setMonth(previousStartDate.getMonth() - 1);
    }

    const [milkTrend, feedTrend, peakHours, farmerGrowth, timeDistribution] = await Promise.all([
      getMilkTrend(coopId, startDate),
      getFeedTrend(coopId, startDate),
      getPeakHours(coopId, startDate),
      getFarmerGrowth(coopId, startDate, null),
      getCollectionTimeDistribution(coopId, startDate),
    ]);

    // Farmer growth graph: last 7 days labels with registrations
    const farmerGrowthGraph = {
      labels: farmerGrowth.map(f => f.date).slice(-7),
      data: farmerGrowth.map(f => f.registrations).slice(-7),
    };

    // Time distribution for chart
    const timeDistributionGraph = {
      labels: timeDistribution.map(t => t.hourLabel),
      data: timeDistribution.map(t => t.transactions),
      litres: timeDistribution.map(t => t.litres),
      avgLitres: timeDistribution.map(t => t.avgLitres),
    };

    return {
      milkTrendGraph: {
        labels: milkTrend.map(t => t.date).slice(-30),
        data: milkTrend.map(t => t.litres).slice(-30),
        transactions: milkTrend.map(t => t.transactions).slice(-30),
      },
      feedTrendGraph: {
        labels: feedTrend.map(t => t.date).slice(-30),
        data: feedTrend.map(t => t.quantity).slice(-30),
        revenue: feedTrend.map(t => t.revenue).slice(-30),
      },
      farmerGrowthGraph,
      timeDistributionGraph,
      peakHours: peakHours.map(h => ({
        hour: h.hour,
        hourNum: h.hourNum,
        transactions: h.transactions,
        litres: h.litres,
        avgLitres: h.avgLitres,
      })),
    };
  } catch (error) {
    logger.error('GraphReady failed', { error: error.message, cooperativeId, period });
    return getDefaultGraphReady();
  }
};

const getDefaultGraphReady = () => ({
  milkTrendGraph: { labels: [], data: [], transactions: [] },
  feedTrendGraph: { labels: [], data: [], revenue: [] },
  farmerGrowthGraph: { labels: [], data: [] },
  timeDistributionGraph: { labels: [], data: [], litres: [], avgLitres: [] },
  peakHours: [],
});

module.exports = { getGraphReadyData };