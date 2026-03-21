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

const getCEOStats = async (cooperativeId) => {  // ✅ FIXED
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

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
      { name: 'kpis', fn: () => operationalKPIsModule.getOperationalKPIs(cooperativeId), default: getDefaultKPIs() },
      { name: 'zones', fn: () => zoneIntelligenceModule.getZoneIntelligence(cooperativeId), default: [] },
      { name: 'branches', fn: () => getBranchData(cooperativeId), default: [] },
      { name: 'farmerRisks', fn: () => farmerBehaviorModule.getFarmerRisks(cooperativeId), default: [] },
      { name: 'milkQuality', fn: () => milkQualityModule.getMilkQuality(cooperativeId), default: getDefaultMilkQuality() },
      { name: 'inventoryVelocity', fn: () => inventoryVelocityModule.getInventoryVelocity(cooperativeId), default: [] },
      { name: 'fraudSignals', fn: () => fraudAdvancedModule.getAdvancedFraudSignals(cooperativeId), default: [] },
      { name: 'payoutForecast', fn: () => payoutForecastModule.getPayoutForecast(cooperativeId), default: getDefaultPayoutForecast() },
      { name: 'farmerValue', fn: () => farmerValueModule.getFarmerValue(cooperativeId), default: [] },
      { name: 'growth', fn: () => cooperativeGrowthModule.getCooperativeGrowth(cooperativeId), default: getDefaultGrowth() }
    ];

    for (const module of modules) {
      try {
        ceoStats[module.name] = await module.fn();
      } catch (error) {
        logger.warn(`${module.name} failed`, { error: error.message, coopId: cooperativeId });
        ceoStats[module.name] = module.default;
      }
    }

    return ceoStats;
  } catch (error) {
    logger.error('CEOStats failed', { error: error.message, coopId });
    return getDefaultCEOStats();
  }
};

const getBranchData = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  const branches = await Farmer.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    { $group: { _id: '$branch_id', farmerCount: { $sum: 1 } } },
    { $sort: { farmerCount: -1 } }
  ]);
  
  return branches.map(b => ({
    branch: b._id || 'main',
    totalMilk: 0,  // Would need transaction data
    farmers: b.farmerCount
  }));
};

const getDefaultKPIs = () => ({ 
  avgMilkPerFarmer: 0, 
  growthVsYesterday: '0%', 
  growthVsLastWeek: '0%', 
  peakCollectionHour: null,
  totalLitresToday: 0, 
  activeFarmersToday: 0 
});

const getDefaultMilkQuality = () => ({ rejectedToday: 0, rejectedPercentage: '0%', problemZones: [] });
const getDefaultPayoutForecast = () => ({ nextPayoutDate: null, estimatedAmount: 0, farmersToPay: 0 });
const getDefaultGrowth = () => ({ farmersJoinedThisMonth: 0, farmersGrowth: '0%', milkGrowth: '0%', feedSalesGrowth: '0%' });
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