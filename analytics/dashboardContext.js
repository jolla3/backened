// analytics/dashboardContext.js
const mongoose = require('mongoose');
const Cooperative = require('../models/cooperative');
const Farmer = require('../models/farmer');
const RateVersion = require('../models/rateVersion');
const { getLatestBalances, getFarmerLifetimeLedger } = require('./financialAnalytics');
const logger = require('../utils/logger');

/**
 * Build a shared context for all analytics modules.
 * Loads data once to avoid repeated database hits.
 */
const buildDashboardContext = async (cooperativeId) => {
  try {
    const coopId = new mongoose.Types.ObjectId(cooperativeId);

    // Load all in parallel
    const [
      cooperative,
      farmers,
      activeFarmers,
      balances,
      ledgerData,
      activeRate
    ] = await Promise.all([
      Cooperative.findById(coopId).lean(),
      Farmer.find({ cooperativeId: coopId }).select('name farmer_code phone branch_id isActive createdAt').lean(),
      Farmer.find({ cooperativeId: coopId, isActive: true }).select('_id name farmer_code').lean(),
      getLatestBalances(cooperativeId),
      getFarmerLifetimeLedger(cooperativeId),
      RateVersion.findOne({
        cooperativeId: coopId,
        type: 'milk',
        effective_date: { $lte: new Date() }
      }).sort({ effective_date: -1 }).lean()
    ]);

    if (!cooperative) throw new Error('Cooperative not found');

    // Build maps for quick lookups
    const farmerMap = new Map();
    for (const f of farmers) {
      farmerMap.set(f._id.toString(), f);
    }

    const activeFarmerIds = new Set();
    for (const f of activeFarmers) {
      activeFarmerIds.add(f._id.toString());
    }

    return {
      cooperative,
      coopId,
      farmers,
      farmerMap,
      activeFarmers: activeFarmers,
      activeFarmerIds,
      balances,
      ledgerData,
      milkRate: activeRate?.rate || 0,
      now: new Date()
    };
  } catch (error) {
    logger.error('DashboardContext build failed', { error: error.message, cooperativeId });
    throw error;
  }
};

module.exports = { buildDashboardContext };