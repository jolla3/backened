// services/reports/executiveKpiBuilder.js

const buildExecutiveKpis = (operational, financial, settlement) => {
  const { overview } = operational;
  const { currentLiability, farmerDebt, farmersInDebt, movementBreakdown } = financial;
  const { summary: settlementSummary } = settlement;

  // ── Operational (all from overview) ──
  const totalLitres = overview.totalMilkLitres || 0;
  const milkValueGenerated = overview.totalMilkValue || 0;      // operational value
  const averageRate = overview.weightedAverageRate || 0;        // from operational
  const activeFarmers = overview.activeFarmersWithDeliveries || 0;
  const totalFarmers = overview.totalFarmers || 0;
  const collectionEfficiency = totalFarmers > 0 ? (activeFarmers / totalFarmers) * 100 : 0;
  const transactions = overview.totalMilkTransactions || 0;

  // ── Financial from Ledger ──
  const feedDebitAmount = movementBreakdown?.FEED_DEBIT?.amount || 0;
  const feedCashSaleAmount = movementBreakdown?.FEED_CASH_SALE?.amount || 0;
  const totalFeedRevenue = feedDebitAmount + feedCashSaleAmount;
  const balanceFeedSales = feedDebitAmount;
  const cashFeedSales = feedCashSaleAmount;

  // ── Liability ──
  const currentLiabilityValue = currentLiability || 0;
  const farmerDebtValue = farmerDebt || 0;
  const farmersInDebtCount = farmersInDebt || 0;

  // ── Settlements ──
  const settlementsPaid = settlementSummary.totalPaid || 0;
  const pendingSettlements = settlementSummary.totalPendingAmount || 0;
  const settlementCompletionRate = settlementSummary.totalNetPayable > 0
    ? (settlementSummary.totalPaid / settlementSummary.totalNetPayable) * 100
    : 0;

  // ── Movement Breakdown ──
  const milkCredits = movementBreakdown?.MILK_CREDIT?.amount || 0;
  const feedDebits = movementBreakdown?.FEED_DEBIT?.amount || 0;
  const settlementDebits = movementBreakdown?.SETTLEMENT_DEBIT?.amount || 0;
  const bonuses = movementBreakdown?.BONUS?.amount || 0;
  const penalties = movementBreakdown?.PENALTY?.amount || 0;
  const loans = movementBreakdown?.LOAN?.amount || 0;
  const interest = movementBreakdown?.INTEREST?.amount || 0;
  const manualAdjustments = movementBreakdown?.MANUAL_ADJUSTMENT?.amount || 0;
  const reversals = movementBreakdown?.REVERSAL?.amount || 0;

  // ── Liability reductions (renamed) ──
  const liabilityReductions = feedDebits + loans + penalties + interest;

  return {
    milkOperations: {
      totalLitres,
      milkValueGenerated,
      averageRate,
      activeFarmers,
      collectionEfficiency: parseFloat(collectionEfficiency.toFixed(1)),
      transactions
    },
    cooperativeRevenue: {
      feedRevenue: totalFeedRevenue,
      cashFeedSales,
      balanceFeedSales
    },
    cooperativeLiability: {
      currentLiability: currentLiabilityValue,
      farmerDebt: farmerDebtValue,
      farmersInDebt: farmersInDebtCount
    },
    financialHealth: {
      settlementsPaid,
      pendingSettlements,
      settlementCompletionRate: parseFloat(settlementCompletionRate.toFixed(1))
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
    liabilityReductions
  };
};

module.exports = { buildExecutiveKpis };