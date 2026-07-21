// analytics/farmerValue.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const { getFarmerLifetimeLedger, getLatestBalances } = require('./financialAnalytics');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

const getFarmerValue = async (cooperativeId) => {
  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);

    const ledgerMap = await getFarmerLifetimeLedger(cooperativeId);
    const balanceMap = await getLatestBalances(cooperativeId);

    // Lifetime litres
    const litresAgg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId } },
      { $group: { _id: '$farmer_id', totalLitres: { $sum: '$litres' } } }
    ]);
    const litresMap = new Map();
    for (const r of litresAgg) litresMap.set(r._id.toString(), r.totalLitres || 0);

    // First transaction (for months active)
    const firstTxAgg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId } },
      { $group: { _id: '$farmer_id', firstTx: { $min: '$timestamp_server' } } }
    ]);
    const firstTxMap = new Map();
    for (const r of firstTxAgg) firstTxMap.set(r._id.toString(), r.firstTx);

    // Last delivery
    const lastTxAgg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId } },
      { $group: { _id: '$farmer_id', lastTx: { $max: '$timestamp_server' } } }
    ]);
    const lastTxMap = new Map();
    for (const r of lastTxAgg) lastTxMap.set(r._id.toString(), r.lastTx);

    // Average daily litres (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const avgDailyAgg = await Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId: coopId,
          timestamp_server: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: '$farmer_id',
          avgDaily: { $avg: '$litres' },
          daysActive: { $addToSet: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } }
        }
      }
    ]);
    const avgDailyMap = new Map();
    for (const r of avgDailyAgg) {
      avgDailyMap.set(r._id.toString(), {
        avgDaily: r.avgDaily || 0,
        daysActive: r.daysActive?.length || 0
      });
    }

    const allFarmerIds = Array.from(new Set([...ledgerMap.keys(), ...balanceMap.keys(), ...litresMap.keys()]));
    const farmers = await Farmer.find({ _id: { $in: allFarmerIds } })
      .select('name farmer_code')
      .lean();
    const farmerNameMap = new Map(farmers.map(f => [f._id.toString(), f]));

    const result = [];
    for (const farmerId of allFarmerIds) {
      const farmer = farmerNameMap.get(farmerId) || { name: 'Unknown', farmer_code: 'N/A' };
      const ledger = ledgerMap.get(farmerId) || { milkCredits: 0, feedDebits: 0, netValue: 0 };
      const balance = balanceMap.get(farmerId) || 0;
      const lifetimeLitres = litresMap.get(farmerId) || 0;
      const firstTx = firstTxMap.get(farmerId);
      const lastTx = lastTxMap.get(farmerId);
      const avgDaily = avgDailyMap.get(farmerId) || { avgDaily: 0, daysActive: 0 };

      let monthsActive = 0;
      if (firstTx) {
        const diffDays = (Date.now() - new Date(firstTx)) / (1000 * 60 * 60 * 24);
        monthsActive = Math.max(1, diffDays / 30);
      }

      const netValue = ledger.netValue || 0;
      let valueTier = '';
      if (netValue > 50000) valueTier = 'High Value (Top 10%)';
      else if (netValue > 10000) valueTier = 'Loyal (Top 30%)';
      else if (netValue > 1000) valueTier = 'Growing';
      else if (netValue > 0) valueTier = 'New / Low';
      else valueTier = 'Inactive';

      const avgMonthlyEarnings = monthsActive > 0 ? (ledger.milkCredits || 0) / monthsActive : 0;

      result.push({
        farmer: farmer.name,
        code: farmer.farmer_code,
        lifetimeMilk: Math.round(lifetimeLitres),
        lifetimeEarnings: Math.round(ledger.milkCredits || 0),
        lifetimeFeedPurchased: Math.round(ledger.feedDebits || 0),
        netValue: Math.round(netValue),
        currentBalance: Math.round(balance),
        valueTier,
        status: 'active',
        monthsActive: Math.round(monthsActive),
        avgMonthlyLitres: lifetimeLitres > 0 && monthsActive > 0 ? Math.round(lifetimeLitres / monthsActive) : 0,
        avgMonthlyEarnings: Math.round(avgMonthlyEarnings),
        avgDailyLitres: Math.round(avgDaily.avgDaily),
        daysActiveLast30: avgDaily.daysActive,
        lastDelivery: lastTx ? new Date(lastTx).toISOString().split('T')[0] : 'Never'
      });
    }

    return result.sort((a, b) => b.netValue - a.netValue);
  } catch (error) {
    logger.error('FarmerValue failed', { error: error.message, cooperativeId });
    return [];
  }
};

module.exports = { getFarmerValue };