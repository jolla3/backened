const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger'); // ← was missing

/**
 * Update a farmer's current balance and last ledger reference.
 * This is the ONLY function that should modify Farmer.currentBalance.
 */
const updateFarmerBalance = async (farmerId, newBalance, ledgerId, session = null) => {
  const update = { currentBalance: newBalance, lastLedgerId: ledgerId };
  if (session) {
    await Farmer.findByIdAndUpdate(farmerId, update, { session });
  } else {
    await Farmer.findByIdAndUpdate(farmerId, update);
  }
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
      ...(cooperativeId && { cooperativeId }),
    })
      .sort({ timestamp: -1, _id: -1 })
      .lean();

    if (lastLedger) {
      await Farmer.findByIdAndUpdate(farmer._id, {
        currentBalance: lastLedger.runningBalance,
        lastLedgerId: lastLedger._id,
      });
    } else {
      await Farmer.findByIdAndUpdate(farmer._id, {
        currentBalance: 0,
        lastLedgerId: null,
      });
    }
  }
};

module.exports = { updateFarmerBalance, recalculateAllFarmerBalances };