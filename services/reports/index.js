const operationalService = require('./operationalService');
const financialService = require('./financialService');
const settlementService = require('./settlementService');
const auditService = require('./auditService');
const analyticsService = require('./analyticsService');
const executiveSummaryService = require('./executiveKpiBuilder');
const forecastService = require('./forecastService');
const dashboardService = require('./dashboardService');
const graphBuilder = require('./graphBuilder');
const logger = require('../../utils/logger');

const getMonthlyReport = async (year, month, cooperativeId, options = {}) => {
  const start = Date.now();
  const logContext = { year, month, cooperativeId };

  try {
    // 1. Fetch all raw data in parallel
    const [opData, finData, setData, auditData] = await Promise.all([
      operationalService.fetchOperationalData(year, month, cooperativeId),
      financialService.fetchFinancialData(year, month, cooperativeId),
      settlementService.fetchSettlementData(year, month, cooperativeId),
      auditService.fetchAuditData(year, month, cooperativeId)
    ]);

    // 2. Build sections
    const operational = operationalService.buildOperational(opData);
    const financial = financialService.buildFinancial(finData);
    const settlement = settlementService.buildSettlement(setData);
    const audit = auditService.buildAudit(auditData);

    // 3. Build Executive KPIs with correct accounting
    const executiveKpis = buildExecutiveKpis(opData, finData, setData);

    // 4. Build graphs, dashboard, forecast, summary
    const graphs = graphBuilder.buildGraphs(opData, finData, setData);
    const dashboardCards = dashboardService.buildCards(executiveKpis, finData);
    const forecast = await forecastService.buildForecast(year, month, cooperativeId);
    const executiveSummary = executiveSummaryService.build(executiveKpis, audit, opData, finData);

    // 5. Assemble final report
    const report = {
      cooperative: opData.cooperative,
      period: opData.period,
      executiveKpis,
      executiveSummary,
      operational,
      financial,
      settlement,
      audit,
      graphs,
      dashboardCards,
      forecast
    };

    const duration = Date.now() - start;
    logger.info(`Monthly report generated in ${duration}ms`, logContext);
    return report;

  } catch (error) {
    logger.error('Monthly report generation failed', { error: error.message, stack: error.stack, ...logContext });
    throw error;
  }
};

// ─── Executive KPI Builder ────────────────────────────────────
function buildExecutiveKpis(opData, finData, setData) {
  const { milkOverview, allFarmersCount, farmersWithDeliveries } = opData;
  const { outstanding, ledger } = finData;
  const { summary: settlementSummary } = setData;

  // Gross milk earnings (value of milk collected)
  const grossMilkEarnings = milkOverview.totalPayout || 0;

  // Current farmer liability (positive balances)
  const currentFarmerLiability = outstanding.totalPositive || 0;

  // Settlements paid (cash already left)
  const settlementsPaid = settlementSummary.totalPaid || 0;

  // Internal deductions: feed debits + loans + penalties + interest
  const internalDeductions = (ledger.feedDebits || 0) + (ledger.loans || 0) + (ledger.penalties || 0) + (ledger.interest || 0);

  // Farmer debt (absolute negative balances)
  const farmerDebt = Math.abs(outstanding.totalNegative || 0);

  // Accounting identity verification
  // Gross Milk Earnings = Current Farmer Liability + Settlements Paid + Internal Deductions + (farmer debt? no, debt is farmers owe co-op)
  // Actually, the identity for a single farmer is: gross earnings = current balance + paid + deductions (if balance is net)
  // Summing all farmers: grossMilkEarnings = totalPositiveBalances + totalPaid + totalDeductions - totalNegativeBalances (because negative balances reduce liability)
  // Let's compute the right side:
  const rightSide = currentFarmerLiability + settlementsPaid + internalDeductions - farmerDebt;
  const identityMatches = Math.abs(grossMilkEarnings - rightSide) < 1; // floating point tolerance

  // Trends (simplified – can be enhanced)
  const trends = {
    grossMilkEarnings: { change: 0, direction: 'flat' }, // placeholder
    feedRevenue: { change: 0, direction: 'flat' },
    activeFarmers: { change: 0, direction: 'flat' }
  };

  return {
    grossMilkEarnings,
    totalMilkLitres: milkOverview.totalLitres || 0,
    currentFarmerLiability,
    settlementsPaid,
    internalDeductions,
    farmerDebt,
    feedRevenue: opData.feedRevenue.totalRevenue || 0,
    totalFeedQuantity: opData.feedRevenue.totalQuantity || 0,
    activeFarmers: allFarmersCount,
    farmersWithDeliveries,
    collectionEfficiency: allFarmersCount > 0 ? parseFloat(((farmersWithDeliveries / allFarmersCount) * 100).toFixed(1)) : 0,
    settlementCompletionRate: settlementSummary.totalNetPayable > 0
      ? parseFloat(((settlementSummary.totalPaid / settlementSummary.totalNetPayable) * 100).toFixed(1))
      : 0,
    accountingIdentity: {
      grossMilkEarnings,
      currentFarmerLiability,
      settlementsPaid,
      internalDeductions,
      farmerDebt,
      rightSide,
      matches: identityMatches
    },
    trends
  };
}

module.exports = { getMonthlyReport };