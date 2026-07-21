// dashboardLayer/ceolayer
const operationalKPIsModule = require('../../analytics/operationalKPIs');
const zoneIntelligenceModule = require('../../analytics/zoneIntelligence');
const farmerBehaviorModule = require('../../analytics/farmerBehavior');
const milkQualityModule = require('../../analytics/milkQuality');
const inventoryVelocityModule = require('../../analytics/inventoryVelocity');
const fraudAdvancedModule = require('../../analytics/fraudAdvanced');
const payoutForecastModule = require('../../analytics/payoutForecast');
const farmerValueModule = require('../../analytics/farmerValue');
const cooperativeGrowthModule = require('../../analytics/cooperativeGrowth');
const Cooperative = require('../../models/cooperative');
const Farmer = require('../../models/farmer');
const logger = require('../../utils/logger');

const getCEOStats = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // Run all modules in parallel, catching errors individually
    const [
      kpisRaw,
      zonesRaw,
      branchData,
      farmerRisksRaw,
      milkQualityRaw,
      inventoryVelocityRaw,
      fraudSignalsRaw,
      payoutForecastRaw,
      farmerValueRaw,
      growthRaw
    ] = await Promise.all([
      operationalKPIsModule.getOperationalKPIs(cooperativeId).catch(e => {
        logger.warn('operationalKPIs failed', { error: e.message, cooperativeId });
        return getDefaultKPIs();
      }),
      zoneIntelligenceModule.getZoneIntelligence(cooperativeId).catch(e => {
        logger.warn('zoneIntelligence failed', { error: e.message, cooperativeId });
        return [];
      }),
      getBranchData(cooperativeId).catch(e => {
        logger.warn('branchData failed', { error: e.message, cooperativeId });
        return [];
      }),
      farmerBehaviorModule.getFarmerRisks(cooperativeId).catch(e => {
        logger.warn('farmerRisks failed', { error: e.message, cooperativeId });
        return [];
      }),
      milkQualityModule.getMilkQuality(cooperativeId).catch(e => {
        logger.warn('milkQuality failed', { error: e.message, cooperativeId });
        return getDefaultMilkQuality();
      }),
      inventoryVelocityModule.getInventoryVelocity(cooperativeId).catch(e => {
        logger.warn('inventoryVelocity failed', { error: e.message, cooperativeId });
        return [];
      }),
      fraudAdvancedModule.getAdvancedFraudSignals(cooperativeId).catch(e => {
        logger.warn('fraudSignals failed', { error: e.message, cooperativeId });
        return [];
      }),
      payoutForecastModule.getPayoutForecast(cooperativeId).catch(e => {
        logger.warn('payoutForecast failed', { error: e.message, cooperativeId });
        return getDefaultPayoutForecast();
      }),
      farmerValueModule.getFarmerValue(cooperativeId).catch(e => {
        logger.warn('farmerValue failed', { error: e.message, cooperativeId });
        return [];
      }),
      cooperativeGrowthModule.getCooperativeGrowth(cooperativeId).catch(e => {
        logger.warn('growth failed', { error: e.message, cooperativeId });
        return getDefaultGrowth();
      })
    ]);

    // Map kpis to frontend shape
    const kpis = {
      avgMilkPerFarmerToday: kpisRaw.avgMilkPerFarmerToday || 0,
      avgMilkPerFarmerWeek: kpisRaw.avgMilkPerFarmerWeek || 0,
      avgMilkPerFarmerMonth: kpisRaw.avgMilkPerFarmerMonth || 0,
      growthVsYesterday: kpisRaw.growthVsYesterday || '0%',
      growthVsLastWeek: kpisRaw.growthVsLastWeek || '0%',
      growthVsLastMonth: kpisRaw.growthVsLastMonth || '0%',
      peakCollectionHour: kpisRaw.peakCollectionHour || null,
      totalLitresToday: kpisRaw.totalLitresToday || 0,
      activeFarmersToday: kpisRaw.activeFarmersToday || 0,
      totalTransactionsToday: kpisRaw.totalTransactionsToday || 0,
      avgLitresPerTransaction: kpisRaw.avgLitresPerTransaction || '0',
      retentionRate: kpisRaw.retentionRate || '0%',
      weekTrend: kpisRaw.weekTrend || { totalLitres: 0, avgPerDay: 0, activeFarmers: 0 },
      monthTrend: kpisRaw.monthTrend || { totalLitres: 0, activeFarmers: 0 }
    };

    // Zones – ensure field names match frontend
    const zones = (zonesRaw || []).map(z => ({
      zone: z.zone || 'Main',
      totalMilk: z.totalMilk || 0,
      totalPayout: z.totalPayout || 0,
      farmers: z.farmers || 0,
      transactions: z.transactions || 0,
      avgMilkPerFarmer: z.avgMilkPerFarmer || 0,
      recentTrend: z.recentTrend || { last7DaysLitres: 0, avgPerDay: 0, transactions: 0 },
      contribution: z.contribution || '0%',
      anomalyScore: z.anomalyScore || 'NORMAL'
    }));

    // Growth – already mapped in cooperativeGrowth
    const growth = {
      farmersThisMonth: growthRaw.farmersThisMonth || 0,
      farmersGrowthMonth: growthRaw.farmersGrowthMonth || '0%',
      farmersGrowthQuarter: growthRaw.farmersGrowthQuarter || '0%',
      farmersGrowthYear: growthRaw.farmersGrowthYear || '0%',
      milkThisMonth: growthRaw.milkThisMonth || 0,
      milkGrowthMonth: growthRaw.milkGrowthMonth || '0%',
      milkGrowthQuarter: growthRaw.milkGrowthQuarter || '0%',
      milkGrowthYear: growthRaw.milkGrowthYear || '0%',
      feedThisMonth: growthRaw.feedThisMonth || 0,
      feedGrowthMonth: growthRaw.feedGrowthMonth || '0%',
      feedGrowthQuarter: growthRaw.feedGrowthQuarter || '0%',
      feedGrowthYear: growthRaw.feedGrowthYear || '0%',
      monthComparison: growthRaw.monthComparison || {
        farmersThisMonth: 0,
        farmersLastMonth: 0,
        milkThisMonth: 0,
        milkLastMonth: 0,
        feedThisMonth: 0,
        feedLastMonth: 0
      }
    };

    // Farmer Risks – already in correct shape
    const farmerRisks = farmerRisksRaw || [];

    // Fraud Signals – already in correct shape
    const fraudSignals = fraudSignalsRaw || [];

    // Inventory Velocity – ensure urgency/daysUntilStockout exist
    const inventoryVelocity = (inventoryVelocityRaw || []).map(i => ({
      product: i.product,
      currentStock: i.currentStock,
      daysUntilStockout: i.daysUntilStockout,
      urgency: i.urgency,
      trend: i.trend || 'STABLE',
      percentChange: i.percentChange || '0%'
    }));

    // Payout Forecast – already in correct shape
    const payoutForecast = payoutForecastRaw;

    // Milk Quality – ensure totalMilkToday etc are populated
    const milkQuality = milkQualityRaw;

    return {
      kpis,
      zones,
      branches: branchData,
      farmerRisks,
      milkQuality,
      inventoryVelocity,
      fraudSignals,
      payoutForecast,
      farmerValue: farmerValueRaw,
      growth
    };
  } catch (error) {
    logger.error('CEOStats failed', { error: error.message, cooperativeId });
    return getDefaultCEOStats();
  }
};

