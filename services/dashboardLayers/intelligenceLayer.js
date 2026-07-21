// services/dashboardLayers/intelligenceLayer.js
const { buildAnalyticsContext } = require('../../analytics/analyticsContext');
const { computeFinancial } = require('../../analytics/engines/financialEngine');
const { computeOperations } = require('../../analytics/engines/operationsEngine');
const { computeForecast } = require('../../analytics/engines/forecastEngine');
const { computeFarmerValue, computeFarmerRisks, computeFarmerRetention } = require('../../analytics/engines/farmerEngine');
const { computeInventory } = require('../../analytics/engines/inventoryEngine');
const { computeBenchmarks } = require('../../analytics/engines/benchmarkEngine');
const { computeTrends } = require('../../analytics/engines/trendEngine');
const { computeAnomalies } = require('../../analytics/engines/anomalyEngine');
const { computeOpportunities } = require('../../analytics/engines/opportunityEngine');
const { computeHealth } = require('../../analytics/engines/healthEngine');
const { computeDecisions } = require('../../analytics/engines/decisionEngine');
const { computeDashboardSummary } = require('../../analytics/engines/dashboardSummaryEngine');
const { generateNarrative } = require('../../analytics/engines/narrativeEngine');
const { computeCashPosition } = require('../../analytics/engines/cashPositionEngine');
const smsAnalyticsModule = require('../../analytics/smsAnalytics');
const aiAdvisoryModule = require('../../analytics/aiAdvisory');
const logger = require('../../utils/logger');

