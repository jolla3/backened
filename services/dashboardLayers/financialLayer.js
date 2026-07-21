// services/financial.js
const { getFinancialIntelligence } = require('../../analytics/financialAnalytics');
const logger = require('../../utils/logger');


const getFinancial = async (cooperativeId) => {
  try {
    const analytics = await getFinancialIntelligence(cooperativeId);

    return {
      // Operational
      milkLitres: analytics.milkLitres,
      milkValueGenerated: analytics.milkValueGenerated,
      feedRevenue: analytics.feedRevenue,
      feedQuantity: analytics.feedQuantity,
      feedRevenueCash: analytics.feedRevenueCash,
      feedRevenueBalance: analytics.feedRevenueBalance,
      todayMilkPayout: analytics.todayMilkPayout,
      todayMilkLitres: analytics.todayMilkLitres,

      // Current balances
      amountToPayFarmers: analytics.amountToPayFarmers,
      amountFarmersOweCoop: analytics.amountFarmersOweCoop,
      farmersToPay: analytics.farmersToPay,
      farmersOwingCoop: analytics.farmersOwingCoop,
      farmersWithZero: analytics.farmersWithZero,

      avgPricePerLiter: analytics.avgPricePerLiter,

      hasRealData: analytics.hasRealData,
    };
  } catch (error) {
    logger.error('Financial layer failed', { cooperativeId, error: error.message });
    return getDefaultFinancial();
  }
};

const getDefaultFinancial = () => ({
  milkLitres: 0,
  milkValueGenerated: 0,
  feedRevenue: 0,
  feedQuantity: 0,
  feedRevenueCash: 0,
  feedRevenueBalance: 0,
  todayMilkPayout: 0,
  todayMilkLitres: 0,
  amountToPayFarmers: 0,
  amountFarmersOweCoop: 0,
  farmersToPay: 0,
  farmersOwingCoop: 0,
  farmersWithZero: 0,
  avgPricePerLiter: 0,
  hasRealData: false,
});

module.exports = { getFinancial };