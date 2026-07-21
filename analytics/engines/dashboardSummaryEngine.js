// analytics/engines/dashboardSummaryEngine.js
const { safeNumber } = require('../utils/formatters');

const computeDashboardSummary = (context, financial, operations, health, decisions, forecast, opportunities) => {
  const healthData = health.health || health;
  const cashPosition = context.cashPosition || {};

  // ─── Rank business risks ONLY (not analytics limitations) ──
  let risks = [];

  // 1. Cash shortfall (critical)
  if (cashPosition.shortfall && cashPosition.shortfall > 0) {
    risks.push({
      level: 'critical',
      description: `Cash shortfall of KES ${cashPosition.shortfall.toLocaleString()} before farmer settlements`,
    });
  }

  // 2. Cash not tracked (warning)
  if (cashPosition && cashPosition.cashTracked === false && safeNumber(financial?.amountToPayFarmers) > 0) {
    risks.push({
      level: 'warning',
      description: 'Cash position not being tracked – settlements may be at risk',
    });
  }

  // 3. Inventory issues (warning)
  const invScore = healthData.components?.inventory?.score || 0;
  const invReasons = healthData.components?.inventory?.reasons || [];
  if (invScore < 70 && invReasons.length > 0) {
    risks.push({
      level: 'warning',
      description: `Inventory risk: ${invReasons.join('; ')}`,
    });
  }

  // 4. Operations issues (warning)
  const opsScore = healthData.components?.operations?.score || 0;
  const opsReasons = healthData.components?.operations?.reasons || [];
  if (opsScore < 70 && opsReasons.length > 0) {
    risks.push({
      level: 'warning',
      description: `Operations risk: ${opsReasons.join('; ')}`,
    });
  }

  // 5. Production issues (warning)
  const prodScore = healthData.components?.production?.score || 0;
  const prodReasons = healthData.components?.production?.reasons || [];
  if (prodScore < 70 && prodReasons.length > 0) {
    risks.push({
      level: 'warning',
      description: `Production risk: ${prodReasons.join('; ')}`,
    });
  }

  // 6. Farmer issues (warning)
  const farmerScore = healthData.components?.farmers?.score || 0;
  const farmerReasons = healthData.components?.farmers?.reasons || [];
  if (farmerScore < 70 && farmerReasons.length > 0) {
    risks.push({
      level: 'warning',
      description: `Farmer risk: ${farmerReasons.join('; ')}`,
    });
  }

  // ❌ Do NOT add forecast/unavailable/trend/anomaly issues – they belong in analyticsConfidence

  // Pick the highest priority risk
  const priorityOrder = { critical: 0, warning: 1 };
  risks.sort((a, b) => (priorityOrder[a.level] || 2) - (priorityOrder[b.level] || 2));
  const biggestRisk = risks.length > 0 ? risks[0].description : 'No critical business risks detected';

  // ─── Biggest opportunity ──────────────────────────────────────
  let biggestOpportunity = 'No significant opportunities identified';
  const topOpp = opportunities.length > 0 ? opportunities[0] : null;
  if (topOpp) {
    const cleanTitle = topOpp.title
      .replace(/Sell feed to /, '')
      .replace(/ who haven't purchased this month/, '');
    biggestOpportunity = `${cleanTitle} (KES ${topOpp.potentialRevenue.toLocaleString()})`;
  }

  // ─── Next action ──────────────────────────────────────────────
  const nextDecision = decisions.find(d => d.status === 'pending' && d.priority === 1) ||
                       decisions.find(d => d.status === 'pending');
  let nextAction = 'Monitor operations';
  if (nextDecision) {
    nextAction = nextDecision.title;
  }

  // ─── Cash required today ────────────────────────────────────
  const cashRequiredToday = cashPosition.expectedCashNeeded
    ? Math.round(cashPosition.expectedCashNeeded * 0.3)
    : Math.round(safeNumber(financial.amountToPayFarmers) * 0.3);

  // ─── Notifications ──────────────────────────────────────────
  const criticalIncidents = decisions.filter(d => d.status === 'pending' && d.priority === 1).length;
  const warningIncidents = decisions.filter(d => d.status === 'pending' && d.priority === 2).length;
  const infoIncidents = decisions.filter(d => d.status === 'pending' && d.priority >= 3).length;
  const healthReasonsCount = healthData.reasons?.length || 0;

  // Only include health reasons if they're business related (not analytics)
  const businessReasons = (healthData.reasons || []).filter(r =>
    !r.includes('forecast') &&
    !r.includes('history') &&
    !r.includes('data') &&
    !r.includes('inventory not configured')
  );

  const notifications = {
    critical: criticalIncidents + (cashPosition.shortfall > 0 ? 1 : 0),
    warning: warningIncidents + (businessReasons.length > 0 ? 1 : 0),
    info: infoIncidents + (businessReasons.length > 1 ? businessReasons.length - 1 : 0),
    total: criticalIncidents + warningIncidents + infoIncidents + businessReasons.length + (cashPosition.shortfall > 0 ? 1 : 0),
  };

  return {
    score: healthData.score,
    status: healthData.status,
    biggestRisk,
    biggestOpportunity,
    nextAction,
    cashRequiredToday,
    notifications,
    components: {
      production: {
        score: healthData.components?.production?.score || 0,
        reasons: healthData.components?.production?.reasons || [],
      },
      finance: {
        score: healthData.components?.finance?.score || 0,
        reasons: healthData.components?.finance?.reasons || [],
      },
      cash: {
        score: healthData.components?.cash?.score || 0,
        reasons: healthData.components?.cash?.reasons || [],
      },
      operations: {
        score: healthData.components?.operations?.score || 0,
        reasons: healthData.components?.operations?.reasons || [],
      },
      farmers: {
        score: healthData.components?.farmers?.score || 0,
        reasons: healthData.components?.farmers?.reasons || [],
      },
      inventory: {
        score: healthData.components?.inventory?.score || 0,
        reasons: healthData.components?.inventory?.reasons || [],
      },
    },
  };
};

module.exports = { computeDashboardSummary };