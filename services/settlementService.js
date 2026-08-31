// services/settlementService.js
//
// ─── Accounting invariants this file assumes and enforces ─────────────────
// 1. The Ledger is append-only and is the source of financial TRUTH for
//    "what happened." Farmer.currentBalance is the atomically-incremented
//    COUNTER — see models/ledger.model.js and models/farmer.model.js for the
//    full authority model. Every write in this file updates both, in the
//    same transaction, via $inc (never a blind $set to a separately-read value).
// 2. A period's netPayable covers ONLY that period's own ledger activity.
//    Whatever the farmer's ledger already held before periodStart is
//    openingBalance, carried in explicitly — never assumed to be zero, and
//    never destroyed by "just zero the wallet." totalPayable = both summed.
// 3. Settlement (this file) answers "what is owed." Payment (recordPayment
//    below) answers "did money move, and how." Settling a settlement posts
//    a SETTLEMENT ledger entry for the resolved amount; it does not, by
//    itself, claim the farmer was physically paid.
// 4. The accounting period locks at SETTLING, not at GENERATED/APPROVED.
//    GENERATED/APPROVED settlements are a preview snapshot; ordinary
//    transactions during that window are expected and reconciled via the
//    mismatch/override flow at settle time. If your business needs "nothing
//    may change once generated," add 'GENERATED'/'APPROVED' to
//    LOCKED_BATCH_STATUSES below — that's the one line that lives in.
// 5. Every OTHER ledger-writing service (milk credit, feed debit, loans,
//    advances, interest, penalties, manual adjustments, bonuses) MUST call
//    assertPeriodOpen() before writing, and MUST use the same $inc-then-log
//    pattern for Farmer.currentBalance. This file cannot enforce that
//    against services outside it — that has to be a code-review/lint-level
//    rule for every writer, and is the single most important thing to
//    verify before trusting this with real payouts. I have not seen those
//    services in this conversation and cannot confirm they follow it.
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Settlement = require('../models/settlement');
const SettlementBatch = require('../models/SettlementBatch');
const Payment = require('../models/payment');
const Counter = require('../models/counter');
const Cooperative = require('../models/cooperative');
const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');
const { SETTLEABLE_TYPES } = require('../models/ledgerTypes');
const {
  round2,
  money,
  amountsMatch,
  getPeriodBounds,
  computePeriodSettlement,
  computeSettlementPosition,
  splitPosition,
  computeClosingBalances,
} = require('./settlementMath');

// ─── Constants ────────────────────────────────────────────
const LOCKED_BATCH_STATUSES = ['SETTLING', 'PARTIALLY_SETTLED', 'SETTLED', 'CLOSED'];
const RESOLUTION_TYPES = ['ACCEPT_ACTUAL', 'KEEP_ORIGINAL', 'MANUAL_AMOUNT'];
const MAX_POST_GENERATION_ENTRIES = 50;

class PeriodLockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PeriodLockedError';
    this.code = 'PERIOD_LOCKED';
  }
}

// Snapshot read concern + majority write concern, explicit on every
// transaction. Protects reads/writes made BY transactions that follow this
// same discipline. Does NOT protect against a writer elsewhere that bypasses
// it — see invariant #5 above.
const TX_OPTS = { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } };

// ─── Period lock, shared with every financial-entry-point service ────────
const assertPeriodOpen = async (cooperativeId, timestamp, session = null) => {
  const year = timestamp.getUTCFullYear();
  const month = timestamp.getUTCMonth() + 1;
  let query = SettlementBatch.findOne({ cooperativeId, year, month, status: { $in: LOCKED_BATCH_STATUSES } });
  if (session) query = query.session(session);
  const lockedBatch = await query;
  if (lockedBatch) {
    throw new PeriodLockedError(
      `Accounting period ${year}-${String(month).padStart(2, '0')} is ${lockedBatch.status} and locked. ` +
      `Late entries require an explicit, audited override — not a normal transaction.`
    );
  }
  return true;
};

// ─── The one true pattern for mutating a farmer's balance ─────────────────
// Atomically increments Farmer.currentBalance and returns the NEW value.
// This $inc is the actual concurrency boundary (MongoDB serializes it per
// document) — never derive the new balance from a separate sort/read first.
const incrementFarmerBalance = async (farmerId, cooperativeId, amount, ledgerId, session) => {
  const updated = await Farmer.findOneAndUpdate(
    { _id: farmerId, cooperativeId },
    { $inc: { currentBalance: amount }, $set: { lastLedgerId: ledgerId, balanceUpdatedAt: new Date() } },
    { new: true, session }
  );
  if (!updated) throw new Error(`Farmer ${farmerId} not found in cooperative ${cooperativeId}`);
  return round2(updated.currentBalance);
};

// Read-only snapshot (safe for generation previews / mismatch checks —
// never used to derive a value that then gets written back without going
// through incrementFarmerBalance).
const getFarmerBalanceSnapshot = async (farmerId, cooperativeId, session) => {
  const farmer = await Farmer.findOne({ _id: farmerId, cooperativeId }).select('currentBalance lastLedgerId').session(session);
  return { runningBalance: round2(farmer?.currentBalance || 0), ledgerId: farmer?.lastLedgerId || null };
};