// Helper defaults
// dashboardLayers/ceoLayer.js – corrected getBranchData
const getBranchData = async (cooperativeId) => {
  try {
    const Cooperative = require('../../models/cooperative');
    const Transaction = require('../../models/transaction');
    const coop = await Cooperative.findById(cooperativeId);
    if (!coop) throw new Error('Cooperative not found');

    const branchStats = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coop._id } },
      {
        $lookup: {
          from: 'farmers',
          localField: 'farmer_id',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$farmer.branch_id', 'main'] },
          farmers: { $addToSet: '$farmer_id' },
          totalLitres: { $sum: '$litres' },
          totalPayout: { $sum: '$payout' },
          transactionCount: { $sum: 1 }
        }
      },
      {
        $project: {
          branch: '$_id',
          farmers: { $size: '$farmers' },
          totalLitres: 1,
          totalPayout: 1,
          transactionCount: 1
        }
      },
      { $sort: { totalLitres: -1 } }
    ]);

    return branchStats.map(b => ({
      branch: b.branch === 'main' ? 'Main Branch' : b.branch,
      farmers: b.farmers || 0,
      totalMilk: Math.round(b.totalLitres || 0),   // ✅ now has litres
      totalPayout: Math.round(b.totalPayout || 0),
      transactions: b.transactionCount || 0
    }));
  } catch (error) {
    const logger = require('../../utils/logger');
    logger.warn('getBranchData failed', { error: error.message, cooperativeId });
    return [];
  }
};
const getDefaultKPIs = () => ({
  avgMilkPerFarmerToday: 0,
  avgMilkPerFarmerWeek: 0,
  avgMilkPerFarmerMonth: 0,
  growthVsYesterday: '0%',
  growthVsLastWeek: '0%',
  growthVsLastMonth: '0%',
  peakCollectionHour: null,
  totalLitresToday: 0,
  activeFarmersToday: 0,
  totalTransactionsToday: 0,
  avgLitresPerTransaction: '0',
  retentionRate: '0%',
  weekTrend: { totalLitres: 0, avgPerDay: 0, activeFarmers: 0 },
  monthTrend: { totalLitres: 0, activeFarmers: 0 }
});

const getDefaultMilkQuality = () => ({
  rejectedToday: 0,
  rejectedPercentage: '0%',
  rejectedVolumePercentage: '0%',
  problemZones: [],
  totalMilkToday: 0,
  totalMilkLast7Days: 0,
  totalMilkLast30Days: 0,
  rejectionTrend: { daily: [] }
});

const getDefaultPayoutForecast = () => ({
  nextPayoutDate: null,
  estimatedAmount: 0,
  forecastNextPayout: 0,
  farmersToPay: 0,
  eligibleFarmers: [],
  payoutRateAssumed: 'KES 45 per litre',
  historicalMonthlyLitres: []
});

const getDefaultGrowth = () => ({
  farmersThisMonth: 0,
  farmersGrowthMonth: '0%',
  farmersGrowthQuarter: '0%',
  farmersGrowthYear: '0%',
  milkThisMonth: 0,
  milkGrowthMonth: '0%',
  milkGrowthQuarter: '0%',
  milkGrowthYear: '0%',
  feedThisMonth: 0,
  feedGrowthMonth: '0%',
  feedGrowthQuarter: '0%',
  feedGrowthYear: '0%',
  monthComparison: {
    farmersThisMonth: 0,
    farmersLastMonth: 0,
    milkThisMonth: 0,
    milkLastMonth: 0,
    feedThisMonth: 0,
    feedLastMonth: 0
  }
});

const getDefaultCEOStats = () => ({
  kpis: getDefaultKPIs(),
  zones: [],
  branches: [],
  farmerRisks: [],
  milkQuality: getDefaultMilkQuality(),
  inventoryVelocity: [],
  fraudSignals: [],
  payoutForecast: getDefaultPayoutForecast(),
  farmerValue: [],
  growth: getDefaultGrowth()
});

module.exports = { getCEOStats };