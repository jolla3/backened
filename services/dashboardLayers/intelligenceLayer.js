const financialAnalytics = require('../../analytics/financialAnalytics');
const alertsAndRecommendations = require('../../analytics/alertsAndRecommendations');
const predictiveAnalytics = require('../../analytics/predictiveAnalytics');
const smsAnalyticsModule = require('../../analytics/smsAnalytics');
const aiAdvisoryModule = require('../../analytics/aiAdvisory');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getIntelligenceLayer = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const intelligence = {
    financialIntelligence: getDefaultFinancialIntelligence(),
    alerts: [],
    recommendations: [],
    predictions: { stockout: [], farmerDropout: [] },
    sms: getDefaultSmsAnalytics(),
    aiAdvisory: []
  };

  try {
    intelligence.financialIntelligence = await financialAnalytics.getFinancialIntelligence(adminId);
  } catch (error) {
    logger.warn('Financial intelligence failed', { error: error.message });
  }

  try {
    intelligence.alerts = await alertsAndRecommendations.getSmartAlerts(adminId);
  } catch (error) {
    logger.warn('Smart alerts failed', { error: error.message });
  }

  try {
    intelligence.recommendations = await alertsAndRecommendations.getRecommendations(adminId);
  } catch (error) {
    logger.warn('Recommendations failed', { error: error.message });
  }

  try {
    intelligence.predictions.stockout = await predictiveAnalytics.predictStockout(adminId);
  } catch (error) {
    logger.warn('Stockout predictions failed', { error: error.message });
  }

  try {
    intelligence.predictions.farmerDropout = await predictiveAnalytics.predictFarmerDropout(adminId);
  } catch (error) {
    logger.warn('Farmer dropout predictions failed', { error: error.message });
  }

  try {
    intelligence.sms = await smsAnalyticsModule.getSmsAnalytics(adminId);
  } catch (error) {
    logger.warn('SMS analytics failed', { error: error.message });
  }

  try {
    intelligence.aiAdvisory = await aiAdvisoryModule.getAiAdvisory(adminId);
  } catch (error) {
    logger.warn('AI advisory failed', { error: error.message });
  }

  return intelligence;
};

const getDefaultFinancialIntelligence = () => ({
  milkRevenue: 0, feedRevenue: 0, farmerDebtTotal: 0, expectedMilkPayout: 0, netCashFlow: 0, profitMargin: 0, todayMilkPayout: 0, todayMilkLitres: 0
});

const getDefaultSmsAnalytics = () => ({ smsSent: 0, smsFailed: 0, deliveryRate: '0%', receiptsVerifiedToday: 0 });

module.exports = { getIntelligenceLayer };