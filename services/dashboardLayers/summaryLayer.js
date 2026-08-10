// services/dashboardLayers/summaryLayer.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Device = require('../../models/device');
const Cooperative = require('../../models/cooperative');
const Ledger = require('../../models/ledger');
const Inventory = require('../../models/inventory');
const Settlement = require('../../models/settlement');
const logger = require('../../utils/logger');
const { getKenyaDateString, isValidDateString } = require('../../utils/dateUtils');

const getSummary = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    // ─── Business dates (Kenya time) ────────────────────────────
    const todayStr = getKenyaDateString();
    const yesterdayStr = getKenyaDateString(new Date(Date.now() - 86400000));
    const lastWeekDate = new Date();
    lastWeekDate.setDate(lastWeekDate.getDate() - 7);
    const lastWeekStr = getKenyaDateString(lastWeekDate);
    const lastMonthDate = new Date();
    lastMonthDate.setMonth(lastMonthDate.getMonth() - 1);
    const lastMonthStr = getKenyaDateString(lastMonthDate);

    // ─── 1. Milk volumes ──────────────────────────────────────────
    const milkVolumes = await Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId: cooperative._id,
          collectionDate: { $gte: lastMonthStr },
        },
      },
      {
        $facet: {
          today: [
            { $match: { collectionDate: todayStr } },
            { $group: { _id: null, totalLitres: { $sum: '$litres' } } },
          ],
          yesterday: [
            { $match: { collectionDate: yesterdayStr } },
            { $group: { _id: null, totalLitres: { $sum: '$litres' } } },
          ],
          week: [
            { $match: { collectionDate: { $gte: lastWeekStr } } },
            { $group: { _id: null, totalLitres: { $sum: '$litres' } } },
          ],
          month: [
            { $match: { collectionDate: { $gte: lastMonthStr } } },
            { $group: { _id: null, totalLitres: { $sum: '$litres' } } },
          ],
          bestDay: [
            { $group: { _id: '$collectionDate', totalLitres: { $sum: '$litres' } } },
            { $sort: { totalLitres: -1 } },
            { $limit: 1 },
          ],
        },
      },
    ]);

    const result = milkVolumes[0] || {};
    const todayLitres = result.today?.[0]?.totalLitres || 0;
    const yesterdayLitres = result.yesterday?.[0]?.totalLitres || 0;
    const weekLitres = result.week?.[0]?.totalLitres || 0;
    const monthLitres = result.month?.[0]?.totalLitres || 0;
    const bestDayThisMonth = result.bestDay?.[0]?.totalLitres || 0;

    // ─── 2. Active farmers (based on collection date) ──────────
    const activeFarmerIds = await Transaction.distinct('farmer_id', {
      cooperativeId: cooperative._id,
      type: 'milk',
      collectionDate: todayStr,
    });
    const activeFarmersToday = activeFarmerIds.length;

    // ─── 3. Today's transactions (business date) ──────────────
    const transactionsToday = await Transaction.countDocuments({
      cooperativeId: cooperative._id,
      type: 'milk',
      collectionDate: todayStr,
    });

    // ─── 4. Total farmers, porters, devices ──────────────────────
    const [totalFarmers, totalPorters, totalDevices, farmers] = await Promise.all([
      Farmer.countDocuments({ cooperativeId: cooperative._id }),
      Porter.countDocuments({ cooperativeId: cooperative._id, isActive: true }),
      Device.countDocuments({
        cooperativeId: cooperative._id,
        approved: true,
        revoked: false,
      }),
      Farmer.find({ cooperativeId: cooperative._id }).select('branch_id').lean(),
    ]);

    const branches = new Set(farmers.map(f => f.branch_id || 'main'));
    const activeBranches = branches.size;

    // ─── 5. Financial from Ledger (uses server timestamp for audit) ──
    const [latestBalances, todayLedger, feedRevenue, pendingSettlements] = await Promise.all([
      Ledger.aggregate([
        { $match: { cooperativeId: cooperative._id } },
        { $sort: { timestamp: -1 } },
        { $group: { _id: '$farmerId', runningBalance: { $first: '$runningBalance' } } },
      ]),
      Ledger.aggregate([
        {
          $match: {
            cooperativeId: cooperative._id,
            timestamp: { $gte: new Date(new Date().setHours(0, 0, 0, 0)) },
          },
        },
        {
          $group: {
            _id: '$type',
            total: { $sum: '$amount' },
          },
        },
      ]),
      // Feed revenue based on business date (collectionDate)
      Transaction.aggregate([
        {
          $match: {
            type: 'feed',
            cooperativeId: cooperative._id,
            collectionDate: { $gte: lastMonthStr },
          },
        },
        { $group: { _id: null, total: { $sum: '$cost' } } },
      ]),
      Settlement.countDocuments({
        cooperativeId: cooperative._id,
        status: 'pending',
      }),
    ]);

    let farmerLiability = 0;
    let farmerDebt = 0;
    let farmersToPay = 0;
    let farmersInDebt = 0;

    for (const entry of latestBalances) {
      const bal = entry.runningBalance || 0;
      if (bal > 0) {
        farmerLiability += bal;
        farmersToPay++;
      } else if (bal < 0) {
        farmerDebt += Math.abs(bal);
        farmersInDebt++;
      }
    }

    const netPayable = farmerLiability - farmerDebt;
    const avgPayout = farmersToPay > 0 ? farmerLiability / farmersToPay : 0;
    const avgDebt = farmersInDebt > 0 ? farmerDebt / farmersInDebt : 0;

    // ─── Today's ledger movements (server timestamp) ────────────
    const milkCreditsToday = todayLedger.find(l => l._id === 'MILK_CREDIT')?.total || 0;
    const feedDebitsToday = todayLedger.find(l => l._id === 'FEED_DEBIT')?.total || 0;
    const settlementDebitsToday = todayLedger.find(l => l._id === 'SETTLEMENT_DEBIT')?.total || 0;
    const collectionToday = Math.round(milkCreditsToday + feedDebitsToday + settlementDebitsToday);

    // ─── 6. Averages ──────────────────────────────────────────────
    const avgPerActiveFarmer = activeFarmersToday > 0 ? Math.round(todayLitres / activeFarmersToday) : 0;
    const avgPerTransaction = transactionsToday > 0 ? Math.round(todayLitres / transactionsToday) : 0;

    // ─── 7. Trend ──────────────────────────────────────────────────
    const milkChange = yesterdayLitres > 0
      ? Math.round(((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 * 10) / 10
      : null;
    let trend = 'stable';
    if (milkChange !== null) {
      if (milkChange > 5) trend = 'up';
      else if (milkChange < -5) trend = 'down';
    }

    // ─── 8. Participation ──────────────────────────────────────────
    const participation = totalFarmers > 0 ? Math.round((activeFarmersToday / totalFarmers) * 100 * 10) / 10 : 0;

    // ─── 9. Production ─────────────────────────────────────────────
    const litresPerPorter = activeFarmersToday > 0 ? Math.round(todayLitres / activeFarmersToday) : 0;

    // ─── 10. Alerts ─────────────────────────────────────────────────
    const feedRevenueMonth = feedRevenue[0]?.total || 0;
    const alerts = {};

    // Production alert
    if (milkChange !== null && milkChange < -20) {
      alerts.production = {
        status: 'warning',
        message: `Milk collection dropped ${Math.abs(milkChange)}% from yesterday`,
      };
    } else {
      alerts.production = { status: 'ok', message: 'Milk collection is stable' };
    }

    // Cash alert
    if (farmerLiability > feedRevenueMonth * 0.5 && feedRevenueMonth > 0) {
      alerts.cash = {
        status: 'warning',
        message: `KES ${farmerLiability.toLocaleString()} required for settlements`,
      };
    } else {
      alerts.cash = { status: 'ok', message: 'Cash position is healthy' };
    }

    // Inventory alert
    const lowStockCount = await Inventory.countDocuments({
      cooperativeId: cooperative._id,
      stock: { $lt: 5 },
    });
    if (lowStockCount > 0) {
      alerts.inventory = {
        status: 'warning',
        message: `${lowStockCount} products below minimum stock`,
      };
    } else {
      alerts.inventory = { status: 'ok', message: 'Inventory levels are healthy' };
    }

    // ─── 11. Settlement status ──────────────────────────────────
    const settlementStatus = pendingSettlements > 0 ? 'pending' : 'cleared';

    // ─── 12. Executive summary ──────────────────────────────────
    let status = 'Good';
    let headline = 'Business operating normally.';

    if (alerts.production.status === 'warning' && alerts.cash.status === 'warning') {
      status = 'Warning';
      headline = 'Milk collection dropped significantly today while cash requirements remain high.';
    } else if (alerts.production.status === 'warning') {
      status = 'Fair';
      headline = 'Milk collection dropped today. Monitor farmer activity.';
    } else if (alerts.cash.status === 'warning') {
      status = 'Fair';
      headline = 'Cash requirements are elevated. Plan settlements carefully.';
    }

    // ─── 13. KPI block ──────────────────────────────────────────
    const kpi = {
      milkCollected: Math.round(todayLitres),
      expectedSettlement: Math.round(farmerLiability * 0.3), // placeholder
      activeFarmers: activeFarmersToday,
      healthScore: status === 'Good' ? 85 : status === 'Fair' ? 70 : 50,
    };

    // ─── 14. Assemble response ──────────────────────────────────
    return {
      milk: {
        today: Math.round(todayLitres),
        yesterday: Math.round(yesterdayLitres),
        week: Math.round(weekLitres),
        month: Math.round(monthLitres),
        trend,
        change: milkChange,
        averagePerActiveFarmer: avgPerActiveFarmer,
        averagePerTransaction: avgPerTransaction,
        bestDayThisMonth: Math.round(bestDayThisMonth),
      },
      finance: {
        milkPayable: Math.round(farmerLiability),
        farmerDebt: Math.round(farmerDebt),
        netPayable: Math.round(netPayable),
        farmersToPay,
        farmersInDebt,
        collectionToday,
        settlementStatus,
      },
      operations: {
        totalFarmers,
        activeFarmersToday,
        participation,
        activePorters: totalPorters,
        activeDevices: totalDevices,
        transactionsToday,
        activeBranches,
      },
      production: {
        litresPerTransaction: avgPerTransaction,
        averageLitresPerActiveFarmer: avgPerActiveFarmer,
        litresPerPorter,
      },
      alerts,
      kpi,
      summary: { status, headline },
    };
  } catch (error) {
    logger.error('Summary failed', { error: error.message, coopId: cooperativeId });
    return getDefaultSummary();
  }
};

