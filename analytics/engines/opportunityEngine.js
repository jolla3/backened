// analytics/engines/opportunityEngine.js
const { formatMoney, safeNumber } = require('../utils/formatters');

const computeOpportunities = (context, financial, farmer, inventory) => {
  const opportunities = [];

  // 1. Recover inactive farmers
  const inactive = farmer.risks.filter(r => r.overallRisk === 'CRITICAL' || r.overallRisk === 'HIGH');
  if (inactive.length > 0) {
    const avgLitres = inactive.reduce((s, f) => s + (f.totalLitres || 0), 0) / inactive.length;
    const potential = Math.round(avgLitres * 55 * 30);
    opportunities.push({
      id: 'opp_001',
      title: `Re-engage ${inactive.length} inactive farmers`,
      description: `These farmers used to deliver ${Math.round(avgLitres)}L/day.`,
      farmerCodes: inactive.map(f => f.farmerCode).filter(Boolean),
      math: `${inactive.length} farmers × ${Math.round(avgLitres)}L/day × 30 days × KES 55 = KES ${potential.toLocaleString()}`,
      potentialRevenue: potential,
      probability: 45,
      action: `Contact ${inactive.map(f => f.farmer).join(', ')} within 48 hours`,
      effort: 'High',
    });
  }

  // 2. Increase feed sales to active farmers
  const farmersWithoutFeed = farmer.value.filter(f => (f.lifetimeFeedPurchased || 0) === 0);
  if (farmersWithoutFeed.length > 0) {
    const potential = farmersWithoutFeed.length * 5 * 150;
    opportunities.push({
      id: 'opp_002',
      title: `Sell feed to ${farmersWithoutFeed.length} farmer${farmersWithoutFeed.length > 1 ? 's' : ''} who haven't purchased this month`,
      description: `These farmers bought no feed this month.`,
      farmerCodes: farmersWithoutFeed.map(f => f.code).filter(Boolean),
      math: `${farmersWithoutFeed.length} farmers × 5 units × KES 150 = KES ${potential.toLocaleString()}`,
      potentialRevenue: potential,
      probability: 60,
      action: 'Send targeted SMS promotion',
      effort: 'Low',
    });
  }

  // 3. Critical stock reorder savings
  const critical = inventory.items?.filter(i => i.urgency === 'CRITICAL') || [];
  if (critical.length > 0) {
    const totalSavings = critical.reduce((s, i) => s + Math.round(safeNumber(i.currentStock) * safeNumber(i.avgPrice) * 0.1), 0);
    opportunities.push({
      id: 'opp_003',
      title: `Restock ${critical.map(i => i.product).join(', ')} early`,
      description: 'Bulk ordering can reduce costs.',
      farmerCodes: [],
      math: `Bulk discount of 10% on ${critical.length} products = KES ${totalSavings.toLocaleString()}`,
      potentialRevenue: totalSavings,
      probability: 85,
      action: 'Place combined order for all critical items',
      effort: 'Low',
    });
  }

  // 4. Debt recovery
  if (safeNumber(financial.amountFarmersOweCoop) > 50000) {
    const debt = safeNumber(financial.amountFarmersOweCoop);
    opportunities.push({
      id: 'opp_004',
      title: 'Recover outstanding farmer debt',
      description: `${safeNumber(financial.farmersOwingCoop)} farmers owe ${formatMoney(debt)}`,
      farmerCodes: farmer.risks.filter(r => r.isDebtor).map(r => r.farmerCode).filter(Boolean),
      math: `Outstanding debt: KES ${debt.toLocaleString()}`,
      potentialRevenue: debt,
      probability: 35,
      action: 'Send formal debt collection notices',
      effort: 'High',
    });
  }

  return opportunities.sort((a, b) => b.potentialRevenue - a.potentialRevenue);
};

module.exports = { computeOpportunities };