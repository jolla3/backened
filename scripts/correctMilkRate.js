const mongoose = require('mongoose');

const Transaction = require('../models/transaction');
const Ledger = require('../models/ledger');
const Farmer = require('../models/farmer');
const RateVersion = require('../models/rateVersion');

// ============================================================
// DATABASE
// ============================================================


// ============================================================
// CONFIGURATION
// ============================================================

const COOP_ID = new mongoose.Types.ObjectId(
  '6a6dad832531603e65d5394f'
);

const OLD_RATE = 50;
const NEW_RATE = 52;

const DATE_START = '2026-08-01';
const DATE_END   = '2026-08-31';

const NEW_RATE_VERSION_ID = new mongoose.Types.ObjectId(
  '6a7b5856306fec8a5794e18b'
);

// ============================================================
// SAFETY
// ============================================================

const APPLY = process.env.APPLY === 'true';

// ============================================================
// GET OLD RATE VERSIONS
// ============================================================

async function getOldRateVersions() {
  return RateVersion.find({
    cooperativeId: COOP_ID,
    rate: OLD_RATE
  }).select('_id');
}

// ============================================================
// FIND AFFECTED TRANSACTIONS
// ============================================================

async function getAffectedTransactions() {

  const oldVersions = await getOldRateVersions();

  const oldRateIds = oldVersions.map(v => v._id);

  if (oldRateIds.length === 0) {
    return [];
  }

  return Transaction.find({
    cooperativeId: COOP_ID,

    type: 'milk',

    status: 'completed',

    collectionDate: {
      $gte: DATE_START,
      $lte: DATE_END
    },

    rate_version_id: {
      $in: oldRateIds
    }
  }).lean();
}

// ============================================================
// MAIN
// ============================================================

