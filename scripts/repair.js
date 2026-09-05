// /**
//  * scripts/repairEricMugendiBalance.js
//  *
//  * Rebuild Eric Mugendi Mbaya's Farmer.currentBalance from ledger (append-only).
//  * Does NOT delete history. Posts MANUAL_ADJUSTMENT only if sum(ledger) ≠ currentBalance.
//  *
//  * Usage:
//  *   node scripts/repairEricMugendiBalance.js
//  *   DRY_RUN=1 node scripts/repairEricMugendiBalance.js
//  */
// require('dotenv').config();
// const mongoose = require('mongoose');
// const Farmer = require('../models/farmer');
// const Ledger = require('../models/ledger');

// const FARMER_ID = new mongoose.Types.ObjectId('6a796c6bd089fba6409b5ebe');
// const COOP_ID = new mongoose.Types.ObjectId('6a6dad832531603e65d5394f');
// const DRY_RUN = process.env.DRY_RUN === '1';

// // System/admin user that is allowed as createdBy on ledger — set via env
// const REPAIR_USER_ID = process.env.REPAIR_USER_ID
//   ? new mongoose.Types.ObjectId(process.env.REPAIR_USER_ID)
//   : null;

// const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// async function main() {
//   await mongoose.connect(process.env.DB_URL || process.env.MONGO_URI);
//   console.log('Connected');

//   const farmer = await Farmer.findOne({ _id: FARMER_ID, cooperativeId: COOP_ID });
//   if (!farmer) {
//     throw new Error('Farmer not found for this cooperative');
//   }

//   console.log('Farmer', {
//     id: farmer._id.toString(),
//     code: farmer.farmer_code,
//     name: farmer.name,
//     currentBalance: farmer.currentBalance,
//     lastLedgerId: farmer.lastLedgerId,
//   });

//   const entries = await Ledger.find({
//     cooperativeId: COOP_ID,
//     farmerId: FARMER_ID,
//   })
//     .sort({ timestamp: 1, _id: 1 })
//     .lean();

//   console.log('Ledger rows:', entries.length);

//   let computed = 0;
//   const anomalies = [];

//   for (const e of entries) {
//     computed = round2(computed + Number(e.amount));
//     const stored = round2(e.runningBalance);
//     if (Math.abs(stored - computed) > 0.02) {
//       anomalies.push({
//         id: e._id.toString(),
//         type: e.type,
//         amount: e.amount,
//         storedRunning: stored,
//         recomputed: computed,
//         timestamp: e.timestamp,
//       });
//     }
//   }

//   console.log('Recomputed balance from sum(amount):', computed);
//   console.log('Farmer.currentBalance:', round2(farmer.currentBalance || 0));
//   console.log('RunningBalance anomalies (stored vs chain):', anomalies.length);
//   if (anomalies.length) {
//     console.log('First 10 anomalies:', anomalies.slice(0, 10));
//   }

//   // List SETTLEMENT rows (forensic)
//   const settlements = entries.filter((e) => e.type === 'SETTLEMENT');
//   console.log(
//     'SETTLEMENT entries:',
//     settlements.map((s) => ({
//       id: s._id.toString(),
//       amount: s.amount,
//       runningBalance: s.runningBalance,
//       timestamp: s.timestamp,
//       description: s.description,
//     }))
//   );

//   const live = round2(farmer.currentBalance || 0);
//   const delta = round2(computed - live);

//   if (Math.abs(delta) < 0.01) {
//     console.log('No balance drift. Nothing to post.');
//     await mongoose.disconnect();
//     return;
//   }

//   console.log(
//     `Drift detected: ledgerSum=${computed} live=${live} adjustment=${delta}`
//   );

//   if (DRY_RUN) {
//     console.log('DRY_RUN=1 — no write');
//     await mongoose.disconnect();
//     return;
//   }

//   if (!REPAIR_USER_ID) {
//     throw new Error('Set REPAIR_USER_ID to a valid User ObjectId for createdBy');
//   }

//   const session = await mongoose.startSession();
//   session.startTransaction();
//   try {
//     const [ledgerDoc] = await Ledger.create(
//       [
//         {
//           cooperativeId: COOP_ID,
//           farmerId: FARMER_ID,
//           type: 'MANUAL_ADJUSTMENT',
//           amount: delta,
//           runningBalance: computed,
//           description:
//             'Audited repair: align Farmer.currentBalance to sum of ledger amounts',
//           reference: `REPAIR-ERIC-${Date.now()}`,
//           createdBy: REPAIR_USER_ID,
//           metadata: {
//             source: 'REPAIR_SCRIPT',
//             farmerCode: farmer.farmer_code,
//             previousLiveBalance: live,
//             recomputedFromLedgerSum: computed,
//             note: 'Does not delete historical SETTLEMENT rows; corrects counter only',
//           },
//           timestamp: new Date(),
//         },
//       ],
//       { session }
//     );

//     await Farmer.updateOne(
//       { _id: FARMER_ID, cooperativeId: COOP_ID },
//       {
//         $set: {
//           currentBalance: computed,
//           lastLedgerId: ledgerDoc._id,
//           balanceUpdatedAt: new Date(),
//         },
//       },
//       { session }
//     );

//     await session.commitTransaction();
//     console.log('Repair posted', {
//       ledgerId: ledgerDoc._id.toString(),
//       newBalance: computed,
//     });
//   } catch (err) {
//     await session.abortTransaction();
//     throw err;
//   } finally {
//     session.endSession();
//     await mongoose.disconnect();
//   }
// }

