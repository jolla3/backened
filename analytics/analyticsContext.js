// analytics/analyticsContext.js
const mongoose = require('mongoose');
const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Ledger = require('../models/ledger');
const Inventory = require('../models/inventory');
const Device = require('../models/device');
const Porter = require('../models/porter');
const RateVersion = require('../models/rateVersion');
const Settlement = require('../models/settlement');
const logger = require('../utils/logger');

const buildAnalyticsContext = async (cooperativeId) => {
  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const sevenDaysAgo = new Date(today);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const thirtyDaysAgo = new Date(today);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(today);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const ninetyDaysAgo = new Date(today);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);
    const oneYearAgo = new Date(today);
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    const [
      cooperative,
      farmers,
      activeFarmers,
      milkTransactions,
      feedTransactions,
      ledgerEntries,
      inventory,
      devices,
      porters,
      rates,
      settlements,
    ] = await Promise.all([
      Cooperative.findById(coopId).lean(),
      Farmer.find({ cooperativeId: coopId }).lean(),
      Farmer.find({ cooperativeId: coopId, isActive: true }).lean(),
      Transaction.find({ type: 'milk', cooperativeId: coopId }).sort({ timestamp_server: -1 }).lean(),
      Transaction.find({ type: 'feed', cooperativeId: coopId }).sort({ timestamp_server: -1 }).lean(),
      Ledger.find({ cooperativeId: coopId }).sort({ timestamp: -1 }).lean(),
      // ✅ Load ALL inventory, no category filter
      Inventory.find({ cooperativeId: coopId }).where('stock').gte(0).lean(),
      Device.find({ cooperativeId: coopId, approved: true, revoked: false }).lean(),
      Porter.find({ cooperativeId: coopId, isActive: true }).lean(),
      RateVersion.find({ cooperativeId: coopId }).sort({ effective_date: -1 }).lean(),
      Settlement.find({ cooperativeId: coopId }).lean(),
    ]);

    if (!cooperative) throw new Error('Cooperative not found');

    // Build maps
    const farmerMap = new Map(farmers.map(f => [f._id.toString(), f]));
    const activeFarmerIds = new Set(activeFarmers.map(f => f._id.toString()));
    const inventoryMap = new Map(inventory.map(i => [i._id.toString(), i]));
    const deviceMap = new Map(devices.map(d => [d.uuid, d]));
    const porterMap = new Map(porters.map(p => [p._id.toString(), p]));

    // Latest balances
    const balanceResult = await Ledger.aggregate([
      { $match: { cooperativeId: coopId } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$farmerId', balance: { $first: '$runningBalance' } } },
    ]);
    const farmerBalances = new Map(balanceResult.map(r => [r._id.toString(), r.balance || 0]));

    // Active rate
    const activeRate = rates.find(r => r.effective_date <= now)?.rate || 0;

    // Pending settlements
    const pendingSettlements = settlements.filter(s => s.status === 'pending').length;

    // Branches and porters
    const branches = new Set(farmers.map(f => f.branch_id || 'main'));
    const activeBranches = branches.size;

    const todayTx = milkTransactions.filter(t => t.timestamp_server >= today);
    const activePorterIds = new Set(todayTx.map(t => t.porter_id?.toString()).filter(Boolean));
    const activePorters = activePorterIds.size;

    // Precomputed aggregates
    const filterByRange = (txs, start, end) => txs.filter(t => t.timestamp_server >= start && (end ? t.timestamp_server < end : true));

    const todayMilk = filterByRange(milkTransactions, today);
    const yesterdayMilk = filterByRange(milkTransactions, yesterday, today);
    const weekMilk = filterByRange(milkTransactions, sevenDaysAgo, today);
    const monthMilk = filterByRange(milkTransactions, thirtyDaysAgo, today);
    const yearMilk = filterByRange(milkTransactions, oneYearAgo, today);

    const dailyAggMap = {};
    for (const t of milkTransactions) {
      const dateKey = t.timestamp_server.toISOString().split('T')[0];
      if (!dailyAggMap[dateKey]) dailyAggMap[dateKey] = { litres: 0, tx: 0, farmers: new Set() };
      dailyAggMap[dateKey].litres += t.litres || 0;
      dailyAggMap[dateKey].tx++;
      dailyAggMap[dateKey].farmers.add(t.farmer_id.toString());
    }
    const dailyAggregates = Object.keys(dailyAggMap).sort().map(date => ({
      date,
      litres: dailyAggMap[date].litres,
      transactions: dailyAggMap[date].tx,
      farmers: dailyAggMap[date].farmers.size,
    }));

    const context = {
      cooperative,
      coopId,
      now,
      today,
      yesterday,
      sevenDaysAgo,
      thirtyDaysAgo,
      sixtyDaysAgo,
      ninetyDaysAgo,
      oneYearAgo,
      farmers,
      farmerMap,
      activeFarmers,
      activeFarmerIds,
      milkTransactions,
      feedTransactions,
      ledgerEntries,
      inventory,
      inventoryMap,
      devices,
      deviceMap,
      porters,
      porterMap,
      rates,
      activeRate,
      farmerBalances,
      settlements,
      pendingSettlements,
      activeBranches,
      activePorters,
      totalFarmers: farmers.length,
      inventoryItems: inventory.length,

      todayMilk,
      yesterdayMilk,
      weekMilk,
      monthMilk,
      yearMilk,
      dailyAggregates,
    };

    logger.info('Analytics context built', {
      cooperativeId,
      farmers: farmers.length,
      milkTransactions: milkTransactions.length,
      ledgerEntries: ledgerEntries.length,
      inventoryItems: inventory.length,
    });

    return context;
  } catch (error) {
    logger.error('AnalyticsContext build failed', { error: error.message, cooperativeId });
    throw error;
  }
};

module.exports = { buildAnalyticsContext };