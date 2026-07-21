// services/ledgerUtils.js
const Farmer = require('../models/farmer');

/**
 * Update a farmer's current balance and last ledger reference.
 * This is the ONLY function that should modify Farmer.currentBalance.
 */
const updateFarmerBalance = async (farmerId, newBalance, ledgerId) => {
  await Farmer.findByIdAndUpdate(farmerId, {
    currentBalance: newBalance,
    lastLedgerId: ledgerId
  });
};

/**
 * Recalculate all farmer balances from the latest ledger entry.
 * Use this as a migration script.
 */
const recalculateAllFarmerBalances = async (cooperativeId = null) => {
  const match = cooperativeId ? { cooperativeId } : {};
  const farmers = await Farmer.find(match).select('_id').lean();
  
  for (const farmer of farmers) {
    const lastLedger = await Ledger.findOne({
      farmerId: farmer._id,
      ...(cooperativeId && { cooperativeId })
    }).sort({ timestamp: -1 }).lean();

    if (lastLedger) {
      await Farmer.findByIdAndUpdate(farmer._id, {
        currentBalance: lastLedger.runningBalance,
        lastLedgerId: lastLedger._id
      });
    } else {
      // No ledger entries – set balance to 0
      await Farmer.findByIdAndUpdate(farmer._id, {
        currentBalance: 0,
        lastLedgerId: null
      });
    }
  }
};

module.exports = { updateFarmerBalance, recalculateAllFarmerBalances };