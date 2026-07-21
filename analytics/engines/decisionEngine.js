// analytics/engines/decisionEngine.js
const CONFIG = require('../analyticsConfig');
const { formatMoney, safeNumber } = require('../utils/formatters');

const computeDecisions = (context, financial, farmer, inventory, operations, forecast) => {
  const decisions = [];

  // ─── 1. Farmer settlements (always if liability exists) ────
  if (safeNumber(financial.amountToPayFarmers) > 0) {
    decisions.push({
      id: 'dec_001',
      priority: CONFIG.PRIORITY_CRITICAL,
      title: 'Prepare farmer settlements',
      description: `${formatMoney(financial.amountToPayFarmers)} due to ${safeNumber(financial.farmersToPay)} farmers`,
      impact: 'Critical',
      confidence: 98,
      expectedBenefit: 'Maintain farmer trust',
      deadline: forecast.nextPayoutDate || 'As soon as possible',
      category: 'finance',
      status: 'pending',
    });
  }

  // ─── 2. Inventory reorder ──────────────────────────────────
  const inventoryItems = inventory?.items || [];
  const criticalStock = inventoryItems.filter(i => i.urgency === 'CRITICAL');
  if (criticalStock.length > 0) {
    decisions.push({
      id: 'dec_002',
      priority: CONFIG.PRIORITY_HIGH,
      title: `Reorder ${criticalStock.map(i => i.product).join(', ')}`,
      description: `${criticalStock.length} products critically low`,
      impact: 'High',
      confidence: 95,
      expectedBenefit: 'Prevent revenue loss',
      deadline: `Within ${Math.min(...criticalStock.map(i => i.daysUntilStockout))} days`,
      category: 'inventory',
      status: 'pending',
    });
  }

  // ─── 3. Farmer visits ──────────────────────────────────────
  const criticalFarmers = farmer.risks.filter(r => r.overallRisk === 'CRITICAL');
  if (criticalFarmers.length > 0) {
    decisions.push({
      id: 'dec_003',
      priority: CONFIG.PRIORITY_HIGH,
      title: `Visit ${criticalFarmers.map(f => f.farmer).join(', ')}`,
      description: `${criticalFarmers.length} farmers at critical risk`,
      impact: 'High',
      confidence: 80,
      expectedBenefit: `Recover up to ${formatMoney(criticalFarmers.reduce((s, f) => s + (f.estimatedRevenueAtRisk || 0), 0))}`,
      deadline: '48 hours',
      category: 'farmer',
      status: 'pending',
    });
  }

  // ─── 4. Debt recovery ──────────────────────────────────────
  if (safeNumber(financial.amountFarmersOweCoop) > CONFIG.CRITICAL_DEBT) {
    decisions.push({
      id: 'dec_004',
      priority: CONFIG.PRIORITY_MEDIUM,
      title: 'Initiate debt recovery process',
      description: `${safeNumber(financial.farmersOwingCoop)} farmers owe ${formatMoney(financial.amountFarmersOweCoop)}`,
      impact: 'Medium',
      confidence: 70,
      expectedBenefit: `Improve cash position by ${formatMoney(financial.amountFarmersOweCoop)}`,
      deadline: '2 weeks',
      category: 'finance',
      status: 'pending',
    });
  }

  // ─── 5. Inactive farmers ──────────────────────────────────
  const inactiveCount = farmer.risks.filter(r => r.overallRisk === 'HIGH' || r.overallRisk === 'MEDIUM').length;
  if (inactiveCount > 3) {
    decisions.push({
      id: 'dec_005',
      priority: CONFIG.PRIORITY_MEDIUM,
      title: `Contact ${inactiveCount} inactive farmers`,
      description: 'Farmers with declining or no deliveries',
      impact: 'Medium',
      confidence: 75,
      expectedBenefit: 'Recover at least 20% of lost production',
      deadline: '7 days',
      category: 'farmer',
      status: 'pending',
    });
  }

  return decisions.sort((a, b) => a.priority - b.priority);
};

module.exports = { computeDecisions };