async function correctMilkAmounts() {

  console.log('🔍 Searching for affected milk transactions...');

  const transactions = await getAffectedTransactions();

  console.log(`Found ${transactions.length} transactions.`);

  if (transactions.length === 0) {
    console.log('Nothing to update.');
    return;
  }

  // ----------------------------------------------------------
  // Verify new rate version
  // ----------------------------------------------------------

  const newRateVersion = await RateVersion.findOne({
    _id: NEW_RATE_VERSION_ID,
    cooperativeId: COOP_ID,
    rate: NEW_RATE
  });

  if (!newRateVersion) {
    throw new Error(
      `KES ${NEW_RATE} RateVersion ${NEW_RATE_VERSION_ID} does not exist for this cooperative.`
    );
  }

  // ----------------------------------------------------------
  // Calculate totals
  // ----------------------------------------------------------

  let totalLitres = 0;
  let oldTotal = 0;
  let newTotal = 0;

  for (const tx of transactions) {

    const newPayout = Number(tx.litres) * NEW_RATE;

    totalLitres += Number(tx.litres);
    oldTotal += Number(tx.payout);
    newTotal += newPayout;
  }

  const difference = newTotal - oldTotal;

  console.log('\n==========================================');
  console.log('CORRECTION SUMMARY');
  console.log('==========================================');

  console.log(`Transactions : ${transactions.length}`);
  console.log(`Litres       : ${totalLitres}`);
  console.log(`Old payout   : KES ${oldTotal}`);
  console.log(`New payout   : KES ${newTotal}`);
  console.log(`Difference   : KES ${difference}`);

  console.log('==========================================\n');

  // ----------------------------------------------------------
  // DRY RUN
  // ----------------------------------------------------------

  if (!APPLY) {

    console.log(
      'DRY RUN ONLY. Nothing has been changed.'
    );

    console.log(
      'Run with APPLY=true to actually update the database.'
    );

    return;
  }

  // ==========================================================
  // APPLY
  // ==========================================================

  console.log('🚀 APPLY=true');
  console.log('Updating transactions and ledger amounts...\n');

  let transactionUpdated = 0;
  let ledgerUpdated = 0;
  let farmerBalanceUpdated = 0;

  // ----------------------------------------------------------
  // Process each transaction
  // ----------------------------------------------------------

  for (const tx of transactions) {

    const oldPayout = Number(tx.payout);
    const newPayout = Number(tx.litres) * NEW_RATE;

    const diff = newPayout - oldPayout;

    // --------------------------------------------------------
    // 1. Update Transaction
    // --------------------------------------------------------

    const txResult = await Transaction.updateOne(
      {
        _id: tx._id,
        cooperativeId: COOP_ID,
        payout: oldPayout
      },
      {
        $set: {
          payout: newPayout,
          rate_version_id: NEW_RATE_VERSION_ID
        }
      }
    );

    if (txResult.matchedCount !== 1) {

      console.log(
        `⚠️ Transaction ${tx._id} skipped.`
      );

      continue;
    }

    transactionUpdated++;

    // --------------------------------------------------------
    // 2. Update Ledger amount
    // --------------------------------------------------------

    const ledgerResult = await Ledger.updateMany(
      {
        cooperativeId: COOP_ID,
        transactionId: tx._id,
        type: 'MILK_CREDIT'
      },
      {
        $set: {
          amount: newPayout
        }
      }
    );

    ledgerUpdated += ledgerResult.modifiedCount;

    // --------------------------------------------------------
    // 3. Update Farmer current balance
    // --------------------------------------------------------

    if (diff !== 0) {

      const farmerResult = await Farmer.updateOne(
        {
          _id: tx.farmer_id,
          cooperativeId: COOP_ID
        },
        {
          $inc: {
            currentBalance: diff
          }
        }
      );

      if (farmerResult.modifiedCount === 1) {
        farmerBalanceUpdated++;
      }
    }

    console.log(
      `✅ ${tx._id} | ${tx.litres}L | ` +
      `KES ${oldPayout} → KES ${newPayout}`
    );
  }

  // ==========================================================
  // RECALCULATE LEDGER RUNNING BALANCES
  // ==========================================================

  console.log('\n🔄 Recalculating ledger running balances...');

  const farmers = await Transaction.distinct(
    'farmer_id',
    {
      cooperativeId: COOP_ID,
      type: 'milk',
      status: 'completed',
      collectionDate: {
        $gte: DATE_START,
        $lte: DATE_END
      }
    }
  );

  for (const farmerId of farmers) {

    const entries = await Ledger.find({
      cooperativeId: COOP_ID,
      farmerId
    }).sort({
      timestamp: 1,
      _id: 1
    });

    let running = 0;

    for (const entry of entries) {

      running += Number(entry.amount);

      if (entry.runningBalance !== running) {

        entry.runningBalance = running;

        await entry.save();
      }
    }
  }

  // ==========================================================
  // FINAL
  // ==========================================================

  console.log('\n==========================================');
  console.log('✅ CORRECTION COMPLETE');
  console.log('==========================================');

  console.log(
    `Transactions updated : ${transactionUpdated}`
  );

  console.log(
    `Ledger amounts updated: ${ledgerUpdated}`
  );

  console.log(
    `Farmer balances updated: ${farmerBalanceUpdated}`
  );

  console.log(
    `Total correction: KES ${difference}`
  );

  console.log('==========================================');
}

// ============================================================
// CONNECT
// ============================================================

if (!DB_URL) {
  console.error(
    '❌ MONGODB_URI is not set.'
  );

  process.exit(1);
}

mongoose
  .connect(DB_URL)
  .then(async () => {

    console.log('✅ MongoDB connected');

    try {

      await correctMilkAmounts();

      await mongoose.disconnect();

      process.exit(0);

    } catch (error) {

      console.error(
        '\n❌ CORRECTION FAILED'
      );

      console.error(error);

      await mongoose.disconnect();

      process.exit(1);
    }
  })
  .catch(error => {

    console.error(
      '❌ MongoDB connection failed:',
      error
    );

    process.exit(1);
  });