const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');

/**
 * Update a farmer's current balance and last ledger reference.
 * This is the ONLY function that should modify Farmer.currentBalance.
 *
 * @param {string} farmerId - Farmer ObjectId
 * @param {number} newBalance - New balance value
 * @param {string} ledgerId - Ledger entry ObjectId
 * @param {object|null} session - Mongoose session for transactions
 * @param {object} condition - Additional conditions (e.g., { currentBalance: previousBalance })
 * @returns {object|null} The updated farmer document, or null if no document matched
 */
const updateFarmerBalance = async (farmerId, newBalance, ledgerId, session = null, condition = {}) => {
  const update = { currentBalance: newBalance, lastLedgerId: ledgerId };
  const filter = { _id: farmerId, ...condition };

  if (session) {
    const result = await Farmer.findOneAndUpdate(filter, { $set: update }, { session, new: false });
    return result;
  } else {
    const result = await Farmer.findOneAndUpdate(filter, { $set: update }, { new: false });
    return result;
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