const financialAnalytics = require('../../analytics/financialAnalytics');
const alertsAndRecommendations = require('../../analytics/alertsAndRecommendations');
const predictiveAnalytics = require('../../analytics/predictiveAnalytics');
const smsAnalyticsModule = require('../../analytics/smsAnalytics');
const aiAdvisoryModule = require('../../analytics/aiAdvisory');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');
const getIntelligenceLayer = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const intelligence = {
      financialIntelligence: {},
      alerts: [],
      recommendations: [],
      predictions: { stockout: [], farmerDropout: [], milkProduction: {} },
      sms: {},
      aiAdvisory: []
    };

    const [
      financial,
      alerts,
      recommendations,
      stockoutPred,
      dropoutPred,
      milkProdPred,
      sms,
      advisory
    ] = await Promise.allSettled([
      financialAnalytics.getFinancialIntelligence(cooperativeId),
      alertsAndRecommendations.getSmartAlerts(cooperativeId),
      alertsAndRecommendations.getRecommendations(cooperativeId),
      predictiveAnalytics.predictStockout(cooperativeId),
      predictiveAnalytics.predictFarmerDropout(cooperativeId),
      predictiveAnalytics.predictMilkProduction(cooperativeId),
      smsAnalyticsModule.getSmsAnalytics(cooperativeId),
      aiAdvisoryModule.getAiAdvisory(cooperativeId)
    ]);

    intelligence.financialIntelligence = financial.status === 'fulfilled' ? financial.value : getDefaultFinancial();
    intelligence.alerts = alerts.status === 'fulfilled' ? alerts.value : [];
    intelligence.recommendations = recommendations.status === 'fulfilled' ? recommendations.value : [];
    intelligence.predictions.stockout = stockoutPred.status === 'fulfilled' ? stockoutPred.value : [];
    intelligence.predictions.farmerDropout = dropoutPred.status === 'fulfilled' ? dropoutPred.value : [];
    intelligence.predictions.milkProduction = milkProdPred.status === 'fulfilled' ? milkProdPred.value : {};
    intelligence.sms = sms.status === 'fulfilled' ? sms.value : getDefaultSms();
    intelligence.aiAdvisory = advisory.status === 'fulfilled' ? advisory.value : [];

    return intelligence;
  } catch (error) {
    logger.error('IntelligenceLayer failed', { error: error.message, coopId });
    return getDefaultIntelligenceLayer();
  }
};

const getDefaultFinancial = () => ({
  milkRevenue: 0, feedRevenue: 0, farmerDebtTotal: 0, netCashFlow: 0, profitMargin: 0,
});

const getDefaultSms = () => ({
  smsSent: 0, smsFailed: 0, deliveryRate: '0%', receiptsVerifiedToday: 0, dailyTrend: [],
});

const getDefaultIntelligenceLayer = () => ({
  financialIntelligence: getDefaultFinancial(),
  alerts: [],
  recommendations: [],
  predictions: { stockout: [], farmerDropout: [], milkProduction: {} },
  sms: getDefaultSms(),
  aiAdvisory: [],
});

module.exports = { getIntelligenceLayer };