const getIntelligenceLayer = async (cooperativeId) => {
  try {
    const context = await buildAnalyticsContext(cooperativeId);

    // ─── Engines ────────────────────────────────────────────────
    let financial, operations, farmerValue, farmerRisks, farmerRetention,
        inventory, forecast, benchmarks, trends, anomalies, opportunities,
        cashPosition, healthResult, decisions, narrative, dashboardSummary;

    try {
      financial = computeFinancial(context);
    } catch (err) {
      logger.error('Financial engine failed', { error: err.message });
      financial = null;
    }

    try {
      operations = computeOperations(context);
    } catch (err) {
      logger.error('Operations engine failed', { error: err.message });
      operations = null;
    }

    try {
      farmerValue = computeFarmerValue(context);
    } catch (err) {
      logger.error('FarmerValue engine failed', { error: err.message });
      farmerValue = [];
    }

    try {
      farmerRisks = computeFarmerRisks(context);
    } catch (err) {
      logger.error('FarmerRisks engine failed', { error: err.message });
      farmerRisks = [];
    }

    try {
      farmerRetention = computeFarmerRetention(context);
    } catch (err) {
      logger.error('FarmerRetention engine failed', { error: err.message });
      farmerRetention = { activeFarmers: 0, inactiveFarmers: 0, deliveredLast30: 0, deliveredPrevious30: 0, retained: 0, lost: 0, reactivated: 0, retentionRate: 0 };
    }

    try {
      inventory = computeInventory(context);
    } catch (err) {
      logger.error('Inventory engine failed', { error: err.message });
      inventory = { status: 'NOT_CONFIGURED', message: 'Inventory unavailable', items: [], summary: { totalItems: 0, categories: {}, lowStock: 0, outOfStock: 0, inventoryValue: 0, stockValueByCategory: {} } };
    }

    try {
      forecast = computeForecast(context, financial || {});
    } catch (err) {
      logger.error('Forecast engine failed', { error: err.message });
      forecast = null;
    }

    try {
      benchmarks = computeBenchmarks(context, financial || {}, operations || {});
    } catch (err) {
      logger.error('Benchmark engine failed', { error: err.message });
      benchmarks = null;
    }

    try {
      trends = computeTrends(context);
    } catch (err) {
      logger.error('Trend engine failed', { error: err.message });
      trends = null;
    }

    try {
      anomalies = computeAnomalies(context);
    } catch (err) {
      logger.error('Anomaly engine failed', { error: err.message });
      anomalies = null;
    }

    const farmerData = { value: farmerValue || [], risks: farmerRisks || [], retention: farmerRetention };

    try {
      opportunities = computeOpportunities(context, financial || {}, farmerData, inventory || {});
    } catch (err) {
      logger.error('Opportunity engine failed', { error: err.message });
      opportunities = [];
    }

    try {
      cashPosition = computeCashPosition(context, financial || {});
    } catch (err) {
      logger.error('CashPosition engine failed', { error: err.message });
      cashPosition = {
        cashTracked: false,
        cashInHand: null,
        expectedCashNeeded: 0,
        shortfall: null,
        status: 'Cash account not configured.',
        explanation: 'Cash position cannot be determined because cash accounts are not configured.',
      };
    }

    try {
      // Pass cashPosition to health
      healthResult = computeHealth(
        financial || {},
        operations || {},
        farmerData,
        inventory || {},
        forecast || {},
        cashPosition
      );
    } catch (err) {
      logger.error('Health engine failed', { error: err.message });
      healthResult = {
        health: { score: 0, status: 'Unknown', reasons: [], components: {} },
        confidence: { score: 0, level: 'Unknown', reasons: ['Health engine failed'] },
      };
    }

    try {
      decisions = computeDecisions(context, financial || {}, farmerData, inventory || {}, operations || {}, forecast || {});
    } catch (err) {
      logger.error('Decision engine failed', { error: err.message });
      decisions = [];
    }

    try {
      narrative = generateNarrative(
        context,
        financial || {},
        farmerData,
        inventory || {},
        operations || {},
        forecast || {},
        decisions || [],
        healthResult.health || { score: 0, status: 'Unknown' }
      );
    } catch (err) {
      logger.error('Narrative engine failed', { error: err.message });
      narrative = { healthScore: 0, summary: 'Narrative unavailable', sections: [] };
    }

    try {
      dashboardSummary = computeDashboardSummary(
        context,
        financial || {},
        operations || {},
        healthResult.health || { score: 0, status: 'Unknown' },
        decisions || [],
        forecast || {},
        opportunities || []
      );
    } catch (err) {
      logger.error('DashboardSummary engine failed', { error: err.message });
      dashboardSummary = {
        score: 0,
        status: 'Unknown',
        biggestRisk: null,
        biggestOpportunity: null,
        nextAction: null,
        cashRequiredToday: 0,
        notifications: { critical: 0, warning: 0, info: 0, total: 0 },
        components: { production: 0, finance: 0, cash: 0, operations: 0, farmers: 0, inventory: 0 },
      };
    }

    // ─── SMS & AI Advisory ──────────────────────────────────────
    let sms = null, advisory = null;
    try {
      sms = await smsAnalyticsModule.getSmsAnalytics(cooperativeId);
    } catch (err) {
      logger.error('SMS analytics failed', { error: err.message });
      sms = null;
    }

    try {
      advisory = await aiAdvisoryModule.getAiAdvisory(cooperativeId);
    } catch (err) {
      logger.error('AI Advisory failed', { error: err.message });
      advisory = [];
    }

    // ─── Today Summary ──────────────────────────────────────────
    const todaySummary = {
      milkCollected: operations?.todayLitres || 0,
      transactions: operations?.todayTransactions || 0,
      activeFarmers: operations?.activeFarmersToday || 0,
      expectedSettlement: Math.round((operations?.todayLitres || 0) * (financial?.activeRate || 55)),
      lowStockItems: inventory?.summary?.lowStock || 0,
    };

    // ─── Build final response ───────────────────────────────────
    return {
      status: 'OK',
      reason: null,
      businessContext: {
        cooperativeName: context.cooperative?.name || '',
        generatedAt: new Date().toISOString(),
        reportingPeriod: 'Today',
        activeBranches: context.activeBranches || 0,
        activePorters: context.activePorters || 0,
        activeFarmers: operations?.activeFarmersToday || 0,
        totalFarmers: context.totalFarmers || 0,
        inventoryItems: context.inventoryItems || 0,
        settlementsPending: context.pendingSettlements || 0,
        systemVersion: process.env.npm_package_version || '1.0.0',
        analyticsVersion: '2.0.0',
        timezone: 'Africa/Nairobi',
        currency: 'KES',
        milkRate: context.activeRate || 0,
      },
      todaySummary,
      financialIntelligence: {
        monthMilkLitres: financial?.monthMilkLitres || 0,
        grossMilkValue: financial?.grossMilkValue || 0,
        milkCredits: financial?.milkCredits || 0,
        feedRevenue: financial?.feedRevenue || 0,
        feedRevenueCash: financial?.feedRevenueCash || 0,
        feedRevenueBalance: financial?.feedRevenueBalance || 0,
        feedQuantity: financial?.feedQuantity || 0,
        feedDebits: financial?.feedDebits || 0,
        amountToPayFarmers: financial?.amountToPayFarmers || 0,
        amountFarmersOweCoop: financial?.amountFarmersOweCoop || 0,
        farmersToPay: financial?.farmersToPay || 0,
        farmersOwingCoop: financial?.farmersOwingCoop || 0,
        farmersWithZero: financial?.farmersWithZero || 0,
        avgFarmerBalance: financial?.avgFarmerBalance || 0,
        avgPricePerLiter: financial?.avgPricePerLiter || 0,
        activeRate: financial?.activeRate || 0,
        hasRealData: financial?.hasRealData || false,
      },
      operationsIntelligence: operations || getDefaultOperations(),
      forecastIntelligence: forecast || getDefaultForecast(),
      farmerIntelligence: farmerData,
      inventoryIntelligence: inventory || {
        status: 'NOT_CONFIGURED',
        message: 'Inventory module not initialized',
        items: [],
        summary: { totalItems: 0, categories: {}, lowStock: 0, outOfStock: 0, inventoryValue: 0, stockValueByCategory: {} },
      },
      benchmarkIntelligence: benchmarks || getDefaultBenchmarks(),
      trendIntelligence: trends || getDefaultTrends(),
      anomalyIntelligence: anomalies || getDefaultAnomalies(),
      opportunityIntelligence: opportunities || [],
      healthIntelligence: healthResult.health || { score: 0, status: 'Unknown', reasons: [], components: {} },
      analyticsConfidence: healthResult.confidence || { score: 0, level: 'Unknown', reasons: ['No analytics data available'] },
      decisionIntelligence: decisions || [],
      executiveNarrative: narrative,
      dashboardSummary: dashboardSummary,
      cashPosition: cashPosition,
      aiAdvisory: advisory || [],
      sms: sms || getDefaultSms(),
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('IntelligenceLayer failed', { error: error.message, cooperativeId });
    return getDefaultIntelligenceLayer(error.message);
  }
};

// ─── Defaults ──────────────────────────────────────────────────
const getDefaultOperations = () => ({
  totalFarmers: 0,
  activeFarmersToday: 0,
  todayLitres: 0,
  todayTransactions: 0,
  avgMilkPerFarmerToday: 0,
  avgMilkPerFarmerWeek: 0,
  avgMilkPerFarmerMonth: 0,
  avgLitresPerTransaction: '0',
  growthVsYesterday: '0%',
  growthVsLastWeek: '0%',
  peakCollectionHour: '—',
  retentionRate: '0%',
  weekTrend: { totalLitres: 0, avgPerDay: 0, activeFarmers: 0 },
  monthTrend: { totalLitres: 0, activeFarmers: 0 },
  collectionEfficiency: 0,
  collectionPerformanceIndex: 0,
  missedCollections: 0,
  offlineDevices: 0,
  activePorters: 0,
  averageLitresPerPorter: 0,
  averageFarmersPerPorter: 0,
  duplicateCollections: 0,
});

const getDefaultForecast = () => ({
  currentLiability: 0,
  farmersToPay: 0,
  forecastAvailable: { available: false, reason: 'No forecast data', required: 7, current: 0 },
  dailyForecast: null,
  weeklyForecast: null,
  monthlyForecast: null,
  seasonalForecast: null,
  forecastLitres: null,
  confidence: null,
  explanation: 'No forecast available',
  hasEnoughData: false,
  activeRate: 0,
  historicalMonthlyLitres: [],
  daysAvailable: 0,
  tomorrowMilk: null,
  tomorrowValue: null,
  tomorrowFeedDemand: null,
});

const getDefaultBenchmarks = () => ({
  todayLitres: 0,
  yesterdayLitres: 0,
  expectedToday: 0,
  avgWeekDay: 0,
  weekSamples: 0,
  avgMonthDay: 0,
  monthSamples: 0,
  avgLastYearDay: 0,
  seasonalAvg: 0,
  comparisons: {
    vsYesterday: '0%',
    vsLastWeek: '0%',
    vsLastMonth: '0%',
    vsLastYear: '0%',
    vsSeasonal: '0%',
  },
});

const getDefaultTrends = () => ({
  trend7: { currentAverage: null, previousAverage: null, growth: null, direction: 'unknown', confidence: 0, interpretation: 'No trend data available' },
  trend30: { currentAverage: null, previousAverage: null, growth: null, direction: 'unknown', confidence: 0, interpretation: 'No trend data available' },
  trend90: { currentAverage: null, previousAverage: null, growth: null, direction: 'unknown', confidence: 0, interpretation: 'No trend data available' },
});

const getDefaultAnomalies = () => ({
  hasAnomaly: false,
  expectedMilk: null,
  actualMilk: null,
  deviation: null,
  severity: 'unknown',
  interpretation: 'No anomaly data available',
  requiredDays: 30,
  availableDays: 0,
});

const getDefaultSms = () => ({
  smsSent: 0,
  smsFailed: 0,
  deliveryRate: '0%',
  receiptsVerifiedToday: 0,
  dailyTrend: [],
  optimalSendingTime: '9:00 AM',
  weeklyTotal: 0,
});

const getDefaultIntelligenceLayer = (errorMessage = null) => ({
  status: errorMessage ? 'ERROR' : 'EMPTY',
  reason: errorMessage || 'No analytics data available',
  businessContext: {
    cooperativeName: '',
    generatedAt: new Date().toISOString(),
    reportingPeriod: 'Today',
    activeBranches: 0,
    activePorters: 0,
    activeFarmers: 0,
    totalFarmers: 0,
    inventoryItems: 0,
    settlementsPending: 0,
    systemVersion: '1.0.0',
    analyticsVersion: '2.0.0',
    timezone: 'Africa/Nairobi',
    currency: 'KES',
    milkRate: 0,
  },
  todaySummary: {
    milkCollected: 0,
    transactions: 0,
    activeFarmers: 0,
    expectedSettlement: 0,
    lowStockItems: 0,
  },
  financialIntelligence: {
    monthMilkLitres: 0,
    grossMilkValue: 0,
    milkCredits: 0,
    feedRevenue: 0,
    feedRevenueCash: 0,
    feedRevenueBalance: 0,
    feedQuantity: 0,
    feedDebits: 0,
    amountToPayFarmers: 0,
    amountFarmersOweCoop: 0,
    farmersToPay: 0,
    farmersOwingCoop: 0,
    farmersWithZero: 0,
    avgFarmerBalance: 0,
    avgPricePerLiter: 0,
    activeRate: 0,
    hasRealData: false,
  },
  operationsIntelligence: getDefaultOperations(),
  forecastIntelligence: getDefaultForecast(),
  farmerIntelligence: { value: [], risks: [], retention: {} },
  inventoryIntelligence: {
    status: 'NOT_CONFIGURED',
    message: 'Inventory module not initialized',
    items: [],
    summary: { totalItems: 0, categories: {}, lowStock: 0, outOfStock: 0, inventoryValue: 0, stockValueByCategory: {} },
  },
  benchmarkIntelligence: getDefaultBenchmarks(),
  trendIntelligence: getDefaultTrends(),
  anomalyIntelligence: getDefaultAnomalies(),
  opportunityIntelligence: [],
  healthIntelligence: {
    score: 0,
    status: 'Unknown',
    reasons: [],
    components: {
      production: { score: 0, weight: 20, reasons: [] },
      finance: { score: 0, weight: 20, reasons: [] },
      cash: { score: 0, weight: 10, reasons: [] },
      operations: { score: 0, weight: 20, reasons: [] },
      farmers: { score: 0, weight: 20, reasons: [] },
      inventory: { score: 0, weight: 10, reasons: [] },
    },
  },
  analyticsConfidence: {
    score: 0,
    level: 'Unknown',
    reasons: ['No analytics data available'],
  },
  decisionIntelligence: [],
  executiveNarrative: { healthScore: 0, summary: 'No analytics available', sections: [] },
  dashboardSummary: {
    score: 0,
    status: 'Unknown',
    biggestRisk: null,
    biggestOpportunity: null,
    nextAction: null,
    cashRequiredToday: 0,
    notifications: { critical: 0, warning: 0, info: 0, total: 0 },
    components: { production: 0, finance: 0, cash: 0, operations: 0, farmers: 0, inventory: 0 },
  },
  cashPosition: {
    cashTracked: false,
    cashInHand: null,
    expectedCashNeeded: 0,
    shortfall: null,
    status: 'Cash account not configured.',
    explanation: 'Cash position cannot be determined because cash accounts are not configured.',
  },
  aiAdvisory: [],
  sms: getDefaultSms(),
  timestamp: new Date().toISOString(),
});

module.exports = { getIntelligenceLayer };