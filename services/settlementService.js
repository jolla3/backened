// services/settlementService.js
//
// Multi-tenant: cooperativeId required on every public entry point.
//
// Accounting:
//   periodNet        = ledger in [periodStart, nextPeriodStart) for this coop
//   openingBalance   = last ledger runningBalance with timestamp < periodStart
//   closingBalance   = openingBalance + periodNet
//   amountPayable    = max(closingBalance, 0)
//   amountOwedToCoop = max(-closingBalance, 0)
//
// Settlement numbers are cryptographic (SET-<12 chars>), not sequential.
//
const crypto = require('crypto');
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Settlement = require('../models/settlement');
const SettlementBatch = require('../models/SettlementBatch');
const Payment = require('../models/payment');
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
} = require('./settlementMath');

const LOCKED_BATCH_STATUSES = ['SETTLING', 'PARTIALLY_SETTLED', 'SETTLED', 'CLOSED'];

const SETTLEMENT_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const SETTLEMENT_CODE_LENGTH = 12;
const SETTLEMENT_NUMBER_MAX_ATTEMPTS = 8;

class PeriodLockedError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PeriodLockedError';
    this.code = 'PERIOD_LOCKED';
  }
}

const TX_OPTS = {
  readConcern: { level: 'snapshot' },
  writeConcern: { w: 'majority' },
};

// ─── Tenant helpers ──────────────────────────────────────────
const requireCooperativeId = (cooperativeId, label = 'cooperativeId') => {
  if (!cooperativeId) throw new Error(`${label} is required`);
  if (!mongoose.Types.ObjectId.isValid(cooperativeId)) {
    throw new Error(`Invalid ${label}`);
  }
  return new mongoose.Types.ObjectId(cooperativeId);
};

const sameCoop = (a, b) => String(a) === String(b);

const assertBatchBelongsToCoop = (batch, cooperativeId) => {
  if (!batch) throw new Error('Batch not found');
  if (!sameCoop(batch.cooperativeId, cooperativeId)) {
    throw new Error('Batch does not belong to this cooperative');
  }
};

const assertSettlementBelongsToCoop = (settlement, cooperativeId) => {
  if (!settlement) throw new Error('Settlement not found');
  if (!sameCoop(settlement.cooperativeId, cooperativeId)) {
    throw new Error('Settlement does not belong to this cooperative');
  }
};

// ─── Cryptographic settlement numbers ────────────────────────
const randomSettlementCode = (length = SETTLEMENT_CODE_LENGTH) => {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += SETTLEMENT_ALPHABET[crypto.randomInt(0, SETTLEMENT_ALPHABET.length)];
  }
  return code;
};

/**
 * Format: SET-X7K9Q2M4N8P3
 * Unbiased crypto.randomInt + unique index backstop.
 */
const generateSettlementNumber = async (cooperativeId, session, maxAttempts = SETTLEMENT_NUMBER_MAX_ATTEMPTS) => {
  const coopId = requireCooperativeId(cooperativeId);

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `SET-${randomSettlementCode()}`;

    // Prefer coop-scoped uniqueness. If you still have a global unique index
    // on settlementNumber alone, this still works (exists check is coop-scoped
    // but insert will retry on E11000 via allocateSettlementNumbers).
    let query = Settlement.exists({
      cooperativeId: coopId,
      settlementNumber: candidate,
    });
    if (session) query = query.session(session);
    const exists = await query;
    if (!exists) return candidate;
  }

  throw new Error('Unable to generate unique settlement number after retries');
};

const allocateSettlementNumbers = async (cooperativeId, count, session) => {
  if (count <= 0) return [];
  const numbers = [];
  const seen = new Set();

  for (let i = 0; i < count; i++) {
    let n;
    let attempts = 0;
    do {
      n = await generateSettlementNumber(cooperativeId, session);
      attempts += 1;
      if (attempts > SETTLEMENT_NUMBER_MAX_ATTEMPTS * 3) {
        throw new Error('Unable to allocate unique settlement numbers');
      }
    } while (seen.has(n));
    seen.add(n);
    numbers.push(n);
  }
  return numbers;
};

