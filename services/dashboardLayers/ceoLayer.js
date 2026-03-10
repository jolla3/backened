const operationalKPIsModule = require('../../analytics/operationalKPIs');
const zoneIntelligenceModule = require('../../analytics/zoneIntelligence');
const farmerBehaviorModule = require('../../analytics/farmerBehavior');
const milkQualityModule = require('../../analytics/milkQuality');
const inventoryVelocityModule = require('../../analytics/inventoryVelocity');
const fraudAdvancedModule = require('../../analytics/fraudAdvanced');
const payoutForecastModule = require('../../analytics/payoutForecast');
const farmerValueModule = require('../../analytics/farmerValue');
const cooperativeGrowthModule = require('../../analytics/cooperativeGrowth');
const logger = require('../../utils/logger');

const getCEOStats = async () => {
  const ceoStats = {
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
  };

  const modules = [
    { name: 'kpis', fn: () => operationalKPIsModule.getOperationalKPIs(), default: getDefaultKPIs() },
    { name: 'zones', fn: () => zoneIntelligenceModule.getZoneIntelligence(), default: [] },
    { name: 'branches', fn: () => getBranchData(), default: [] },
    { name: 'farmerRisks', fn: () => farmerBehaviorModule.getFarmerRisks(), default: [] },
    { name: 'milkQuality', fn: () => milkQualityModule.getMilkQuality(), default: getDefaultMilkQuality() },
    { name: 'inventoryVelocity', fn: () => inventoryVelocityModule.getInventoryVelocity(), default: [] },
    { name: 'fraudSignals', fn: () => fraudAdvancedModule.getAdvancedFraudSignals(), default: [] },
    { name: 'payoutForecast', fn: () => payoutForecastModule.getPayoutForecast(), default: getDefaultPayoutForecast() },
    { name: 'farmerValue', fn: () => farmerValueModule.getFarmerValue(), default: [] },
    { name: 'growth', fn: () => cooperativeGrowthModule.getCooperativeGrowth(), default: getDefaultGrowth() }
  ];

  for (const module of modules) {
    try {
      ceoStats[module.name] = await module.fn();
    } catch (error) {
      logger.warn(`${module.name} failed`, { error: error.message });
      ceoStats[module.name] = module.default;
    }
  }

  return ceoStats;
};

const getBranchData = async () => {
  const branches = await require('../../models/farmer').aggregate([
    { $group: { _id: '$branch_id', totalMilk: { $sum: '$balance' } } }
  ]);
  return await Promise.all(
    branches.map(async b => ({
      branch: b._id || 'main',
      totalMilk: b.totalMilk,
      farmers: await require('../../models/farmer').countDocuments({ branch_id: b._id })
    }))
  );
};

const getDefaultKPIs = () => ({ 
  avgMilkPerFarmer: 0, 
  growthVsYesterday: '0%', 
  growthVsLastWeek: '0%', 
  peakCollectionHour: null, // ✅ FIXED: null instead of "N/A"
  totalLitresToday: 0, 
  activeFarmersToday: 0 
});

const getDefaultMilkQuality = () => ({ rejectedToday: 0, rejectedPercentage: '0%', problemZones: [] });
const getDefaultPayoutForecast = () => ({ nextPayoutDate: null, estimatedAmount: 0, farmersToPay: 0 });
const getDefaultGrowth = () => ({ farmersJoinedThisMonth: 0, farmersGrowth: '0%', milkGrowth: '0%', feedSalesGrowth: '0%' });

module.exports = { getCEOStats };