// services/reports/cardsBuilder.js
const buildCards = (executiveKpis) => {
  const {
    milkOperations,
    cooperativeRevenue,
    cooperativeLiability,
    financialHealth
  } = executiveKpis;

  return {
    milkOperations: [
      { id: 'milk_collected', title: 'Milk Collected', value: milkOperations.totalLitres, unit: 'Litres', color: '#00B4D8', icon: 'water_drop' },
      { id: 'gross_milk_value', title: 'Gross Milk Value', value: milkOperations.grossMilkValue, currency: 'KES', color: '#00B4D8' },
      { id: 'active_farmers', title: 'Active Farmers', value: milkOperations.activeFarmers, unit: ' farmers', color: '#00B4D8' },
      { id: 'collection_efficiency', title: 'Collection Efficiency', value: milkOperations.collectionEfficiency, unit: '%', color: '#00B4D8' },
    ],
    cooperativeRevenue: [
      { id: 'feed_revenue', title: 'Feed Revenue', value: cooperativeRevenue.feedRevenue, currency: 'KES', color: '#16A34A' },
      { id: 'cash_feed_sales', title: 'Cash Feed Sales', value: cooperativeRevenue.cashFeedSales, currency: 'KES', color: '#16A34A' },
      { id: 'balance_feed_sales', title: 'Balance Feed Sales', value: cooperativeRevenue.balanceFeedSales, currency: 'KES', color: '#16A34A' },
    ],
    cooperativeLiability: [
      { id: 'current_liability', title: 'Current Farmer Liability', value: cooperativeLiability.currentFarmerLiability, currency: 'KES', color: '#7C3AED' },
      { id: 'settlements_paid', title: 'Settlements Paid', value: cooperativeLiability.settlementsPaid, currency: 'KES', color: '#16A34A' },
      { id: 'pending_settlements', title: 'Pending Settlements', value: cooperativeLiability.pendingSettlements, currency: 'KES', color: '#D97706' },
      { id: 'farmers_in_debt', title: 'Farmers in Debt', value: cooperativeLiability.farmersInDebt, unit: ' farmers', color: '#EF4444' },
      { id: 'farmer_debt', title: 'Farmer Debt', value: cooperativeLiability.farmerDebt, currency: 'KES', color: '#EF4444' },
    ],
    financialHealth: [
      { id: 'liability_coverage', title: 'Liability Coverage', value: financialHealth.liabilityCoverage !== null ? financialHealth.liabilityCoverage : 'N/A', unit: '%', color: '#7C3AED' },
      { id: 'settlement_completion', title: 'Settlement Completion', value: financialHealth.settlementCompletionRate, unit: '%', color: '#00B4D8' },
    ]
  };
};

module.exports = { buildCards };