const getFarmerBalanceSnapshots = async (farmerIds, cooperativeId, session) => {
  const farmers = await Farmer.find({ _id: { $in: farmerIds }, cooperativeId })
    .select('currentBalance lastLedgerId').session(session);
  const map = new Map();
  for (const f of farmers) map.set(f._id.toString(), { runningBalance: round2(f.currentBalance || 0), ledgerId: f.lastLedgerId });
  return map;
};

// Ledger balance strictly BEFORE a given instant — used to compute
// openingBalance at generation time. This is intentionally a Ledger query
// (not the Farmer counter) because it needs a value as of a point in the
// PAST, not "right now."
const getBalanceBefore = async (cooperativeId, farmerId, beforeTimestamp, session) => {
  let query = Ledger.find({ cooperativeId, farmerId, timestamp: { $lt: beforeTimestamp } })
    .sort({ timestamp: -1, _id: -1 }).limit(1);
  if (session) query = query.session(session);
  const [row] = await query;
  return row ? round2(row.runningBalance) : 0;
};

// ─── Helpers ──────────────────────────────────────────────
const getOrCreateBatch = async (cooperativeId, year, month, bounds, userId, session) => {
  return SettlementBatch.findOneAndUpdate(
    { cooperativeId, year, month },
    {
      $setOnInsert: {
        periodStart: bounds.periodStart, periodEnd: bounds.periodEnd, nextPeriodStart: bounds.nextPeriodStart,
        status: 'GENERATING', generatedBy: userId, generatedAt: new Date(),
        totalFarmers: 0, totalSkippedFarmers: 0, totalGrossMilkLitres: 0, totalGrossMilkEarnings: 0,
        totalDeductions: 0, totalBonuses: 0, totalOpeningBalance: 0, totalNetPayable: 0, totalPayable: 0,
        averageMilkRatePerLitre: 0, highestSettlement: 0, lowestSettlement: 0,
        totalSettledFarmers: 0, totalMismatchedFarmers: 0,
      },
    },
    { upsert: true, new: true, session, setDefaultsOnInsert: true }
  );
};

const reserveSettlementNumbers = async (cooperativeId, year, month, count, session) => {
  const key = `${cooperativeId.toString()}-${year}-${month}`;
  const counter = await Counter.findOneAndUpdate({ _id: key }, { $inc: { sequence: count } }, { upsert: true, new: true, session });
  const start = counter.sequence - count + 1;
  const numbers = [];
  const yearShort = String(year).slice(2);
  const monthStr = String(month).padStart(2, '0');
  for (let i = 0; i < count; i++) numbers.push(`SET-${yearShort}${monthStr}-${String(start + i).padStart(4, '0')}`);
  return numbers;
};

const createAuditLog = async (userId, action, metadata, ip, session) => {
  if (!AuditLog) return;
  try {
    await new AuditLog({ userId, action, metadata, ipAddress: ip, timestamp: new Date() }).save({ session });
  } catch (e) {
    logger.warn('Audit log failed', { error: e.message });
  }
};

const getPostGenerationEntries = async (cooperativeId, farmerId, generationAt, generationLedgerId, session) => {
  const filter = {
    cooperativeId, farmerId,
    $or: [
      { timestamp: { $gt: generationAt } },
      ...(generationLedgerId ? [{ timestamp: generationAt, _id: { $gt: generationLedgerId } }] : []),
    ],
  };
  let query = Ledger.find(filter).sort({ timestamp: 1, _id: 1 }).limit(MAX_POST_GENERATION_ENTRIES);
  if (session) query = query.session(session);
  const entries = await query;
  return entries.map((e) => ({ ledgerId: e._id, type: e.type, amount: e.amount, timestamp: e.timestamp, reference: e.reference, description: e.description }));
};

// Insert a ledger entry idempotently: if a prior attempt already succeeded
// (duplicate idempotencyKey), fetch and return that row instead of erroring
// the whole operation out. This is what makes settle/override safe to retry.
const insertLedgerIdempotent = async (doc, session) => {
  try {
    const [created] = await Ledger.create([doc], { session });
    return { doc: created, wasAlreadyDone: false };
  } catch (err) {
    if (err.code === 11000 && doc.idempotencyKey) {
      const existing = await Ledger.findOne({ idempotencyKey: doc.idempotencyKey }).session(session);
      if (existing) return { doc: existing, wasAlreadyDone: true };
    }
    throw err;
  }
};

