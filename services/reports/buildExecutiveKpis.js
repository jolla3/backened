// services/reports/executiveKpiBuilder.js
const buildExecutiveKpis = (operational, financial, settlement) => {
  const { overview, farmerPerformance, porterPerformance, inventory, trends, zoneBreakdown } = operational;
  const { movementBreakdown, debtDetails, feedRevenueByProduct, farmerSummaries, farmerBalances } = financial;
  const { summary: settlementSummary } = settlement;

  // ── Operational basics ──
  const totalLitres = overview.totalMilkLitres || 0;
  const activeFarmers = overview.activeFarmersWithDeliveries || 0;
  const totalFarmers = overview.totalFarmers || 0;
  const collectionEfficiency = totalFarmers > 0 ? (activeFarmers / totalFarmers) * 100 : 0;
  const transactions = overview.totalMilkTransactions || 0;

  // ── Gross Milk Value (from Ledger, not operational) ──
  const grossMilkValue = movementBreakdown?.MILK_CREDIT?.amount || 0;
  const averageRate = totalLitres > 0 ? grossMilkValue / totalLitres : 0;

  // ── Feed Revenue ──
  const feedDebitAmount = movementBreakdown?.FEED_DEBIT?.amount || 0;
  const feedCashSaleAmount = movementBreakdown?.FEED_CASH_SALE?.amount || 0;
  const totalFeedRevenue = feedDebitAmount + feedCashSaleAmount;
  const balanceFeedSales = feedDebitAmount;
  const cashFeedSales = feedCashSaleAmount;

  // ── Liability (from Farmer.currentBalance) ──
  const currentFarmerLiability = financial.currentLiability || 0;
  const farmerDebtValue = financial.farmerDebt || 0;
  const farmersInDebtCount = financial.farmersInDebt || 0;

  // ── Settlements ──
  const settlementsPaid = settlementSummary.totalPaid || 0;
  const pendingSettlements = settlementSummary.totalPendingAmount || 0;
  const settlementCompletionRate = settlementSummary.totalNetPayable > 0
    ? (settlementSummary.totalPaid / settlementSummary.totalNetPayable) * 100
    : 0;

  // ── Liability Coverage (settlements paid / current liability) ──
  const liabilityCoverage = currentFarmerLiability > 0
    ? (settlementsPaid / currentFarmerLiability) * 100
    : null;

  // ── Internal deductions (for information) ──
  const internalDeductions = feedDebitAmount
    + (movementBreakdown?.LOAN?.amount || 0)
    + (movementBreakdown?.PENALTY?.amount || 0)
    + (movementBreakdown?.INTEREST?.amount || 0);

  // ── Enrich topFarmers and bottomFarmers with financial data ──
  const enrichFarmers = (farmers) => {
    return farmers.map(f => {
      const id = f._id ? f._id.toString() : null;
      const summary = id ? farmerSummaries[id] : null;
      const balance = id ? (farmerBalances[id] || 0) : 0;
      return {
        farmerName: f.farmerName || 'Unknown',
        farmerCode: f.farmerCode || '',
        totalLitres: f.totalLitres || 0,
        transactionCount: f.transactionCount || 0,
        activeDays: f.activeDays || 0,
        averageLitresPerDelivery: f.averageLitresPerDelivery || 0,
        milkCredits: summary ? summary.milkCredits : 0,
        feedDeductions: summary ? summary.feedDebits : 0,
        settlementDeductions: summary ? summary.settlementDebits : 0,
        bonuses: summary ? summary.bonuses : 0,
        penalties: summary ? summary.penalties : 0,
        loans: summary ? summary.loans : 0,
        interest: summary ? summary.interest : 0,
        netPayable: summary ? summary.netMovement : 0,
        currentBalance: balance
      };
    });
  };

  const enrichedTopFarmers = enrichFarmers(farmerPerformance.topFarmers || []);
  const enrichedBottomFarmers = enrichFarmers(farmerPerformance.bottomFarmers || []);

  // ── Build final KPI object ──
  return {
    milkOperations: {
      totalLitres,
      grossMilkValue,
      averageRate: parseFloat(averageRate.toFixed(2)),
      activeFarmers,
      collectionEfficiency: parseFloat(collectionEfficiency.toFixed(1)),
      transactions
    },
    cooperativeRevenue: {
      feedRevenue: totalFeedRevenue,
      cashFeedSales,
      balanceFeedSales,
      productBreakdown: feedRevenueByProduct.map(p => ({
        productName: p.productName,
        cashRevenue: p.cashRevenue,
        balanceRevenue: p.balanceRevenue,
        totalRevenue: p.totalRevenue,
        transactionCount: p.transactionCount,
        averagePrice: parseFloat((p.averagePrice || 0).toFixed(2))
      }))
    },
    cooperativeLiability: {
      currentFarmerLiability,
      farmerDebt: farmerDebtValue,
      farmersInDebt: farmersInDebtCount,
      settlementsPaid,
      pendingSettlements,
      debtDetails: debtDetails.map(d => ({
        farmerName: d.farmerName,
        farmerCode: d.farmerCode,
        debtAmount: d.debtAmount,
        reason: d.reason
      }))
    },
    financialHealth: {
      liabilityCoverage: liabilityCoverage !== null ? parseFloat(liabilityCoverage.toFixed(1)) : null,
      settlementCompletionRate: parseFloat(settlementCompletionRate.toFixed(1)),
      internalDeductions
    },
    movementBreakdown: {
      MILK_CREDIT: movementBreakdown?.MILK_CREDIT || { amount: 0, count: 0 },
      FEED_DEBIT: movementBreakdown?.FEED_DEBIT || { amount: 0, count: 0 },
      FEED_CASH_SALE: movementBreakdown?.FEED_CASH_SALE || { amount: 0, count: 0 },
      SETTLEMENT_DEBIT: movementBreakdown?.SETTLEMENT_DEBIT || { amount: 0, count: 0 },
      BONUS: movementBreakdown?.BONUS || { amount: 0, count: 0 },
      PENALTY: movementBreakdown?.PENALTY || { amount: 0, count: 0 },
      LOAN: movementBreakdown?.LOAN || { amount: 0, count: 0 },
      INTEREST: movementBreakdown?.INTEREST || { amount: 0, count: 0 },
      MANUAL_ADJUSTMENT: movementBreakdown?.MANUAL_ADJUSTMENT || { amount: 0, count: 0 },
      REVERSAL: movementBreakdown?.REVERSAL || { amount: 0, count: 0 }
    },
    farmerPerformance: {
      topFarmers: enrichedTopFarmers,
      bottomFarmers: enrichedBottomFarmers,
      farmersWithNoDeliveries: farmerPerformance.farmersWithNoDeliveries || [],
      farmerActivity: farmerPerformance.farmerActivity || {}
    },
    porterPerformance: {
      totalPorters: porterPerformance.totalPorters || 0,
      activePorters: porterPerformance.activePorters || 0,
      averageLitresPerPorter: porterPerformance.averageLitresPerPorter || 0,
      averageLitresPerCollection: porterPerformance.averageLitresPerCollection || 0,
      porters: porterPerformance.porters || []
    },
    zonePerformance: {
      zones: overview.zonesCount || 0,
      breakdown: zoneBreakdown || []
    },
    trends: {
      weekly: trends.weekly || [],
      daily: trends.daily || [],
      rateBreakdown: trends.rateBreakdown || []
    }
  };
};

module.exports = { buildExecutiveKpis };