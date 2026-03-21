const financialAnalytics = require('../../analytics/financialAnalytics');
const alertsAndRecommendations = require('../../analytics/alertsAndRecommendations');
const predictiveAnalytics = require('../../analytics/predictiveAnalytics');
const smsAnalyticsModule = require('../../analytics/smsAnalytics');
const aiAdvisoryModule = require('../../analytics/aiAdvisory');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getIntelligenceLayer = async (cooperativeId) => {  // ✅ FIXED
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const intelligence = {
      financialIntelligence: getDefaultFinancialIntelligence(),
      alerts: [],
      recommendations: [],
      predictions: { stockout: [], farmerDropout: [] },
      sms: getDefaultSmsAnalytics(),
      aiAdvisory: []
    };

    const modules = [
      { name: 'financialIntelligence', fn: () => financialAnalytics.getFinancialIntelligence(cooperativeId) },
      { name: 'alerts', fn: () => alertsAndRecommendations.getSmartAlerts(cooperativeId) },
      { name: 'recommendations', fn: () => alertsAndRecommendations.getRecommendations(cooperativeId) },
      { name: 'predictions.stockout', fn: () => predictiveAnalytics.predictStockout(cooperativeId) },
      { name: 'predictions.farmerDropout', fn: () => predictiveAnalytics.predictFarmerDropout(cooperativeId) },
      { name: 'sms', fn: () => smsAnalyticsModule.getSmsAnalytics(cooperativeId) },
      { name: 'aiAdvisory', fn: () => aiAdvisoryModule.getAiAdvisory(cooperativeId) }
    ];

    for (const module of modules) {
      try {
        const result = await module.fn();
        if (module.name.includes('.')) {
          const [parent, child] = module.name.split('.');
          intelligence[parent][child] = result;
        } else {
          intelligence[module.name] = result;
        }
      } catch (error) {
        logger.warn(`${module.name} failed`, { error: error.message, coopId: cooperativeId });
      }
    }

    return intelligence;
  } catch (error) {
    logger.error('IntelligenceLayer failed', { error: error.message, coopId });
    return getDefaultIntelligenceLayer();
  }
};

const getDefaultFinancialIntelligence = () => ({
  milkRevenue: 0, feedRevenue: 0, farmerDebtTotal: 0, expectedMilkPayout: 0, netCashFlow: 0, profitMargin: 0
});

const getDefaultSmsAnalytics = () => ({ 
  smsSent: 0, 
  smsFailed: 0, 
  deliveryRate: '0%', 
  receiptsVerifiedToday: 0 
});

const getDefaultIntelligenceLayer = () => ({
  financialIntelligence: getDefaultFinancialIntelligence(),
  alerts: [],
  recommendations: [],
  predictions: { stockout: [], farmerDropout: [] },
  sms: getDefaultSmsAnalytics(),
  aiAdvisory: []
});

module.exports = { getIntelligenceLayer };