// ─── Period lock ─────────────────────────────────────────────
const assertPeriodOpen = async (cooperativeId, timestamp, session = null) => {
  const coopId = requireCooperativeId(cooperativeId);
  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const year = ts.getUTCFullYear();
  const month = ts.getUTCMonth() + 1;

  let query = SettlementBatch.findOne({
    cooperativeId: coopId,
    year,
    month,
    status: { $in: LOCKED_BATCH_STATUSES },
  });
  if (session) query = query.session(session);
  const locked = await query;
  if (locked) {
    throw new PeriodLockedError(
      `Accounting period ${year}-${String(month).padStart(2, '0')} is ${locked.status} and locked for this cooperative.`
    );
  }
  return true;
};

const incrementFarmerBalance = async (farmerId, cooperativeId, amount, ledgerId, session) => {
  const coopId = requireCooperativeId(cooperativeId);
  const updated = await Farmer.findOneAndUpdate(
    { _id: farmerId, cooperativeId: coopId },
    {
      $inc: { currentBalance: amount },
      $set: { lastLedgerId: ledgerId, balanceUpdatedAt: new Date() },
    },
    { returnDocument: 'after', session }
  );
  if (!updated) {
    throw new Error(`Farmer ${farmerId} not found in cooperative ${coopId}`);
  }
  return round2(updated.currentBalance);
};

const getBalanceBefore = async (cooperativeId, farmerId, beforeTimestamp, session) => {
  const coopId = requireCooperativeId(cooperativeId);
  let query = Ledger.find({
    cooperativeId: coopId,
    farmerId,
    timestamp: { $lt: beforeTimestamp },
  })
    .sort({ timestamp: -1, _id: -1 })
    .limit(1);
  if (session) query = query.session(session);
  const [row] = await query;
  return row ? round2(row.runningBalance) : 0;
};

const loadPeriodTotalsByFarmer = async (
  cooperativeId,
  farmerIds,
  periodStart,
  nextPeriodStart,
  session
) => {
  const coopId = requireCooperativeId(cooperativeId);
  const perTypeAgg = await Ledger.aggregate([
    {
      $match: {
        cooperativeId: coopId,
        farmerId: { $in: farmerIds },
        type: { $in: SETTLEABLE_TYPES },
        timestamp: { $gte: periodStart, $lt: nextPeriodStart },
      },
    },
    {
      $group: {
        _id: { farmerId: '$farmerId', type: '$type' },
        total: { $sum: '$amount' },
        litres: { $sum: { $ifNull: ['$metadata.litres', 0] } },
      },
    },
  ]).session(session);

  const byFarmer = new Map();
  for (const row of perTypeAgg) {
    const idStr = row._id.farmerId.toString();
    if (!byFarmer.has(idStr)) byFarmer.set(idStr, {});
    byFarmer.get(idStr)[row._id.type] = {
      total: row.total || 0,
      litres: row.litres || 0,
    };
  }
  return byFarmer;
};

const recomputeFarmerPeriodPosition = async (
  cooperativeId,
  farmerId,
  periodStart,
  nextPeriodStart,
  session
) => {
  const coopId = requireCooperativeId(cooperativeId);
  const byFarmer = await loadPeriodTotalsByFarmer(
    coopId,
    [farmerId],
    periodStart,
    nextPeriodStart,
    session
  );
  const types = byFarmer.get(farmerId.toString()) || {};
  const period = computePeriodSettlement(types);
  const openingBalance = await getBalanceBefore(coopId, farmerId, periodStart, session);
  const position = computeSettlementPosition(openingBalance, period.periodNet);
  return { period, position };
};

const getOrCreateBatch = async (cooperativeId, year, month, bounds, userId, session) => {
  const coopId = requireCooperativeId(cooperativeId);
  return SettlementBatch.findOneAndUpdate(
    { cooperativeId: coopId, year, month },
    {
      $setOnInsert: {
        cooperativeId: coopId,
        year,
        month,
        periodStart: bounds.periodStart,
        periodEnd: bounds.periodEnd,
        nextPeriodStart: bounds.nextPeriodStart,
        status: 'GENERATING',
        generatedBy: userId,
        generatedAt: new Date(),
        generationLockedAt: null,
        totalFarmers: 0,
        totalSkippedFarmers: 0,
        totalGrossMilkLitres: 0,
        totalGrossMilkEarnings: 0,
        totalDeductions: 0,
        totalBonuses: 0,
        totalOpeningBalance: 0,
        totalNetPayable: 0,
        totalPayable: 0,
        totalPayableToFarmers: 0,
        totalOwedByFarmers: 0,
        averageMilkRatePerLitre: 0,
        highestSettlement: 0,
        lowestSettlement: 0,
        totalSettledFarmers: 0,
        totalMismatchedFarmers: 0,
      },
    },
    {
      upsert: true,
      returnDocument: 'after',
      session,
      setDefaultsOnInsert: true,
    }
  );
};

