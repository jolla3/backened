// analytics/engines/narrativeEngine.js
const { formatMoney, formatNumber, formatPercent, safeNumber } = require('../utils/formatters');

const generateNarrative = (context, financial, farmer, inventory, operations, forecast, decisions, health) => {
  const healthData = health.health || health;
  const sections = [];

  const healthScore = safeNumber(healthData.score);
  const healthStatus = healthData.status || 'Unknown';

  // ─── Executive Summary ──────────────────────────────────────
  let summaryText = `Overall Health: ${healthScore}% – ${healthStatus}. `;

  // Use component scores to explain
  const comp = healthData.components || {};
  const prod = comp.production || {};
  const fin = comp.finance || {};
  const ops = comp.operations || {};
  const frm = comp.farmers || {};
  const inv = comp.inventory || {};

  if (fin.score >= 80) {
    summaryText += `Finance remains strong with all farmer liabilities accurately tracked. `;
  } else if (fin.score < 60) {
    summaryText += `Finance needs attention: ${fin.reasons.join('; ')}. `;
  }

  if (inv.score >= 80 && inv.score < 100) {
    summaryText += `Inventory is stable although one product has reached its reorder threshold. `;
  } else if (inv.score < 60) {
    summaryText += `Inventory issues: ${inv.reasons.join('; ')}. `;
  }

  if (prod.score >= 70) {
    summaryText += `Production performance is acceptable. `;
  } else {
    summaryText += `Production performance needs improvement: ${prod.reasons.join('; ')}. `;
  }

  if (ops.score >= 70) {
    summaryText += `Operations remain healthy with successful collections. `;
  } else {
    summaryText += `Operations need attention: ${ops.reasons.join('; ')}. `;
  }

  if (frm.score >= 70) {
    summaryText += `Farmer base is stable. `;
  } else {
    summaryText += `Farmer base needs attention: ${frm.reasons.join('; ')}. `;
  }

  sections.push({
    type: 'executive_summary',
    healthScore,
    status: healthStatus,
    text: summaryText,
  });

  // ─── Financial Narrative ────────────────────────────────────
  let financialText = `This month, the cooperative collected ${formatNumber(financial.monthMilkLitres)} litres of milk, ` +
    `with a gross milk value of ${formatMoney(financial.grossMilkValue)}. ` +
    `Feed sales contributed ${formatMoney(financial.feedRevenue)}, ` +
    `of which ${formatMoney(financial.feedRevenueCash)} was cash and ${formatMoney(financial.feedRevenueBalance)} on balance. `;

  if (safeNumber(financial.amountToPayFarmers) > 0) {
    financialText += `The cooperative owes ${formatNumber(financial.farmersToPay)} farmers a total of ${formatMoney(financial.amountToPayFarmers)}. `;
  }
  if (safeNumber(financial.amountFarmersOweCoop) > 0) {
    financialText += `${formatNumber(financial.farmersOwingCoop)} farmers owe the cooperative ${formatMoney(financial.amountFarmersOweCoop)}. `;
  }
  sections.push({ type: 'financial_narrative', text: financialText });

  // ─── Operations Narrative ──────────────────────────────────
  let opsText = `Today, ${formatNumber(operations.activeFarmersToday)} farmers delivered ${formatNumber(operations.todayLitres)} litres across ${formatNumber(operations.todayTransactions)} transactions. `;
  opsText += `Collection efficiency is ${formatPercent(operations.collectionEfficiency)}, `;
  opsText += `with ${formatNumber(operations.missedCollections)} farmers missing today. `;
  opsText += `${formatNumber(operations.offlineDevices)} devices are offline. `;
  opsText += `Growth vs yesterday is ${operations.growthVsYesterday || '0%'}.`;
  sections.push({ type: 'operational_narrative', text: opsText });

  // ─── Risk Narrative ─────────────────────────────────────────
  const criticalRisks = farmer.risks.filter(r => r.overallRisk === 'CRITICAL');
  const highRisks = farmer.risks.filter(r => r.overallRisk === 'HIGH');
  let riskText = '';
  if (criticalRisks.length > 0) {
    riskText += `${criticalRisks.length} farmers are at CRITICAL risk: ${criticalRisks.map(r => r.farmer).join(', ')}. `;
  }
  if (highRisks.length > 0) {
    riskText += `${highRisks.length} farmers are at HIGH risk. `;
  }
  if (!riskText) riskText = 'No high-risk farmers detected.';

  const debtors = farmer.risks.filter(r => r.isDebtor);
  if (debtors.length > 0) {
    riskText += ` ${debtors.length} farmers have significant debt.`;
  }
  sections.push({ type: 'risk_narrative', text: riskText });

  // ─── Inventory Narrative ────────────────────────────────────
  let invText = '';
  if (inventory && inventory.items && inventory.items.length > 0) {
    const critical = inventory.items.filter(i => i.urgency === 'CRITICAL');
    const urgent = inventory.items.filter(i => i.urgency === 'URGENT');
    if (critical.length > 0) {
      invText += `CRITICAL: ${critical.map(i => i.product).join(', ')} need immediate reorder. `;
    }
    if (urgent.length > 0) {
      invText += `URGENT: ${urgent.map(i => i.product).join(', ')} should be reordered. `;
    }
    if (!invText) invText = 'All products have adequate stock.';
  } else {
    invText = 'Inventory module has not been initialized.';
  }
  sections.push({ type: 'inventory_narrative', text: invText });

  // ─── Forecast Narrative ─────────────────────────────────────
  let forecastText = '';
  if (forecast && forecast.hasEnoughData) {
    forecastText = `Next month's milk forecast is ${formatNumber(forecast.forecastLitres)}L (confidence ${formatNumber(forecast.confidence)}%). `;
    if (forecast.dailyForecast) {
      forecastText += `Tomorrow's milk is estimated at ${formatNumber(forecast.dailyForecast.forecastTomorrow)}L. `;
    }
  } else {
    forecastText = `Insufficient data for reliable forecast (need 7 days, have ${forecast?.daysAvailable || 0}).`;
  }
  sections.push({ type: 'forecast_narrative', text: forecastText });

  // ─── Top Priorities ──────────────────────────────────────────
  const topDecisions = decisions.slice(0, 3);
  sections.push({
    type: 'priorities',
    items: topDecisions.map(d => ({
      rank: d.priority,
      action: d.title,
      impact: d.impact,
      deadline: d.deadline,
    })),
  });

  return {
    healthScore,
    summary: `Overall Health: ${healthScore}% – ${healthStatus}`,
    sections,
  };
};

module.exports = { generateNarrative };