// ─── Generate Settlements ─────────────────────────────────
const generateSettlements = async (cooperativeId, year, month, userId, ip = null) => {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction(TX_OPTS);

    const coopId = new mongoose.Types.ObjectId(cooperativeId);
    const cooperative = await Cooperative.findById(coopId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    const bounds = getPeriodBounds(year, month);
    const { periodStart, periodEnd, nextPeriodStart } = bounds;

    const existingBatch = await getOrCreateBatch(coopId, year, month, bounds, userId, session);
    if (existingBatch.status !== 'GENERATING' && existingBatch.status !== 'GENERATED') {
      throw new Error(`Settlements for ${year}-${month} are already ${existingBatch.status}`);
    }
    if (existingBatch.status === 'GENERATED') {
      // Idempotent replay: generation already completed, hand back the same result.
      const settlements = await Settlement.find({ batchId: existingBatch._id }).session(session);
      await session.commitTransaction();
      session.endSession();
      return { success: true, batch: existingBatch, settlements, count: settlements.length, idempotentReplay: true };
    }

    // Compare-and-swap the generation lock — getOrCreateBatch's upsert only
    // guarantees one DOCUMENT per period, not one WORKER building it.
    const batch = await SettlementBatch.findOneAndUpdate(
      { _id: existingBatch._id, status: 'GENERATING', generationLockedAt: null },
      { $set: { generationLockedAt: new Date(), generationLockedBy: userId } },
      { new: true, session }
    );
    if (!batch) throw new Error(`Settlement generation for ${year}-${month} is already in progress`);

    const farmers = await Farmer.find({ cooperativeId: coopId, isActive: true })
      .select('_id name farmer_code phone zoneId zoneName currentBalance lastLedgerId').session(session);

    if (!farmers.length) {
      batch.status = 'CANCELLED';
      await batch.save({ session });
      await session.commitTransaction();
      session.endSession();
      return { success: false, message: 'No active farmers found' };
    }

    const farmerIds = farmers.map((f) => f._id);

    // Single aggregation grouped by (farmer, type), over the half-open
    // period, using the shared SETTLEABLE_TYPES contract — no invented
    // second list of financial types in this file.
    const perTypeAgg = await Ledger.aggregate([
      { $match: { cooperativeId: coopId, farmerId: { $in: farmerIds }, type: { $in: SETTLEABLE_TYPES }, timestamp: { $gte: periodStart, $lt: nextPeriodStart } } },
      { $group: { _id: { farmerId: '$farmerId', type: '$type' }, total: { $sum: '$amount' }, litres: { $sum: '$metadata.litres' } } },
    ]).session(session);

    const byFarmer = new Map();
    for (const row of perTypeAgg) {
      const idStr = row._id.farmerId.toString();
      if (!byFarmer.has(idStr)) byFarmer.set(idStr, {});
      byFarmer.get(idStr)[row._id.type] = { total: row.total || 0, litres: row.litres || 0 };
    }

    const generationAt = new Date();
    // Farmer.currentBalance is the authoritative live counter — safe to read
    // here since we're only using it for the generation PREVIEW, not writing.
    const balanceSnapshots = new Map(farmers.map((f) => [f._id.toString(), { runningBalance: round2(f.currentBalance || 0), ledgerId: f.lastLedgerId }]));

    const docs = [];
    const summary = {
      totalGrossMilkLitres: 0, totalGrossMilkEarnings: 0, totalDeductions: 0, totalBonuses: 0,
      totalOpeningBalance: 0, totalNetPayable: 0, totalPayable: 0,
      highest: 0, lowest: Infinity, totalSkipped: 0,
    };

    for (const farmer of farmers) {
      const idStr = farmer._id.toString();
      const types = byFarmer.get(idStr) || {};
      const period = computePeriodSettlement(types);
      if (!period.hadActivity) { summary.totalSkipped += 1; continue; }

      // openingBalance = ledger balance strictly BEFORE this period started —
      // legitimately non-zero (prior partial payout, loan still being repaid).
      const openingBalanceRaw = await getBalanceBefore(coopId, farmer._id, periodStart, session);
      const { openingBalance, netPayable, totalPayable } = computeTotalPayable(openingBalanceRaw, period.netPayable);

      const snapshot = balanceSnapshots.get(idStr);
      const generationBalance = snapshot?.runningBalance ?? 0;
      const generationMismatch = !amountsMatch(generationBalance, totalPayable);
      const generationDifference = round2(generationBalance - totalPayable);

      docs.push({
        cooperativeId: coopId, batchId: batch._id, farmerId: farmer._id,
        farmerSnapshot: { name: farmer.name, code: farmer.farmer_code, phone: farmer.phone, zone: farmer.zoneName || farmer.zoneId?.toString() },
        periodStart, periodEnd, nextPeriodStart, year, month,
        grossMilkLitres: period.grossMilkLitres, grossMilkEarnings: period.grossMilkEarnings,
        deductions: period.deductions, totalDeductions: period.totalDeductions,
        bonuses: period.bonuses, adjustments: period.adjustments, netPayable,
        openingBalance, totalPayable, closingOutstandingBalance: 0, // filled in at settle/override time
        status: 'GENERATED', generatedBy: userId,
        generationBalance, generationLedgerId: snapshot?.ledgerId, generationAt, generationMismatch, generationDifference,
        notes: `Settlement for ${periodStart.toISOString().slice(0, 10)} to ${new Date(nextPeriodStart.getTime() - 1).toISOString().slice(0, 10)}`,
      });

      summary.totalGrossMilkLitres += period.grossMilkLitres;
      summary.totalGrossMilkEarnings += period.grossMilkEarnings;
      summary.totalDeductions += period.totalDeductions;
      summary.totalBonuses += period.bonuses;
      summary.totalOpeningBalance += openingBalance;
      summary.totalNetPayable += netPayable;
      summary.totalPayable += totalPayable;
      if (totalPayable > summary.highest) summary.highest = totalPayable;
      if (totalPayable < summary.lowest) summary.lowest = totalPayable;
    }

    const numbers = await reserveSettlementNumbers(coopId, year, month, docs.length, session);
    docs.forEach((doc, idx) => { doc.settlementNumber = numbers[idx]; });

    let settlements = [];
    if (docs.length) settlements = await Settlement.insertMany(docs, { session, ordered: true });

    const generationMismatchCount = docs.filter((d) => d.generationMismatch).length;

    batch.status = 'GENERATED';
    batch.totalFarmers = settlements.length;
    batch.totalSkippedFarmers = summary.totalSkipped;
    batch.totalGrossMilkLitres = summary.totalGrossMilkLitres;
    batch.totalGrossMilkEarnings = summary.totalGrossMilkEarnings;
    batch.totalDeductions = summary.totalDeductions;
    batch.totalBonuses = summary.totalBonuses;
    batch.totalOpeningBalance = summary.totalOpeningBalance;
    batch.totalNetPayable = summary.totalNetPayable;
    batch.totalPayable = summary.totalPayable;
    batch.averageMilkRatePerLitre = summary.totalGrossMilkLitres > 0 ? summary.totalGrossMilkEarnings / summary.totalGrossMilkLitres : 0;
    batch.highestSettlement = summary.highest || 0;
    batch.lowestSettlement = summary.lowest === Infinity ? 0 : summary.lowest;
    batch.generatedAt = new Date();
    await batch.save({ session });

    await createAuditLog(userId, 'SETTLEMENT_GENERATED', {
      cooperativeId: coopId, year, month, count: settlements.length, skipped: summary.totalSkipped, generationMismatchCount, summary,
    }, ip, session);

    await session.commitTransaction();
    session.endSession();
    return { success: true, batch, settlements, count: settlements.length, summary, generationMismatchCount };
  } catch (error) {
    if (session) { await session.abortTransaction(); session.endSession(); }
    logger.error('Generate settlements error', { error: error.message, stack: error.stack });
    throw error;
  }
};