const createAuditLog = async (userId, action, metadata, ip, session) => {
  if (!AuditLog) return;
  try {
    await new AuditLog({
      userId,
      action,
      metadata,
      ipAddress: ip,
      timestamp: new Date(),
    }).save({ session });
  } catch (e) {
    logger.warn('Audit log failed', { error: e.message });
  }
};

const insertLedgerIdempotent = async (doc, session) => {
  if (!doc.cooperativeId) {
    throw new Error('Ledger entry requires cooperativeId');
  }
  try {
    const [created] = await Ledger.create([doc], { session });
    return { doc: created, wasAlreadyDone: false };
  } catch (err) {
    if (err.code === 11000 && doc.idempotencyKey) {
      const existing = await Ledger.findOne({
        cooperativeId: doc.cooperativeId,
        idempotencyKey: doc.idempotencyKey,
      }).session(session);
      if (existing) return { doc: existing, wasAlreadyDone: true };
    }
    throw err;
  }
};

// ─── Generate ────────────────────────────────────────────────
const generateSettlements = async (cooperativeId, year, month, userId, ip = null) => {
  const coopId = requireCooperativeId(cooperativeId);
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction(TX_OPTS);

    const cooperative = await Cooperative.findById(coopId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    const bounds = getPeriodBounds(year, month);
    const { periodStart, periodEnd, nextPeriodStart } = bounds;

    const existingBatch = await getOrCreateBatch(coopId, year, month, bounds, userId, session);
    assertBatchBelongsToCoop(existingBatch, coopId);

    if (existingBatch.status !== 'GENERATING' && existingBatch.status !== 'GENERATED') {
      throw new Error(`Settlements for ${year}-${month} are already ${existingBatch.status}`);
    }

    if (existingBatch.status === 'GENERATED') {
      const settlements = await Settlement.find({
        batchId: existingBatch._id,
        cooperativeId: coopId,
      }).session(session);
      await session.commitTransaction();
      session.endSession();
      return {
        success: true,
        batch: existingBatch,
        settlements,
        count: settlements.length,
        idempotentReplay: true,
      };
    }

    const batch = await SettlementBatch.findOneAndUpdate(
      {
        _id: existingBatch._id,
        cooperativeId: coopId,
        status: 'GENERATING',
        generationLockedAt: null,
      },
      { $set: { generationLockedAt: new Date(), generationLockedBy: userId } },
      { returnDocument: 'after', session }
    );
    if (!batch) {
      throw new Error(`Settlement generation for ${year}-${month} is already in progress`);
    }

    // Remove orphans from a previous failed generate on this batch
    await Settlement.deleteMany({
      batchId: batch._id,
      cooperativeId: coopId,
    }).session(session);

    const farmers = await Farmer.find({ cooperativeId: coopId, isActive: true })
      .select('_id name farmer_code phone zoneId zoneName')
      .session(session);

    if (!farmers.length) {
      batch.status = 'CANCELLED';
      await batch.save({ session });
      await session.commitTransaction();
      session.endSession();
      return { success: false, message: 'No active farmers found' };
    }

    const farmerIds = farmers.map((f) => f._id);
    const byFarmer = await loadPeriodTotalsByFarmer(
      coopId,
      farmerIds,
      periodStart,
      nextPeriodStart,
      session
    );

    const generationAt = new Date();
    const docs = [];
    const summary = {
      totalGrossMilkLitres: 0,
      totalGrossMilkEarnings: 0,
      totalDeductions: 0,
      totalBonuses: 0,
      totalOpeningBalance: 0,
      totalNetPayable: 0,
      totalPayableToFarmers: 0,
      totalOwedByFarmers: 0,
      highest: 0,
      lowest: Infinity,
      totalSkipped: 0,
    };

    for (const farmer of farmers) {
      const idStr = farmer._id.toString();
      const types = byFarmer.get(idStr) || {};
      const period = computePeriodSettlement(types);
      if (!period.hadActivity) {
        summary.totalSkipped += 1;
        continue;
      }

      const openingBalanceRaw = await getBalanceBefore(coopId, farmer._id, periodStart, session);
      const position = computeSettlementPosition(openingBalanceRaw, period.periodNet);

      docs.push({
        cooperativeId: coopId,
        batchId: batch._id,
        farmerId: farmer._id,
        farmerSnapshot: {
          name: farmer.name,
          code: farmer.farmer_code,
          phone: farmer.phone,
          zone: farmer.zoneName || farmer.zoneId?.toString(),
        },
        periodStart,
        periodEnd,
        nextPeriodStart,
        year,
        month,
        grossMilkLitres: period.grossMilkLitres,
        grossMilkEarnings: period.grossMilkEarnings,
        deductions: period.deductions,
        totalDeductions: period.totalDeductions,
        bonuses: period.bonuses,
        adjustments: period.adjustments,
        openingBalance: position.openingBalance,
        periodNet: position.periodNet,
        netPayable: position.periodNet,
        closingBalance: position.closingBalance,
        netPosition: position.closingBalance,
        amountPayable: position.amountPayable,
        amountOwedToCoop: position.amountOwedToCoop,
        payableToFarmer: position.amountPayable,
        amountOwedByFarmer: position.amountOwedToCoop,
        totalPayable: position.amountPayable,
        closingOutstandingBalance: position.amountOwedToCoop,
        status: 'GENERATED',
        generatedBy: userId,
        generationAt,
        notes: `Settlement ${periodStart.toISOString().slice(0, 10)} → ${new Date(nextPeriodStart.getTime() - 1).toISOString().slice(0, 10)}`,
      });

      summary.totalGrossMilkLitres += period.grossMilkLitres;
      summary.totalGrossMilkEarnings += period.grossMilkEarnings;
      summary.totalDeductions += period.totalDeductions;
      summary.totalBonuses += period.bonuses;
      summary.totalOpeningBalance += position.openingBalance;
      summary.totalNetPayable += position.periodNet;
      summary.totalPayableToFarmers += position.amountPayable;
      summary.totalOwedByFarmers += position.amountOwedToCoop;
      if (position.amountPayable > summary.highest) summary.highest = position.amountPayable;
      if (position.amountPayable < summary.lowest) summary.lowest = position.amountPayable;
    }

    const numbers = await allocateSettlementNumbers(coopId, docs.length, session);
    docs.forEach((doc, idx) => {
      doc.settlementNumber = numbers[idx];
    });

    let settlements = [];
    if (docs.length) {
      try {
        settlements = await Settlement.insertMany(docs, { session, ordered: true });
      } catch (err) {
        // Extremely unlikely crypto collision against unique index — surface clearly
        if (err.code === 11000) {
          throw new Error(
            'Settlement number collision on insert; retry generation. ' +
              'If this persists, ensure unique index is { cooperativeId: 1, settlementNumber: 1 }.'
          );
        }
        throw err;
      }
    }

    batch.status = 'GENERATED';
    batch.totalFarmers = settlements.length;
    batch.totalSkippedFarmers = summary.totalSkipped;
    batch.totalGrossMilkLitres = summary.totalGrossMilkLitres;
    batch.totalGrossMilkEarnings = summary.totalGrossMilkEarnings;
    batch.totalDeductions = summary.totalDeductions;
    batch.totalBonuses = summary.totalBonuses;
    batch.totalOpeningBalance = summary.totalOpeningBalance;
    batch.totalNetPayable = summary.totalNetPayable;
    batch.totalPayableToFarmers = summary.totalPayableToFarmers;
    batch.totalOwedByFarmers = summary.totalOwedByFarmers;
    batch.totalPayable = summary.totalPayableToFarmers;
    batch.averageMilkRatePerLitre =
      summary.totalGrossMilkLitres > 0
        ? summary.totalGrossMilkEarnings / summary.totalGrossMilkLitres
        : 0;
    batch.highestSettlement = summary.highest || 0;
    batch.lowestSettlement = summary.lowest === Infinity ? 0 : summary.lowest;
    batch.generatedAt = generationAt;
    await batch.save({ session });

    await createAuditLog(
      userId,
      'SETTLEMENT_GENERATED',
      {
        cooperativeId: coopId,
        year,
        month,
        count: settlements.length,
        skipped: summary.totalSkipped,
        totalPayableToFarmers: summary.totalPayableToFarmers,
        totalOwedByFarmers: summary.totalOwedByFarmers,
      },
      ip,
      session
    );

    await session.commitTransaction();
    session.endSession();
    return { success: true, batch, settlements, count: settlements.length, summary };
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    logger.error('Generate settlements error', {
      error: error.message,
      stack: error.stack,
      cooperativeId: String(cooperativeId),
    });
    throw error;
  }
};

