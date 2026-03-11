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
const logger = require('../../utils/logger');

const getCEOStats = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
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
    { name: 'kpis', fn: () => operationalKPIsModule.getOperationalKPIs(adminId), default: getDefaultKPIs() },
    { name: 'zones', fn: () => zoneIntelligenceModule.getZoneIntelligence(adminId), default: [] },
    { name: 'branches', fn: () => getBranchData(adminId), default: [] },
    { name: 'farmerRisks', fn: () => farmerBehaviorModule.getFarmerRisks(adminId), default: [] },
    { name: 'milkQuality', fn: () => milkQualityModule.getMilkQuality(adminId), default: getDefaultMilkQuality() },
    { name: 'inventoryVelocity', fn: () => inventoryVelocityModule.getInventoryVelocity(adminId), default: [] },
    { name: 'fraudSignals', fn: () => fraudAdvancedModule.getAdvancedFraudSignals(adminId), default: [] },
    { name: 'payoutForecast', fn: () => payoutForecastModule.getPayoutForecast(adminId), default: getDefaultPayoutForecast() },
    { name: 'farmerValue', fn: () => farmerValueModule.getFarmerValue(adminId), default: [] },
    { name: 'growth', fn: () => cooperativeGrowthModule.getCooperativeGrowth(adminId), default: getDefaultGrowth() }
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

const getBranchData = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  const branches = await Farmer.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    { $group: { _id: '$branch_id', totalMilk: { $sum: '$balance' } } }
  ]);
  return await Promise.all(
    branches.map(async b => ({
      branch: b._id || 'main',
      totalMilk: b.totalMilk,
      farmers: await Farmer.countDocuments({ cooperativeId: cooperative._id, branch_id: b._id })
    }))
  );
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

module.exports = { getCEOStats };