// ─── Approve Batch ──────────────────────────────────────────
const approveBatch = async (batchId, userId, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (cooperativeId && String(batch.cooperativeId) !== String(cooperativeId)) throw new Error('Batch does not belong to this cooperative');
    if (batch.status !== 'GENERATED') throw new Error(`Batch is ${batch.status}, cannot approve`);

    batch.status = 'APPROVED';
    batch.approvedBy = userId;
    batch.approvedAt = new Date();
    await batch.save({ session });

    await createAuditLog(userId, 'SETTLEMENT_BATCH_APPROVED', {
      batchId: batch._id, cooperativeId: batch.cooperativeId, year: batch.year, month: batch.month, totalPayable: batch.totalPayable,
    }, ip, session);

    await session.commitTransaction();
    session.endSession();
    return { success: true, batch };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Settle Batch ──────────────────────────────────────────
// Compares the LIVE balance against totalPayable (openingBalance + this
// period's netPayable) — not netPayable alone. Farmers who match settle
// immediately; farmers who drifted are flagged MISMATCH with the actual
// post-generation entries captured for review.
const settleBatch = async (batchId, userId, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);

  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (cooperativeId && String(batch.cooperativeId) !== String(cooperativeId)) {
      throw new Error('Batch does not belong to this cooperative');
    }

    // Backfill bounds if missing (old docs)
    if (!batch.nextPeriodStart) {
      const b = getPeriodBounds(batch.year, batch.month);
      batch.periodStart = batch.periodStart || b.periodStart;
      batch.periodEnd = batch.periodEnd || b.periodEnd;
      batch.nextPeriodStart = b.nextPeriodStart;
    }

    const settleableFrom = ['GENERATED', 'APPROVED', 'PARTIALLY_SETTLED'];
    if (!settleableFrom.includes(batch.status)) {
      throw new Error(`Batch is ${batch.status}, cannot settle`);
    }
    if (batch.nextPeriodStart > new Date()) {
      throw new Error('Cannot settle an accounting period that has not closed yet');
    }

    const lockedBatch = await SettlementBatch.findOneAndUpdate(
      { _id: batchId, status: { $in: settleableFrom } },
      {
        $set: {
          status: 'SETTLING',
          settlingStartedBy: userId,
          settlingStartedAt: new Date(),
        },
      },
      { returnDocument: 'after', session }
    );
    if (!lockedBatch) throw new Error('Another process is already settling this batch');

    await createAuditLog(
      userId,
      'SETTLEMENT_BATCH_SETTLING_STARTED',
      { batchId: lockedBatch._id, cooperativeId: lockedBatch.cooperativeId },
      ip,
      session
    );

    // Settle all GENERATED (and auto-recalculate from live balance for normal path)
    const pending = await Settlement.find({
      batchId: batch._id,
      status: { $in: ['GENERATED', 'MISMATCH'] },
    }).session(session);

    const balanceMap = await getFarmerBalanceSnapshots(
      pending.map((s) => s.farmerId),
      lockedBatch.cooperativeId,
      session
    );

    const settledOps = [];
    let settledCount = 0;

    for (const settlement of pending) {
      const idStr = settlement.farmerId.toString();
      const liveBalance = balanceMap.get(idStr)?.runningBalance ?? 0;

      // Recompute position from LIVE balance at settle time (automatic reconciliation)
      const { payableToFarmer, amountOwedByFarmer, netPosition } = splitPosition(liveBalance);

      // Update snapshot fields to what we actually settled against
      settlement.payableToFarmer = payableToFarmer;
      settlement.amountOwedByFarmer = amountOwedByFarmer;
      settlement.netPosition = netPosition;

      let ledgerEntryId = null;

      if (payableToFarmer > 0) {
        // Cooperative clears what it owes the farmer only
        const idempotencyKey = `SETTLEMENT:${settlement._id}`;
        const { doc: ledgerDoc, wasAlreadyDone } = await insertLedgerIdempotent(
          {
            cooperativeId: settlement.cooperativeId,
            farmerId: settlement.farmerId,
            settlementId: settlement._id,
            batchId: batch._id,
            type: 'SETTLEMENT',
            amount: -payableToFarmer,
            runningBalance: 0,
            description: `Settlement payout ${settlement.settlementNumber}`,
            reference: settlement.settlementNumber,
            createdBy: userId,
            metadata: {
              payableToFarmer,
              amountOwedByFarmer,
              netPositionBefore: liveBalance,
            },
            timestamp: new Date(),
            idempotencyKey,
          },
          session
        );

        if (!wasAlreadyDone) {
          const newBal = await incrementFarmerBalance(
            settlement.farmerId,
            settlement.cooperativeId,
            -payableToFarmer,
            ledgerDoc._id,
            session
          );
          await Ledger.updateOne(
            { _id: ledgerDoc._id },
            { $set: { runningBalance: newBal } },
            { session }
          );
        }
        ledgerEntryId = ledgerDoc._id;
      }
      // If payableToFarmer === 0 (zero or debt): NO ledger entry, debt stays on account

      settledOps.push({
        updateOne: {
          filter: { _id: settlement._id },
          update: {
            $set: {
              status: 'SETTLED',
              settledBy: userId,
              settledAt: new Date(),
              ledgerEntryId,
              payableToFarmer,
              amountOwedByFarmer,
              netPosition,
              closingOutstandingBalance: amountOwedByFarmer, // debt carries forward
              totalPayable: payableToFarmer, // payout obligation only
            },
          },
        },
      });
      settledCount += 1;
    }

    if (settledOps.length) {
      await Settlement.bulkWrite(settledOps, { session });
    }

    // Recompute batch payout totals from settled docs
    const agg = await Settlement.aggregate([
      { $match: { batchId: batch._id } },
      {
        $group: {
          _id: null,
          totalPayableToFarmers: { $sum: '$payableToFarmer' },
          totalOwedByFarmers: { $sum: '$amountOwedByFarmer' },
          settled: { $sum: { $cond: [{ $eq: ['$status', 'SETTLED'] }, 1, 0] } },
          total: { $sum: 1 },
        },
      },
    ]).session(session);

    const totals = agg[0] || {
      totalPayableToFarmers: 0,
      totalOwedByFarmers: 0,
      settled: 0,
      total: 0,
    };

    lockedBatch.totalSettledFarmers = totals.settled;
    lockedBatch.totalMismatchedFarmers = 0;
    lockedBatch.totalPayableToFarmers = round2(totals.totalPayableToFarmers);
    lockedBatch.totalOwedByFarmers = round2(totals.totalOwedByFarmers);
    lockedBatch.totalPayable = lockedBatch.totalPayableToFarmers;
    lockedBatch.status =
      totals.settled === totals.total ? 'SETTLED' : 'PARTIALLY_SETTLED';
    if (lockedBatch.status === 'SETTLED') {
      lockedBatch.settledBy = userId;
      lockedBatch.settledAt = new Date();
    }
    await lockedBatch.save({ session });

    await createAuditLog(
      userId,
      'SETTLEMENT_BATCH_SETTLED',
      {
        batchId: lockedBatch._id,
        settledCount,
        totalPayableToFarmers: lockedBatch.totalPayableToFarmers,
        totalOwedByFarmers: lockedBatch.totalOwedByFarmers,
      },
      ip,
      session
    );

    await session.commitTransaction();
    session.endSession();
    return {
      success: true,
      batch: lockedBatch,
      settledCount,
      totalPayableToFarmers: lockedBatch.totalPayableToFarmers,
      totalOwedByFarmers: lockedBatch.totalOwedByFarmers,
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Override / Reconciliation ──────────────────────────────────────────
const requestSettlementOverride = async (settlementId, requestedBy, reason, cooperativeId = null, ip = null) => {
  if (!reason || !reason.trim()) throw new Error('An override request requires a reason');

  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const settlement = await Settlement.findById(settlementId).session(session);
    if (!settlement) throw new Error('Settlement not found');
    if (cooperativeId && String(settlement.cooperativeId) !== String(cooperativeId)) throw new Error('Settlement does not belong to this cooperative');
    if (settlement.status !== 'MISMATCH') throw new Error(`Settlement is ${settlement.status}, an override can only be requested for a MISMATCH`);

    settlement.status = 'OVERRIDE_REQUESTED';
    settlement.overrideRequest.requestedBy = requestedBy;
    settlement.overrideRequest.requestedAt = new Date();
    settlement.overrideRequest.reason = reason.trim();
    settlement.overrideRequest.status = 'PENDING';
    await settlement.save({ session });

    await createAuditLog(requestedBy, 'SETTLEMENT_OVERRIDE_REQUESTED', {
      settlementId: settlement._id, farmerId: settlement.farmerId, cooperativeId: settlement.cooperativeId,
      expectedBalance: settlement.overrideRequest.expectedBalance, actualBalance: settlement.overrideRequest.actualBalance,
      difference: settlement.overrideRequest.difference, reason: reason.trim(),
    }, ip, session);

    await session.commitTransaction();
    session.endSession();
    return { success: true, settlement };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// Supervisor picks exactly one of ACCEPT_ACTUAL / KEEP_ORIGINAL / MANUAL_AMOUNT.
// Whatever is chosen becomes resolutionAmount — the amount actually paid out
// this round. The ledger is never forced to zero: closingOutstandingBalance
// = totalPayable - resolutionAmount rolls forward honestly. If the chosen
// amount differs from the live balance, that gap is posted as its own
// audited MANUAL_ADJUSTMENT entry BEFORE the SETTLEMENT entry — the ledger
// stays append-only and the entry itself records why the amount was chosen.
const approveSettlementOverride = async (settlementId, approverId, resolutionType, manualAmount, resolutionNotes, cooperativeId = null, ip = null) => {
  if (!RESOLUTION_TYPES.includes(resolutionType)) throw new Error(`resolutionType must be one of ${RESOLUTION_TYPES.join(', ')}`);
  if (resolutionType === 'MANUAL_AMOUNT') {
    if (!Number.isFinite(Number(manualAmount))) throw new Error('MANUAL_AMOUNT resolution requires a numeric manualAmount');
    if (!resolutionNotes || !resolutionNotes.trim()) throw new Error('MANUAL_AMOUNT resolution requires resolutionNotes explaining the figure');
  }

  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const settlement = await Settlement.findById(settlementId).session(session);
    if (!settlement) throw new Error('Settlement not found');
    if (cooperativeId && String(settlement.cooperativeId) !== String(cooperativeId)) throw new Error('Settlement does not belong to this cooperative');
    if (settlement.status !== 'OVERRIDE_REQUESTED') throw new Error(`Settlement is ${settlement.status}, nothing pending approval`);
    if (String(settlement.overrideRequest?.requestedBy) === String(approverId)) throw new Error('Requester cannot approve their own override');

    // Idempotent short-circuit: if a prior attempt already settled this
    // (e.g. a retried request after a lost response), don't do it twice.
    const alreadySettledEntry = await Ledger.findOne({ idempotencyKey: `OVERRIDE_SETTLEMENT:${settlement._id}` }).session(session);
    if (alreadySettledEntry) {
      await session.commitTransaction();
      session.endSession();
      return { success: true, settlement, idempotentReplay: true };
    }

    const liveBalance = (await getFarmerBalanceSnapshot(settlement.farmerId, settlement.cooperativeId, session)).runningBalance;

    let resolutionAmount;
    if (resolutionType === 'ACCEPT_ACTUAL') resolutionAmount = liveBalance;
    else if (resolutionType === 'KEEP_ORIGINAL') resolutionAmount = money(settlement.totalPayable);
    else resolutionAmount = money(manualAmount);

    const adjustment = round2(resolutionAmount - liveBalance);
    let balanceAfterAdjustment = liveBalance;

    if (adjustment !== 0) {
      const { doc: adjustmentLedgerDoc } = await insertLedgerIdempotent({
        cooperativeId: settlement.cooperativeId, farmerId: settlement.farmerId, settlementId: settlement._id, batchId: settlement.batchId,
        type: 'MANUAL_ADJUSTMENT', amount: adjustment, runningBalance: 0,
        description: `Settlement override reconciliation (${resolutionType})`,
        reference: settlement.settlementNumber, createdBy: approverId,
        metadata: {
          source: 'SETTLEMENT_OVERRIDE_RECONCILIATION', resolutionType,
          expectedBalance: settlement.overrideRequest?.expectedBalance, actualBalanceAtApproval: liveBalance, resolutionAmount,
          reason: settlement.overrideRequest?.reason, requestedBy: settlement.overrideRequest?.requestedBy,
        },
        timestamp: new Date(), idempotencyKey: `OVERRIDE_ADJUSTMENT:${settlement._id}`,
      }, session);
      balanceAfterAdjustment = await incrementFarmerBalance(settlement.farmerId, settlement.cooperativeId, adjustment, adjustmentLedgerDoc._id, session);
      await Ledger.updateOne({ _id: adjustmentLedgerDoc._id }, { $set: { runningBalance: balanceAfterAdjustment } }, { session });
    }

    const { doc: settlementLedgerEntry } = await insertLedgerIdempotent({
      cooperativeId: settlement.cooperativeId, farmerId: settlement.farmerId, settlementId: settlement._id, batchId: settlement.batchId,
      type: 'SETTLEMENT', amount: -resolutionAmount, runningBalance: 0,
      description: `Reconciled settlement (override, ${resolutionType}) ${settlement.periodStart.toISOString().slice(0, 10)}`,
      reference: settlement.settlementNumber, createdBy: approverId,
      metadata: { source: 'SETTLEMENT_OVERRIDE_RECONCILIATION', resolutionType, resolutionAmount, originalTotalPayable: settlement.totalPayable, reason: settlement.overrideRequest?.reason, requestedBy: settlement.overrideRequest?.requestedBy },
      timestamp: new Date(), idempotencyKey: `OVERRIDE_SETTLEMENT:${settlement._id}`,
    }, session);
    const balanceAfterSettlement = await incrementFarmerBalance(settlement.farmerId, settlement.cooperativeId, -resolutionAmount, settlementLedgerEntry._id, session);
    await Ledger.updateOne({ _id: settlementLedgerEntry._id }, { $set: { runningBalance: balanceAfterSettlement } }, { session });

    const closingOutstandingBalance = computeClosingOutstandingBalance(settlement.totalPayable, resolutionAmount);

    settlement.status = 'SETTLED';
    settlement.settledBy = approverId;
    settlement.settledAt = new Date();
    settlement.ledgerEntryId = settlementLedgerEntry._id;
    settlement.closingOutstandingBalance = closingOutstandingBalance;
    settlement.overrideRequest.status = 'APPROVED';
    settlement.overrideRequest.approvedBy = approverId;
    settlement.overrideRequest.approvedAt = new Date();
    settlement.overrideRequest.resolutionType = resolutionType;
    settlement.overrideRequest.resolutionAmount = resolutionAmount;
    settlement.overrideRequest.resolutionNotes = resolutionNotes || '';
    await settlement.save({ session });

    await createAuditLog(approverId, 'SETTLEMENT_OVERRIDE_APPROVED', {
      settlementId: settlement._id, farmerId: settlement.farmerId, cooperativeId: settlement.cooperativeId,
      generationBalance: settlement.generationBalance, expectedBalance: settlement.overrideRequest.expectedBalance,
      actualBalanceAtApproval: liveBalance, resolutionType, resolutionAmount, adjustmentPosted: adjustment,
      closingOutstandingBalance, reason: settlement.overrideRequest.reason, requestedBy: settlement.overrideRequest.requestedBy,
    }, ip, session);

    const batch = await SettlementBatch.findById(settlement.batchId).session(session);
    const [settledCount, unresolvedCount, totalCount] = await Promise.all([
      Settlement.countDocuments({ batchId: batch._id, status: 'SETTLED' }).session(session),
      Settlement.countDocuments({ batchId: batch._id, status: { $in: ['MISMATCH', 'OVERRIDE_REQUESTED'] } }).session(session),
      Settlement.countDocuments({ batchId: batch._id }).session(session),
    ]);
    batch.totalSettledFarmers = settledCount;
    batch.totalMismatchedFarmers = unresolvedCount;
    if (unresolvedCount === 0 && settledCount === totalCount) {
      batch.status = 'SETTLED';
      batch.settledBy = approverId;
      batch.settledAt = new Date();
    }
    await batch.save({ session });

    await session.commitTransaction();
    session.endSession();
    return { success: true, settlement, batch };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const rejectSettlementOverride = async (settlementId, approverId, resolutionNotes, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const settlement = await Settlement.findById(settlementId).session(session);
    if (!settlement) throw new Error('Settlement not found');
    if (cooperativeId && String(settlement.cooperativeId) !== String(cooperativeId)) throw new Error('Settlement does not belong to this cooperative');
    if (settlement.status !== 'OVERRIDE_REQUESTED') throw new Error(`Settlement is ${settlement.status}, nothing pending approval`);
    if (String(settlement.overrideRequest?.requestedBy) === String(approverId)) throw new Error('Requester cannot reject their own override');

    settlement.status = 'MISMATCH';
    settlement.overrideRequest.status = 'REJECTED';
    settlement.overrideRequest.approvedBy = approverId;
    settlement.overrideRequest.approvedAt = new Date();
    settlement.overrideRequest.resolutionNotes = resolutionNotes || '';
    await settlement.save({ session });

    await createAuditLog(approverId, 'SETTLEMENT_OVERRIDE_REJECTED', {
      settlementId: settlement._id, farmerId: settlement.farmerId, cooperativeId: settlement.cooperativeId,
      reason: settlement.overrideRequest.reason, notes: resolutionNotes,
    }, ip, session);

    await session.commitTransaction();
    session.endSession();
    return { success: true, settlement };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Close Batch ────────────────────────────────────────────
const closeBatch = async (batchId, userId, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (cooperativeId && String(batch.cooperativeId) !== String(cooperativeId)) throw new Error('Batch does not belong to this cooperative');
    if (batch.status !== 'SETTLED') throw new Error(`Batch is ${batch.status}, can only close a fully SETTLED batch`);

    batch.status = 'CLOSED';
    batch.closedBy = userId;
    batch.closedAt = new Date();
    await batch.save({ session });

    await createAuditLog(userId, 'SETTLEMENT_BATCH_CLOSED', { batchId: batch._id, cooperativeId: batch.cooperativeId, year: batch.year, month: batch.month }, ip, session);

    await session.commitTransaction();
    session.endSession();
    return { success: true, batch };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Payment (separate from settlement calculation) ─────────────────────
// Records that money physically moved for a SETTLED settlement. Does not
// touch the Ledger or the farmer's balance — the SETTLEMENT ledger entry
// already recorded the calculated amount owed; this is the "did we actually
// send it" fact, trackable independently, extensible to real payment rails.
const recordPayment = async (
  settlementId,
  { amount, method, reference, externalReference },
  userId,
  cooperativeId = null,
  ip = null,
  idempotencyKey = null
) => {
  const settlement = await Settlement.findById(settlementId);
  if (!settlement) throw new Error('Settlement not found');
  if (cooperativeId && String(settlement.cooperativeId) !== String(cooperativeId)) {
    throw new Error('Settlement does not belong to this cooperative');
  }
  if (settlement.status !== 'SETTLED') {
    throw new Error(
      `Settlement is ${settlement.status}; cannot record payment before it is SETTLED`
    );
  }

  // ── Invariant: never pay debt or zero positions ───────────
  const payable = round2(settlement.payableToFarmer || 0);
  if (payable <= 0) {
    throw new Error('No amount payable to farmer; cannot record payment');
  }
  if (!Number.isFinite(Number(amount)) || Number(amount) <= 0) {
    throw new Error('Payment amount must be a positive number');
  }

  const alreadyPaid = round2(settlement.amountPaid || 0);
  const newAmount = money(amount);

  if (round2(alreadyPaid + newAmount) > payable + 0.01) {
    throw new Error(
      `Payment would exceed payableToFarmer (already paid ${alreadyPaid} of ${payable})`
    );
  }

  let payment;
  try {
    payment = await Payment.create({
      cooperativeId: settlement.cooperativeId,
      farmerId: settlement.farmerId,
      settlementId: settlement._id,
      batchId: settlement.batchId,
      amount: newAmount,
      method,
      reference: reference || settlement.settlementNumber,
      externalReference,
      status: 'PENDING',
      createdBy: userId,
      idempotencyKey: idempotencyKey || undefined,
    });
  } catch (err) {
    if (err.code === 11000 && idempotencyKey) {
      payment = await Payment.findOne({ idempotencyKey });
      if (payment) return { success: true, payment, idempotentReplay: true };
    }
    throw err;
  }

  const totalPaidNow = round2(alreadyPaid + newAmount);
  settlement.amountPaid = totalPaidNow;
  settlement.paymentStatus = amountsMatch(totalPaidNow, payable)
    ? 'PAID'
    : totalPaidNow > 0
      ? 'PARTIALLY_PAID'
      : 'UNPAID';
  await settlement.save();

  await createAuditLog(
    userId,
    'PAYMENT_RECORDED',
    {
      paymentId: payment._id,
      settlementId: settlement._id,
      farmerId: settlement.farmerId,
      cooperativeId: settlement.cooperativeId,
      amount: newAmount,
      method,
      totalPaidNow,
      payableToFarmer: payable,
    },
    ip,
    null
  );

  return { success: true, payment, settlement };
};

const confirmPayment = async (paymentId, userId, externalReference, cooperativeId = null, ip = null) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new Error('Payment not found');
  if (cooperativeId && String(payment.cooperativeId) !== String(cooperativeId)) throw new Error('Payment does not belong to this cooperative');
  if (payment.status !== 'PENDING') throw new Error(`Payment is ${payment.status}, cannot confirm`);

  payment.status = 'CONFIRMED';
  payment.confirmedBy = userId;
  payment.confirmedAt = new Date();
  if (externalReference) payment.externalReference = externalReference;
  await payment.save();

  await createAuditLog(userId, 'PAYMENT_CONFIRMED', {
    paymentId: payment._id, settlementId: payment.settlementId, cooperativeId: payment.cooperativeId, amount: payment.amount, externalReference,
  }, ip, null);

  return { success: true, payment };
};

// ─── Reads ──────────────────────────────────────────────────
const getBatch = async (batchId, cooperativeId = null) => {
  const filter = cooperativeId ? { _id: batchId, cooperativeId } : { _id: batchId };
  const batch = await SettlementBatch.findOne(filter)
    .populate('generatedBy', 'name').populate('approvedBy', 'name').populate('settledBy', 'name').populate('closedBy', 'name').lean();
  if (!batch) throw new Error('Batch not found');
  return batch;
};

const getBatchSettlements = async (batchId, cooperativeId = null, query = {}) => {
  const { page = 1, limit = 20, farmerId, status } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;
  const filter = { batchId };
  if (cooperativeId) filter.cooperativeId = cooperativeId;
  if (farmerId) filter.farmerId = farmerId;
  if (status) filter.status = status;

  const [settlements, total] = await Promise.all([
    Settlement.find(filter).populate('farmerId', 'name phone').populate('settledBy', 'name').sort({ periodStart: -1 }).skip(skip).limit(pageSize).lean(),
    Settlement.countDocuments(filter),
  ]);
  return { settlements, total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) };
};

const getPendingOverrides = async (cooperativeId, query = {}) => {
  const { page = 1, limit = 20 } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;
  const filter = { cooperativeId, status: { $in: ['MISMATCH', 'OVERRIDE_REQUESTED'] } };

  const [settlements, total] = await Promise.all([
    Settlement.find(filter).populate('farmerId', 'name phone').populate('overrideRequest.requestedBy', 'name')
      .sort({ 'overrideRequest.requestedAt': 1, createdAt: 1 }).skip(skip).limit(pageSize).lean(),
    Settlement.countDocuments(filter),
  ]);
  return { settlements, total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) };
};

const getFarmerSettlements = async (farmerId, cooperativeId, limit = 12, status = null) => {
  const filter = { cooperativeId, farmerId };
  if (status) filter.status = status;
  return Settlement.find(filter).populate('settledBy', 'name').sort({ periodStart: -1 }).limit(parseInt(limit)).lean();
};

const getBatches = async (cooperativeId, query = {}) => {
  const { page = 1, limit = 20, status } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;
  const filter = { cooperativeId };
  if (status) filter.status = status;

  const [batches, total] = await Promise.all([
    SettlementBatch.find(filter).populate('generatedBy', 'name').populate('approvedBy', 'name').populate('settledBy', 'name').populate('closedBy', 'name')
      .sort({ createdAt: -1 }).skip(skip).limit(pageSize).lean(),
    SettlementBatch.countDocuments(filter),
  ]);
  return { batches, total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) };
};

module.exports = {
  getPeriodBounds, assertPeriodOpen, PeriodLockedError, RESOLUTION_TYPES,
  incrementFarmerBalance, getFarmerBalanceSnapshot,

  generateSettlements, approveBatch, settleBatch,
  requestSettlementOverride, approveSettlementOverride, rejectSettlementOverride, closeBatch,
  recordPayment, confirmPayment,

  getBatch, getBatchSettlements, getPendingOverrides, getFarmerSettlements, getBatches,
};