// ─── Approve ─────────────────────────────────────────────────
const approveBatch = async (batchId, userId, cooperativeId, ip = null) => {
  const coopId = requireCooperativeId(cooperativeId);
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const batch = await SettlementBatch.findOne({
      _id: batchId,
      cooperativeId: coopId,
    }).session(session);
    assertBatchBelongsToCoop(batch, coopId);

    if (batch.status !== 'GENERATED') {
      throw new Error(`Batch is ${batch.status}, cannot approve`);
    }

    batch.status = 'APPROVED';
    batch.approvedBy = userId;
    batch.approvedAt = new Date();
    await batch.save({ session });

    await createAuditLog(
      userId,
      'SETTLEMENT_BATCH_APPROVED',
      {
        batchId: batch._id,
        cooperativeId: coopId,
        year: batch.year,
        month: batch.month,
        totalPayableToFarmers: batch.totalPayableToFarmers ?? batch.totalPayable,
      },
      ip,
      session
    );

    await session.commitTransaction();
    session.endSession();
    return { success: true, batch };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Settle ──────────────────────────────────────────────────
const settleBatch = async (batchId, userId, cooperativeId, ip = null) => {
  const coopId = requireCooperativeId(cooperativeId);
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);

  try {
    let batch = await SettlementBatch.findOne({
      _id: batchId,
      cooperativeId: coopId,
    }).session(session);
    assertBatchBelongsToCoop(batch, coopId);

    if (!batch.nextPeriodStart || !batch.periodStart) {
      const b = getPeriodBounds(batch.year, batch.month);
      batch.periodStart = batch.periodStart || b.periodStart;
      batch.periodEnd = batch.periodEnd || b.periodEnd;
      batch.nextPeriodStart = batch.nextPeriodStart || b.nextPeriodStart;
      await batch.save({ session });
    }

    const settleableFrom = ['GENERATED', 'APPROVED', 'PARTIALLY_SETTLED'];
    if (!settleableFrom.includes(batch.status)) {
      throw new Error(`Batch is ${batch.status}, cannot settle`);
    }
    if (batch.nextPeriodStart > new Date()) {
      throw new Error('Cannot settle an accounting period that has not closed yet');
    }

    const lockedBatch = await SettlementBatch.findOneAndUpdate(
      {
        _id: batchId,
        cooperativeId: coopId,
        status: { $in: settleableFrom },
      },
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
      { batchId: lockedBatch._id, cooperativeId: coopId },
      ip,
      session
    );

    const pending = await Settlement.find({
      batchId: lockedBatch._id,
      cooperativeId: coopId,
      status: { $in: ['GENERATED', 'MISMATCH'] },
    }).session(session);

    const settledOps = [];
    let settledCount = 0;

    for (const settlement of pending) {
      assertSettlementBelongsToCoop(settlement, coopId);

      const { period, position } = await recomputeFarmerPeriodPosition(
        coopId,
        settlement.farmerId,
        settlement.periodStart,
        settlement.nextPeriodStart,
        session
      );

      const amountPayable = position.amountPayable;
      const amountOwedToCoop = position.amountOwedToCoop;
      let ledgerEntryId = null;

      if (amountPayable > 0) {
        const idempotencyKey = `SETTLEMENT:${coopId}:${settlement._id}`;
        const { doc: ledgerDoc, wasAlreadyDone } = await insertLedgerIdempotent(
          {
            cooperativeId: coopId,
            farmerId: settlement.farmerId,
            settlementId: settlement._id,
            batchId: lockedBatch._id,
            type: 'SETTLEMENT',
            amount: -amountPayable,
            runningBalance: 0,
            description: `Settlement payout ${settlement.settlementNumber}`,
            reference: settlement.settlementNumber,
            createdBy: userId,
            metadata: {
              year: settlement.year,
              month: settlement.month,
              openingBalance: position.openingBalance,
              periodNet: position.periodNet,
              closingBalance: position.closingBalance,
              amountPayable,
              amountOwedToCoop,
            },
            timestamp: new Date(),
            idempotencyKey,
          },
          session
        );

        if (!wasAlreadyDone) {
          const newBal = await incrementFarmerBalance(
            settlement.farmerId,
            coopId,
            -amountPayable,
            ledgerDoc._id,
            session
          );
          await Ledger.updateOne(
            { _id: ledgerDoc._id, cooperativeId: coopId },
            { $set: { runningBalance: newBal } },
            { session }
          );
        }
        ledgerEntryId = ledgerDoc._id;
      }

      settledOps.push({
        updateOne: {
          filter: { _id: settlement._id, cooperativeId: coopId },
          update: {
            $set: {
              status: 'SETTLED',
              settledBy: userId,
              settledAt: new Date(),
              ledgerEntryId,
              grossMilkLitres: period.grossMilkLitres,
              grossMilkEarnings: period.grossMilkEarnings,
              totalDeductions: period.totalDeductions,
              bonuses: period.bonuses,
              adjustments: period.adjustments,
              openingBalance: position.openingBalance,
              periodNet: position.periodNet,
              netPayable: position.periodNet,
              closingBalance: position.closingBalance,
              netPosition: position.closingBalance,
              amountPayable,
              amountOwedToCoop,
              payableToFarmer: amountPayable,
              amountOwedByFarmer: amountOwedToCoop,
              totalPayable: amountPayable,
              closingOutstandingBalance: amountOwedToCoop,
            },
          },
        },
      });
      settledCount += 1;
    }

    if (settledOps.length) {
      await Settlement.bulkWrite(settledOps, { session });
    }

    const agg = await Settlement.aggregate([
      { $match: { batchId: lockedBatch._id, cooperativeId: coopId } },
      {
        $group: {
          _id: null,
          totalPayableToFarmers: {
            $sum: { $ifNull: ['$amountPayable', '$payableToFarmer'] },
          },
          totalOwedByFarmers: {
            $sum: { $ifNull: ['$amountOwedToCoop', '$amountOwedByFarmer'] },
          },
          settled: {
            $sum: { $cond: [{ $eq: ['$status', 'SETTLED'] }, 1, 0] },
          },
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
    lockedBatch.totalPayableToFarmers = round2(totals.totalPayableToFarmers || 0);
    lockedBatch.totalOwedByFarmers = round2(totals.totalOwedByFarmers || 0);
    lockedBatch.totalPayable = lockedBatch.totalPayableToFarmers;
    lockedBatch.status =
      totals.settled === totals.total && totals.total > 0 ? 'SETTLED' : 'PARTIALLY_SETTLED';
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
        cooperativeId: coopId,
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

// ─── Close ───────────────────────────────────────────────────
const closeBatch = async (batchId, userId, cooperativeId, ip = null) => {
  const coopId = requireCooperativeId(cooperativeId);
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const batch = await SettlementBatch.findOne({
      _id: batchId,
      cooperativeId: coopId,
    }).session(session);
    assertBatchBelongsToCoop(batch, coopId);

    if (batch.status !== 'SETTLED') {
      throw new Error(`Batch is ${batch.status}, can only close a fully SETTLED batch`);
    }

    batch.status = 'CLOSED';
    batch.closedBy = userId;
    batch.closedAt = new Date();
    await batch.save({ session });

    await createAuditLog(
      userId,
      'SETTLEMENT_BATCH_CLOSED',
      {
        batchId: batch._id,
        cooperativeId: coopId,
        year: batch.year,
        month: batch.month,
      },
      ip,
      session
    );

    await session.commitTransaction();
    session.endSession();
    return { success: true, batch };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Payment ─────────────────────────────────────────────────
const recordPayment = async (
  settlementId,
  { amount, method, reference, externalReference },
  userId,
  cooperativeId,
  ip = null,
  idempotencyKey = null
) => {
  const coopId = requireCooperativeId(cooperativeId);

  const settlement = await Settlement.findOne({
    _id: settlementId,
    cooperativeId: coopId,
  });
  assertSettlementBelongsToCoop(settlement, coopId);

  if (settlement.status !== 'SETTLED') {
    throw new Error(`Settlement is ${settlement.status}; cannot record payment before SETTLED`);
  }

  const payable = round2(
    settlement.amountPayable ?? settlement.payableToFarmer ?? settlement.totalPayable ?? 0
  );
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
      `Payment would exceed amountPayable (already paid ${alreadyPaid} of ${payable})`
    );
  }

  let payment;
  try {
    payment = await Payment.create({
      cooperativeId: coopId,
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
      payment = await Payment.findOne({
        cooperativeId: coopId,
        idempotencyKey,
      });
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
      cooperativeId: coopId,
      amount: newAmount,
      totalPaidNow,
      amountPayable: payable,
    },
    ip,
    null
  );

  return { success: true, payment, settlement };
};

const confirmPayment = async (paymentId, userId, externalReference, cooperativeId, ip = null) => {
  const coopId = requireCooperativeId(cooperativeId);

  const payment = await Payment.findOne({
    _id: paymentId,
    cooperativeId: coopId,
  });
  if (!payment) throw new Error('Payment not found');
  if (!sameCoop(payment.cooperativeId, coopId)) {
    throw new Error('Payment does not belong to this cooperative');
  }
  if (payment.status !== 'PENDING') {
    throw new Error(`Payment is ${payment.status}, cannot confirm`);
  }

  payment.status = 'CONFIRMED';
  payment.confirmedBy = userId;
  payment.confirmedAt = new Date();
  if (externalReference) payment.externalReference = externalReference;
  await payment.save();

  await createAuditLog(
    userId,
    'PAYMENT_CONFIRMED',
    {
      paymentId: payment._id,
      settlementId: payment.settlementId,
      cooperativeId: coopId,
      amount: payment.amount,
      externalReference,
    },
    ip,
    null
  );

  return { success: true, payment };
};

// ─── Reads ───────────────────────────────────────────────────
const getBatch = async (batchId, cooperativeId) => {
  const coopId = requireCooperativeId(cooperativeId);
  const batch = await SettlementBatch.findOne({ _id: batchId, cooperativeId: coopId })
    .populate('generatedBy', 'name')
    .populate('approvedBy', 'name')
    .populate('settledBy', 'name')
    .populate('closedBy', 'name')
    .lean();
  if (!batch) throw new Error('Batch not found');
  return batch;
};

const getBatchSettlements = async (batchId, cooperativeId, query = {}) => {
  const coopId = requireCooperativeId(cooperativeId);
  const { page = 1, limit = 20, farmerId, status } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;

  const batch = await SettlementBatch.findOne({ _id: batchId, cooperativeId: coopId }).select('_id');
  if (!batch) throw new Error('Batch not found');

  const filter = { batchId, cooperativeId: coopId };
  if (farmerId) filter.farmerId = farmerId;
  if (status) filter.status = status;

  const [settlements, total] = await Promise.all([
    Settlement.find(filter)
      .populate('farmerId', 'name phone')
      .populate('settledBy', 'name')
      .sort({ periodStart: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    Settlement.countDocuments(filter),
  ]);

  return {
    settlements,
    total,
    page: pageNumber,
    limit: pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

const getFarmerSettlements = async (farmerId, cooperativeId, limit = 12, status = null) => {
  const coopId = requireCooperativeId(cooperativeId);
  const filter = { cooperativeId: coopId, farmerId };
  if (status) filter.status = status;
  return Settlement.find(filter)
    .populate('settledBy', 'name')
    .sort({ periodStart: -1 })
    .limit(parseInt(limit, 10))
    .lean();
};

const getBatches = async (cooperativeId, query = {}) => {
  const coopId = requireCooperativeId(cooperativeId);
  const { page = 1, limit = 20, status } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;
  const filter = { cooperativeId: coopId };
  if (status) filter.status = status;

  const [batches, total] = await Promise.all([
    SettlementBatch.find(filter)
      .populate('generatedBy', 'name')
      .populate('approvedBy', 'name')
      .populate('settledBy', 'name')
      .populate('closedBy', 'name')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    SettlementBatch.countDocuments(filter),
  ]);

  return {
    batches,
    total,
    page: pageNumber,
    limit: pageSize,
    totalPages: Math.ceil(total / pageSize),
  };
};

module.exports = {
  getPeriodBounds,
  assertPeriodOpen,
  PeriodLockedError,
  incrementFarmerBalance,
  generateSettlementNumber,
  allocateSettlementNumbers,

  generateSettlements,
  approveBatch,
  settleBatch,
  closeBatch,
  recordPayment,
  confirmPayment,

  getBatch,
  getBatchSettlements,
  getFarmerSettlements,
  getBatches,
};