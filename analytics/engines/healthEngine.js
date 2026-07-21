// analytics/engines/healthEngine.js
const CONFIG = require('../analyticsConfig');
const { safeNumber } = require('../utils/formatters');

const computeHealth = (financial, operations, farmer, inventory, forecast, cashPosition) => {
  // ─── Production (20%) ──────────────────────────────────────────
  let productionScore = 100;
  const productionReasons = [];

  const weekAvg = operations?.weekTrend?.avgPerDay || 0;
  const todayLitres = safeNumber(operations?.todayLitres);
  if (weekAvg > 0 && todayLitres < weekAvg * 0.5) {
    productionScore -= 20;
    productionReasons.push('Today\'s milk is 50% below weekly average');
  } else if (weekAvg > 0 && todayLitres < weekAvg * 0.8) {
    productionScore -= 10;
    productionReasons.push('Today\'s milk is below weekly average');
  }

  const totalFarmers = safeNumber(operations?.totalFarmers);
  const activeToday = safeNumber(operations?.activeFarmersToday);
  const activeRatio = totalFarmers > 0 ? activeToday / totalFarmers : 0;
  if (activeRatio < 0.3) {
    productionScore -= 25;
    productionReasons.push('Less than 30% of farmers delivered today');
  } else if (activeRatio < 0.5) {
    productionScore -= 10;
    productionReasons.push('Less than 50% of farmers delivered today');
  }

  productionScore = Math.max(0, Math.min(100, productionScore));

  // ─── Finance (20%) ──────────────────────────────────────────────
  let financeScore = 100;
  const financeReasons = [];

  const liability = safeNumber(financial?.amountToPayFarmers);
  const feedRevenue = safeNumber(financial?.feedRevenue);
  if (feedRevenue > 0 && liability > feedRevenue * 1.2) {
    financeScore -= 20;
    financeReasons.push('Farmer liability exceeds feed revenue by 20%');
  } else if (feedRevenue > 0 && liability > feedRevenue) {
    financeScore -= 10;
    financeReasons.push('Farmer liability exceeds feed revenue');
  }

  const debt = safeNumber(financial?.amountFarmersOweCoop);
  if (debt > CONFIG.CRITICAL_DEBT) {
    financeScore -= 15;
    financeReasons.push('High farmer debt (> 10,000 KES)');
  } else if (debt > CONFIG.HIGH_DEBT) {
    financeScore -= 5;
    financeReasons.push('Moderate farmer debt');
  }

  const farmersToPay = safeNumber(financial?.farmersToPay);
  const avgLiabilityPerFarmer = farmersToPay > 0 ? liability / farmersToPay : 0;
  if (avgLiabilityPerFarmer > 10000) {
    financeScore -= 10;
    financeReasons.push('Average liability per farmer exceeds 10,000 KES');
  }

  financeScore = Math.max(0, Math.min(100, financeScore));

  // ─── Cash (10%) ─────────────────────────────────────────────────
  let cashScore = 100;
  const cashReasons = [];
  if (!cashPosition?.cashTracked) {
    cashScore = 0;
    cashReasons.push('Cash not tracked');
  } else if (cashPosition.shortfall && cashPosition.shortfall > 0) {
    const shortfallRatio = Math.min(1, cashPosition.shortfall / cashPosition.expectedCashNeeded);
    cashScore = Math.max(0, 100 - Math.round(shortfallRatio * 50));
    cashReasons.push(`Cash shortfall of ${cashPosition.shortfall}`);
  }
  cashScore = Math.max(0, Math.min(100, cashScore));

  // ─── Operations (20%) ───────────────────────────────────────────
  let operationsScore = 100;
  const opsReasons = [];

  const collectionEff = safeNumber(operations?.collectionEfficiency);
  if (collectionEff < 30) {
    operationsScore -= 30;
    opsReasons.push('Collection efficiency below 30%');
  } else if (collectionEff < 50) {
    operationsScore -= 15;
    opsReasons.push('Collection efficiency below 50%');
  }

  const offline = safeNumber(operations?.offlineDevices);
  if (offline > 3) {
    operationsScore -= 15;
    opsReasons.push(`${offline} devices offline`);
  } else if (offline > 1) {
    operationsScore -= 5;
    opsReasons.push(`${offline} devices offline`);
  }

  const missed = safeNumber(operations?.missedCollections);
  if (missed > 5) {
    operationsScore -= 10;
    opsReasons.push(`${missed} farmers missed today`);
  } else if (missed > 2) {
    operationsScore -= 5;
    opsReasons.push(`${missed} farmers missed today`);
  }

  operationsScore = Math.max(0, Math.min(100, operationsScore));

  // ─── Farmers (20%) ─────────────────────────────────────────────
  let farmerScore = 100;
  const farmerReasons = [];

  const retention = farmer?.retention?.retentionRate || 0;
  if (retention < 50 && retention > 0) {
    farmerScore -= 25;
    farmerReasons.push(`Retention rate is ${Math.round(retention)}%`);
  } else if (retention < 80 && retention > 0) {
    farmerScore -= 10;
    farmerReasons.push(`Retention rate is ${Math.round(retention)}%`);
  }

  const criticalRisks = farmer?.risks?.filter(r => r.overallRisk === 'CRITICAL').length || 0;
  if (criticalRisks > 0) {
    farmerScore -= 20;
    farmerReasons.push(`${criticalRisks} farmers at critical risk`);
  }

  const inactive = farmer?.retention?.inactiveFarmers || 0;
  if (inactive > 3) {
    farmerScore -= 10;
    farmerReasons.push(`${inactive} farmers inactive`);
  }

  farmerScore = Math.max(0, Math.min(100, farmerScore));

  // ─── Inventory (10%) ────────────────────────────────────────────
  let inventoryScore = 100;
  const invReasons = [];

  const inventoryItems = inventory?.items || [];
  if (inventoryItems.length > 0) {
    const outOfStock = inventory?.summary?.outOfStock || 0;
    const lowStock = inventory?.summary?.lowStock || 0;
    if (outOfStock > 0) {
      inventoryScore -= 25;
      invReasons.push(`${outOfStock} products out of stock`);
    }
    if (lowStock > 0) {
      inventoryScore -= 10;
      invReasons.push(`${lowStock} products low stock`);
    }
  } else {
    inventoryScore = 50;
    invReasons.push('No inventory records');
  }

  inventoryScore = Math.max(0, Math.min(100, inventoryScore));

  // ─── Overall Health Score (weighted) ──────────────────────────
  const overallScore = Math.round(
    (productionScore * 0.20) +
    (financeScore * 0.20) +
    (cashScore * 0.10) +
    (operationsScore * 0.20) +
    (farmerScore * 0.20) +
    (inventoryScore * 0.10)
  );

  let status = 'Good';
  if (overallScore < CONFIG.HEALTH_WARNING) status = 'Critical';
  else if (overallScore < CONFIG.HEALTH_FAIR) status = 'Warning';
  else if (overallScore < CONFIG.HEALTH_GOOD) status = 'Fair';

  // ❌ Do NOT include forecast reasons in health – they belong to confidence
  const allReasons = [
    ...productionReasons,
    ...financeReasons,
    ...cashReasons,
    ...opsReasons,
    ...farmerReasons,
    ...invReasons,
  ];

  const health = {
    score: overallScore,
    status,
    reasons: allReasons.slice(0, 5),
    components: {
      production: { score: productionScore, weight: 20, reasons: productionReasons },
      finance: { score: financeScore, weight: 20, reasons: financeReasons },
      cash: { score: cashScore, weight: 10, reasons: cashReasons },
      operations: { score: operationsScore, weight: 20, reasons: opsReasons },
      farmers: { score: farmerScore, weight: 20, reasons: farmerReasons },
      inventory: { score: inventoryScore, weight: 10, reasons: invReasons },
    },
  };

  // ─── Analytics Confidence (separate) ──────────────────────────
  let confidenceReasons = [];
  let daysAvailable = forecast?.daysAvailable || 0;
  let confidenceScore = 100;

  if (daysAvailable < 7) {
    confidenceScore -= 20;
    confidenceReasons.push(`Only ${daysAvailable} collection days (need 7 for daily forecast)`);
  } else if (daysAvailable < 30) {
    confidenceScore -= 10;
    confidenceReasons.push(`Only ${daysAvailable} collection days (need 30 for weekly forecast)`);
  }

  if (!forecast?.dailyForecast) {
    confidenceScore -= 15;
    confidenceReasons.push('Daily forecast unavailable');
  }

  if (!inventory || inventory.status === 'NOT_CONFIGURED' || inventory.items?.length === 0) {
    confidenceScore -= 10;
    confidenceReasons.push('Inventory not configured or empty');
  }

  if (!forecast || !forecast.hasEnoughData) {
    confidenceScore -= 10;
    confidenceReasons.push('Limited historical trend data');
  }

  confidenceScore = Math.max(20, Math.min(100, confidenceScore));

  let confidenceLevel = 'High';
  if (confidenceScore < 40) confidenceLevel = 'Very Low';
  else if (confidenceScore < 55) confidenceLevel = 'Low';
  else if (confidenceScore < 70) confidenceLevel = 'Medium';
  else if (confidenceScore < 85) confidenceLevel = 'High';
  else confidenceLevel = 'Excellent';

  const confidence = {
    score: confidenceScore,
    level: confidenceLevel,
    reasons: confidenceReasons.slice(0, 5),
  };

  return {
    health,
    confidence,
  };
};

module.exports = { computeHealth };