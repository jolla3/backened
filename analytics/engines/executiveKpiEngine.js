// analytics/engines/executiveKpiEngine.js
const computeExecutiveKPI = (financial, operations, health, trends) => {
  return {
    cashHealth: financial.intelligence.liquidity,
    milkGrowth: trends.trend7,
    retention: parseFloat(operations.retentionRate),
    liquidity: financial.intelligence.liquidity,
    profitability: financial.intelligence.profitability,
    riskIndex: operations.offlineDevices + operations.missedCollections + (financial.farmersOwingCoop > 0 ? 1 : 0),
    overallScore: health.score,
    timestamp: new Date().toISOString(),
  };
};

module.exports = { computeExecutiveKPI };