const getDefaultSummary = () => ({
  milk: {
    today: 0,
    yesterday: 0,
    week: 0,
    month: 0,
    trend: 'stable',
    change: null,
    averagePerActiveFarmer: 0,
    averagePerTransaction: 0,
    bestDayThisMonth: 0,
  },
  finance: {
    milkPayable: 0,
    farmerDebt: 0,
    netPayable: 0,
    farmersToPay: 0,
    farmersInDebt: 0,
    collectionToday: 0,
    settlementStatus: 'unknown',
  },
  operations: {
    totalFarmers: 0,
    activeFarmersToday: 0,
    participation: 0,
    activePorters: 0,
    activeDevices: 0,
    transactionsToday: 0,
    activeBranches: 0,
  },
  production: {
    litresPerTransaction: 0,
    averageLitresPerActiveFarmer: 0,
    litresPerPorter: 0,
  },
  alerts: {
    production: { status: 'ok', message: 'No production alerts' },
    cash: { status: 'ok', message: 'Cash position is healthy' },
    inventory: { status: 'ok', message: 'Inventory levels are healthy' },
  },
  kpi: {
    milkCollected: 0,
    expectedSettlement: 0,
    activeFarmers: 0,
    healthScore: 0,
  },
  summary: {
    status: 'Unknown',
    headline: 'No data available',
  },
});

module.exports = { getSummary };