// main().catch((err) => {
//   console.error(err);
//   process.exit(1);
// });


// // scripts/fixEricLastRunningBalance.js
// require('dotenv').config();
// const mongoose = require('mongoose');
// const Farmer = require('../models/farmer');
// const Ledger = require('../models/ledger');

// const FARMER_ID = new mongoose.Types.ObjectId('6a796c6bd089fba6409b5ebe');
// const COOP_ID = new mongoose.Types.ObjectId('6a6dad832531603e65d5394f');
// const LAST_LEDGER_ID = new mongoose.Types.ObjectId('6a96710d0bb5728a3e38078b');

// async function main() {
//   await mongoose.connect(process.env.DB_URL || process.env.MONGO_URI);

//   const farmer = await Farmer.findOne({ _id: FARMER_ID, cooperativeId: COOP_ID });
//   if (!farmer) throw new Error('Farmer not found');

//   const entries = await Ledger.find({ cooperativeId: COOP_ID, farmerId: FARMER_ID })
//     .sort({ timestamp: 1, _id: 1 })
//     .lean();

//   let sum = 0;
//   for (const e of entries) sum = Math.round((sum + e.amount + Number.EPSILON) * 100) / 100;

//   console.log({
//     currentBalance: farmer.currentBalance,
//     sumOfAmounts: sum,
//     lastLedgerId: farmer.lastLedgerId?.toString(),
//   });

//   // Force wallet to 0 only if somehow non-zero (should already be 0)
//   if (Math.abs(farmer.currentBalance || 0) > 0.01) {
//     await Farmer.updateOne(
//       { _id: FARMER_ID, cooperativeId: COOP_ID },
//       { $set: { currentBalance: 0 } }
//     );
//     console.log('Set currentBalance → 0');
//   }

//   // Fix stale runningBalance on the bad SETTLEMENT row so it matches the amount chain
//   const last = await Ledger.findOne({
//     _id: LAST_LEDGER_ID,
//     cooperativeId: COOP_ID,
//     farmerId: FARMER_ID,
//   });
//   if (last) {
//     console.log('Before', { amount: last.amount, runningBalance: last.runningBalance });
//     last.runningBalance = sum; // should be 0
//     last.metadata = {
//       ...(last.metadata || {}),
//       runningBalanceRepaired: true,
//       repairedAt: new Date(),
//       note: 'Aligned runningBalance to sum of ledger amounts (farmer currentBalance already 0)',
//     };
//     await last.save();
//     console.log('After', { runningBalance: last.runningBalance });
//   }

//   await Farmer.updateOne(
//     { _id: FARMER_ID, cooperativeId: COOP_ID },
//     { $set: { currentBalance: 0, lastLedgerId: LAST_LEDGER_ID } }
//   );

//   console.log('Done. Eric balance is 0.');
//   await mongoose.disconnect();
// }

// main().catch((e) => {
//   console.error(e);
//   process.exit(1);
// });



// scripts/zeroKelvinMuneneBalance.js
require('dotenv').config();
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');

const FARMER_ID = new mongoose.Types.ObjectId('6a6efd3b02f2cdf43b709459');
const COOP_ID = new mongoose.Types.ObjectId('6a6dad832531603e65d5394f');
// SUPER_ADMIN kendi — for createdBy
const REPAIR_USER_ID = new mongoose.Types.ObjectId('6a6dad832531603e65d53951');

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

async function main() {
  await mongoose.connect(process.env.DB_URL || process.env.MONGO_URI);

  const farmer = await Farmer.findOne({ _id: FARMER_ID, cooperativeId: COOP_ID });
  if (!farmer) throw new Error('Farmer not found');

  const live = round2(farmer.currentBalance || 0);
  console.log({
    name: farmer.name,
    code: farmer.farmer_code,
    currentBalance: live,
  });

  if (Math.abs(live) < 0.01) {
    console.log('Already zero. Nothing to do.');
    await mongoose.disconnect();
    return;
  }

  // Bring balance to 0 with one audited adjustment (append-only)
  const delta = round2(0 - live); // if live is -88, delta = +88

  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const [entry] = await Ledger.create(
      [
        {
          cooperativeId: COOP_ID,
          farmerId: FARMER_ID,
          type: 'MANUAL_ADJUSTMENT',
          amount: delta,
          runningBalance: 0,
          description:
            'Repair: clear erroneous negative balance after overstated SETTLEMENT (SET-74Q36CBQXQTD)',
          reference: `REPAIR-KELVIN-${Date.now()}`,
          createdBy: REPAIR_USER_ID,
          metadata: {
            source: 'REPAIR_SCRIPT',
            farmerCode: '103',
            previousBalance: live,
            targetBalance: 0,
            relatedSettlementRef: 'SET-74Q36CBQXQTD',
          },
          timestamp: new Date(),
        },
      ],
      { session }
    );

    await Farmer.updateOne(
      { _id: FARMER_ID, cooperativeId: COOP_ID },
      {
        $set: {
          currentBalance: 0,
          lastLedgerId: entry._id,
          balanceUpdatedAt: new Date(),
        },
      },
      { session }
    );

    await session.commitTransaction();
    console.log('Done', {
      ledgerId: entry._id.toString(),
      adjustment: delta,
      newBalance: 0,
    });
  } catch (err) {
    await session.abortTransaction();
    throw err;
  } finally {
    session.endSession();
    await mongoose.disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});