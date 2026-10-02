// services/settlementService.js
//
// Multi-tenant: cooperativeId required on every public entry point.
//
// Accounting:
//   periodNet        = ledger activity in [periodStart, nextPeriodStart)
//   openingBalance   = sum(ledger.amount) with timestamp < periodStart
//   closingBalance   = openingBalance + periodNet
//   amountPayable    = max(closingBalance, 0)
//   amountOwedToCoop = max(-closingBalance, 0)
//
// Before SETTLEMENT payout:
//   Farmer.currentBalance MUST match ledger closingBalance (within 1 cent).
//   On mismatch → status MISMATCH, no money movement.
// After payout:
//   Farmer.currentBalance = closingBalance - amountPayable  (via updateFarmerBalance)
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
const { updateFarmerBalance } = require('../utils/ledgerUtils');
const {
  round2,
  money,
  amountsMatch,
  getPeriodBounds,
  getNairobiYearMonth,
  isPeriodClosed,
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

// ─── Tenant ──────────────────────────────────────────────────
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

// ─── Settlement numbers (crypto) ─────────────────────────────
const randomSettlementCode = (length = SETTLEMENT_CODE_LENGTH) => {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += SETTLEMENT_ALPHABET[crypto.randomInt(0, SETTLEMENT_ALPHABET.length)];
  }
  return code;
};

const generateSettlementNumber = async (
  cooperativeId,
  session,
  maxAttempts = SETTLEMENT_NUMBER_MAX_ATTEMPTS
) => {
  const coopId = requireCooperativeId(cooperativeId);
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const candidate = `SET-${randomSettlementCode()}`;
    let query = Settlement.exists({
      cooperativeId: coopId,
      settlementNumber: candidate,
    });
    if (session) query = query.session(session);
    if (!(await query)) return candidate;
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
  const { year, month } = getNairobiYearMonth
    ? getNairobiYearMonth(ts)
    : { year: ts.getUTCFullYear(), month: ts.getUTCMonth() + 1 };

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

/**
 * Keep for milk / feed / ordinary ledger deltas (call sites outside this file).
 * Settlement does NOT use $inc — it uses updateFarmerBalance after verifying books.
 */
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

// Opening = sum of amounts before period (resistant to broken runningBalance chain)
const getOpeningBalanceFromAmounts = async (cooperativeId, farmerId, periodStart, session) => {
  const coopId = requireCooperativeId(cooperativeId);
  const [row] = await Ledger.aggregate([
    {
      $match: {
        cooperativeId: coopId,
        farmerId: new mongoose.Types.ObjectId(farmerId),
        timestamp: { $lt: periodStart },
      },
    },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ]).session(session);
  return round2(row?.total || 0);
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
  const openingBalance = await getOpeningBalanceFromAmounts(
    coopId,
    farmerId,
    periodStart,
    session
  );
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

const createAuditLog = async (userId, action, metadata, ip, session = null) => {
  if (!AuditLog) return;
  try {
    const doc = new AuditLog({
      userId,
      action,
      metadata,
      ipAddress: ip,
      timestamp: new Date(),
    });
    if (session) {
      await doc.save({ session });
    } else {
      await doc.save();
    }
  } catch (e) {
    logger.warn('Audit log failed', { error: e.message });
  }
};

const insertLedgerIdempotent = async (doc, session) => {
  if (!doc.cooperativeId) throw new Error('Ledger entry requires cooperativeId');
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

    await Settlement.deleteMany({ batchId: batch._id, cooperativeId: coopId }).session(session);

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

      const openingBalanceRaw = await getOpeningBalanceFromAmounts(
        coopId,
        farmer._id,
        periodStart,
        session
      );
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
        if (err.code === 11000) {
          throw new Error(
            'Settlement number collision on insert; retry generation. ' +
              'Ensure unique index is { cooperativeId: 1, settlementNumber: 1 }.'
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

    const periodClosed = typeof isPeriodClosed === 'function'
      ? isPeriodClosed(batch.nextPeriodStart)
      : !(batch.nextPeriodStart > new Date());

    if (!periodClosed) {
      throw new Error(
        `Cannot settle ${batch.year}-${String(batch.month).padStart(2, '0')}: ` +
          `period closes at ${new Date(batch.nextPeriodStart).toISOString()}. ` +
          `Now ${new Date().toISOString()}.`
      );
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
    let mismatchCount = 0;

    for (const settlement of pending) {
      assertSettlementBelongsToCoop(settlement, coopId);

      const { period, position } = await recomputeFarmerPeriodPosition(
        coopId,
        settlement.farmerId,
        settlement.periodStart,
        settlement.nextPeriodStart,
        session
      );

      const farmer = await Farmer.findOne({
        _id: settlement.farmerId,
        cooperativeId: coopId,
      })
        .select('_id currentBalance lastLedgerId')
        .session(session);

      if (!farmer) {
        throw new Error(`Farmer ${settlement.farmerId} not found`);
      }

      const farmerCurrentBalance = round2(farmer.currentBalance || 0);

      // Live ledger wallet (ALL time) — must match farmer.currentBalance.
      // Do NOT compare currentBalance to *period* closing: by the time we settle
      // last month, this month may already have milk/feed on the wallet.
      const lastLedger = await Ledger.findOne({
        cooperativeId: coopId,
        farmerId: settlement.farmerId,
      })
        .sort({ timestamp: -1, _id: -1 })
        .select('runningBalance')
        .session(session)
        .lean();

      const liveLedgerBalance = lastLedger
        ? round2(lastLedger.runningBalance)
        : 0;

      if (!amountsMatch(farmerCurrentBalance, liveLedgerBalance)) {
        const diff = round2(liveLedgerBalance - farmerCurrentBalance);
        mismatchCount += 1;

        logger.error('Settlement blocked: wallet counter ≠ live ledger', {
          farmerId: settlement.farmerId.toString(),
          cooperativeId: coopId.toString(),
          farmerCurrentBalance,
          liveLedgerBalance,
          periodClosingBalance: position.closingBalance,
          difference: diff,
          settlementId: settlement._id.toString(),
        });

        settledOps.push({
          updateOne: {
            filter: { _id: settlement._id, cooperativeId: coopId },
            update: {
              $set: {
                status: 'MISMATCH',
                openingBalance: position.openingBalance,
                periodNet: position.periodNet,
                closingBalance: position.closingBalance,
                netPosition: position.closingBalance,
                amountPayable: position.amountPayable,
                amountOwedToCoop: position.amountOwedToCoop,
                payableToFarmer: position.amountPayable,
                amountOwedByFarmer: position.amountOwedToCoop,
                totalPayable: position.amountPayable,
                generationMismatch: true,
                generationDifference: diff,
                notes:
                  `Wallet mismatch: Farmer.currentBalance=${farmerCurrentBalance}, ` +
                  `liveLedgerBalance=${liveLedgerBalance}, diff=${diff}. ` +
                  `Period closing (audit)=${position.closingBalance}. ` +
                  `Reconcile farmer counter to ledger before settle.`,
              },
            },
          },
        });
        continue;
      }

      // ── Period position (the month being settled) ───────────
      // amountPayable = max(periodClosing, 0)  — money coop may pay for THAT month
      // amountOwedToCoop = max(-periodClosing, 0) — debt; NEVER cleared by settlement
      const amountPayable = position.amountPayable;
      const amountOwedToCoop = position.amountOwedToCoop;

      // ── Negative balance stays ─────────────────────────────
      // Debt to cooperative is not paid out and not zeroed.
      // If wallet is already ≤ 0, there is nothing to pay.
      let payout = 0;
      if (amountPayable > 0 && farmerCurrentBalance > 0) {
        // Pay last month's positive payable, but never more than live wallet
        // so we do not invent extra debt just to "force" period math.
        payout = round2(Math.min(amountPayable, farmerCurrentBalance));
      }

      // Wallet after settle = live balance − payout only.
      // This month's collections already on the wallet are preserved.
      // Example: settle Sept on Oct 16 → Oct 1–16 milk remains in the balance.
      const balanceAfterSettlement = round2(farmerCurrentBalance - payout);

      let ledgerEntryId = null;

      if (payout > 0) {
        const idempotencyKey = `SETTLEMENT:${coopId}:${settlement._id}`;
        const { doc: ledgerDoc, wasAlreadyDone } = await insertLedgerIdempotent(
          {
            cooperativeId: coopId,
            farmerId: settlement.farmerId,
            settlementId: settlement._id,
            batchId: lockedBatch._id,
            type: 'SETTLEMENT',
            amount: -payout,
            runningBalance: balanceAfterSettlement,
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
              payout,
              farmerCurrentBalanceBefore: farmerCurrentBalance,
              balanceAfterSettlement,
              note:
                'Payout clears period positive payable only; does not clear debt; ' +
                'does not wipe later-month activity already on the wallet',
            },
            timestamp: new Date(),
            idempotencyKey,
          },
          session
        );

        if (!wasAlreadyDone) {
          const updated = await updateFarmerBalance(
            settlement.farmerId,
            balanceAfterSettlement,
            ledgerDoc._id,
            session,
            {
              currentBalance: farmerCurrentBalance,
              cooperativeId: coopId,
            }
          );

          if (!updated) {
            throw new Error(
              `Farmer balance changed concurrently during settlement: ${settlement.farmerId}`
            );
          }
        }
        ledgerEntryId = ledgerDoc._id;
      }
      // payout === 0: debt or zero — no SETTLEMENT row; negative stays negative

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
              generationMismatch: false,
              generationDifference: 0,
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
            $sum: {
              $cond: [
                { $eq: ['$status', 'SETTLED'] },
                { $ifNull: ['$amountPayable', '$payableToFarmer'] },
                0,
              ],
            },
          },
          totalOwedByFarmers: {
            $sum: {
              $cond: [
                { $eq: ['$status', 'SETTLED'] },
                { $ifNull: ['$amountOwedToCoop', '$amountOwedByFarmer'] },
                0,
              ],
            },
          },
          settled: {
            $sum: { $cond: [{ $eq: ['$status', 'SETTLED'] }, 1, 0] },
          },
          mismatched: {
            $sum: { $cond: [{ $eq: ['$status', 'MISMATCH'] }, 1, 0] },
          },
          total: { $sum: 1 },
        },
      },
    ]).session(session);

    const totals = agg[0] || {
      totalPayableToFarmers: 0,
      totalOwedByFarmers: 0,
      settled: 0,
      mismatched: 0,
      total: 0,
    };

    lockedBatch.totalSettledFarmers = totals.settled;
    lockedBatch.totalMismatchedFarmers = totals.mismatched;
    lockedBatch.totalPayableToFarmers = round2(totals.totalPayableToFarmers || 0);
    lockedBatch.totalOwedByFarmers = round2(totals.totalOwedByFarmers || 0);
    lockedBatch.totalPayable = lockedBatch.totalPayableToFarmers;

    if (totals.mismatched > 0) {
      lockedBatch.status = 'PARTIALLY_SETTLED';
    } else if (totals.settled === totals.total && totals.total > 0) {
      lockedBatch.status = 'SETTLED';
      lockedBatch.settledBy = userId;
      lockedBatch.settledAt = new Date();
    } else {
      lockedBatch.status = 'PARTIALLY_SETTLED';
    }

    await lockedBatch.save({ session });

    await createAuditLog(
      userId,
      'SETTLEMENT_BATCH_SETTLED',
      {
        batchId: lockedBatch._id,
        cooperativeId: coopId,
        settledCount,
        mismatchCount,
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
      mismatchCount,
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
      payment = await Payment.findOne({ cooperativeId: coopId, idempotencyKey });
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
  const payment = await Payment.findOne({ _id: paymentId, cooperativeId: coopId });
  if (!payment) throw new Error('Payment not found');
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


// ─── Override flow (MISMATCH reconciliation) ─────────────────
//
// Settlement purpose:
//   Clear last month's amountPayable from the farmer wallet via a SETTLEMENT
//   ledger debit, so the next month's opening does not still "owe" that money
//   as if it were unpaid activity.
//
// Override is only for rows stuck in MISMATCH (farmer.currentBalance ≠ ledger).

const requestSettlementOverride = async (
  settlementId,
  userId,
  reason,
  cooperativeId,
  ip = null
) => {
  const coopId = requireCooperativeId(cooperativeId);
  if (!reason || !String(reason).trim()) {
    throw new Error('Override reason is required');
  }

  const settlement = await Settlement.findOne({
    _id: settlementId,
    cooperativeId: coopId,
  });
  if (!settlement) throw new Error('Settlement not found');
  if (!['MISMATCH', 'GENERATED'].includes(settlement.status)) {
    throw new Error(
      `Settlement is ${settlement.status}; override can only be requested from MISMATCH or GENERATED`
    );
  }

  const farmer = await Farmer.findOne({
    _id: settlement.farmerId,
    cooperativeId: coopId,
  })
    .select('currentBalance name farmer_code')
    .lean();
  if (!farmer) throw new Error('Farmer not found');

  const { position } = await recomputeFarmerPeriodPosition(
    coopId,
    settlement.farmerId,
    settlement.periodStart,
    settlement.nextPeriodStart
  );

  const expectedBalance = round2(position.closingBalance);
  const actualBalance = round2(farmer.currentBalance || 0);
  const difference = round2(expectedBalance - actualBalance);

  settlement.status = 'OVERRIDE_REQUESTED';
  settlement.overrideRequest = {
    requestedBy: userId,
    requestedAt: new Date(),
    reason: String(reason).trim(),
    expectedBalance,
    actualBalance,
    difference,
    status: 'PENDING',
  };
  await settlement.save();

  await createAuditLog(
    userId,
    'SETTLEMENT_OVERRIDE_REQUESTED',
    {
      settlementId: settlement._id,
      cooperativeId: coopId,
      reason: String(reason).trim(),
      expectedBalance,
      actualBalance,
      difference,
    },
    ip,
    null
  );

  return {
    settlement,
    expectedBalance,
    actualBalance,
    difference,
  };
};

const approveSettlementOverride = async (
  settlementId,
  userId,
  resolutionType,
  manualAmount,
  notes,
  cooperativeId,
  ip = null
) => {
  const coopId = requireCooperativeId(cooperativeId);
  const allowed = ['ACCEPT_ACTUAL', 'KEEP_ORIGINAL', 'MANUAL_AMOUNT'];
  if (!allowed.includes(resolutionType)) {
    throw new Error(
      `resolutionType must be one of: ${allowed.join(', ')}`
    );
  }

  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);

  try {
    const settlement = await Settlement.findOne({
      _id: settlementId,
      cooperativeId: coopId,
    }).session(session);
    if (!settlement) throw new Error('Settlement not found');
    if (settlement.status !== 'OVERRIDE_REQUESTED') {
      throw new Error(
        `Settlement is ${settlement.status}; must be OVERRIDE_REQUESTED to approve`
      );
    }
    if (!settlement.overrideRequest || settlement.overrideRequest.status !== 'PENDING') {
      throw new Error('No pending override request on this settlement');
    }

    // Prefer dual-control: approver ≠ requester when both known
    if (
      settlement.overrideRequest.requestedBy &&
      String(settlement.overrideRequest.requestedBy) === String(userId)
    ) {
      throw new Error('Approver must be a different user from the override requester');
    }

    const { period, position } = await recomputeFarmerPeriodPosition(
      coopId,
      settlement.farmerId,
      settlement.periodStart,
      settlement.nextPeriodStart,
      session
    );

    let resolutionAmount;
    if (resolutionType === 'ACCEPT_ACTUAL') {
      // Pay what ledger says is payable now
      resolutionAmount = position.amountPayable;
    } else if (resolutionType === 'KEEP_ORIGINAL') {
      resolutionAmount = round2(
        settlement.amountPayable ??
          settlement.totalPayable ??
          settlement.payableToFarmer ??
          0
      );
    } else {
      // MANUAL_AMOUNT
      const n = Number(manualAmount);
      if (!Number.isFinite(n) || n < 0) {
        throw new Error('manualAmount must be a non-negative number');
      }
      resolutionAmount = round2(n);
    }

    const farmer = await Farmer.findOne({
      _id: settlement.farmerId,
      cooperativeId: coopId,
    })
      .select('_id currentBalance lastLedgerId')
      .session(session);
    if (!farmer) throw new Error('Farmer not found');

    const farmerCurrentBalance = round2(farmer.currentBalance || 0);

    // Negative balance = debt to cooperative: never pay out, debt stays.
    let payout = 0;
    if (resolutionAmount > 0 && farmerCurrentBalance > 0) {
      payout = round2(Math.min(resolutionAmount, farmerCurrentBalance));
    }
    // Wallet after = live − payout only (preserves later activity; does not zero debt)
    const balanceAfterSettlement = round2(farmerCurrentBalance - payout);

    let ledgerEntryId = null;
    if (payout > 0) {
      resolutionAmount = payout; // record what was actually paid
      const idempotencyKey = `SETTLEMENT_OVERRIDE:${coopId}:${settlement._id}`;
      const { doc: ledgerDoc, wasAlreadyDone } = await insertLedgerIdempotent(
        {
          cooperativeId: coopId,
          farmerId: settlement.farmerId,
          settlementId: settlement._id,
          batchId: settlement.batchId,
          type: 'SETTLEMENT',
          amount: -resolutionAmount,
          runningBalance: balanceAfterSettlement,
          description: `Settlement override payout ${settlement.settlementNumber} (${resolutionType})`,
          reference: settlement.settlementNumber,
          createdBy: userId,
          metadata: {
            year: settlement.year,
            month: settlement.month,
            resolutionType,
            resolutionAmount,
            openingBalance: position.openingBalance,
            periodNet: position.periodNet,
            closingBalance: position.closingBalance,
            override: true,
            notes: notes || '',
          },
          timestamp: new Date(),
          idempotencyKey,
        },
        session
      );

      if (!wasAlreadyDone) {
        const updated = await updateFarmerBalance(
          settlement.farmerId,
          balanceAfterSettlement,
          ledgerDoc._id,
          session,
          {
            currentBalance: farmerCurrentBalance,
            cooperativeId: coopId,
          }
        );
        if (!updated) {
          throw new Error(
            `Farmer balance changed concurrently during override: ${settlement.farmerId}`
          );
        }
      }
      ledgerEntryId = ledgerDoc._id;
    }

    settlement.status = 'SETTLED';
    settlement.settledBy = userId;
    settlement.settledAt = new Date();
    settlement.ledgerEntryId = ledgerEntryId;
    settlement.amountPayable = resolutionAmount;
    settlement.totalPayable = resolutionAmount;
    settlement.payableToFarmer = resolutionAmount;
    settlement.openingBalance = position.openingBalance;
    settlement.periodNet = position.periodNet;
    settlement.netPayable = position.periodNet;
    settlement.closingBalance = position.closingBalance;
    settlement.amountOwedToCoop = position.amountOwedToCoop;
    settlement.amountOwedByFarmer = position.amountOwedToCoop;
    settlement.closingOutstandingBalance = position.amountOwedToCoop;
    settlement.grossMilkLitres = period.grossMilkLitres;
    settlement.grossMilkEarnings = period.grossMilkEarnings;
    settlement.totalDeductions = period.totalDeductions;
    settlement.bonuses = period.bonuses;
    settlement.adjustments = period.adjustments;
    settlement.generationMismatch = false;
    settlement.generationDifference = 0;

    settlement.overrideRequest = {
      ...settlement.overrideRequest.toObject?.() ?? settlement.overrideRequest,
      status: 'APPROVED',
      approvedBy: userId,
      approvedAt: new Date(),
      resolutionType,
      resolutionAmount,
      resolutionNotes: notes ? String(notes).trim() : '',
    };

    await settlement.save({ session });

    await createAuditLog(
      userId,
      'SETTLEMENT_OVERRIDE_APPROVED',
      {
        settlementId: settlement._id,
        cooperativeId: coopId,
        resolutionType,
        resolutionAmount,
        notes: notes || '',
      },
      ip,
      session
    );

    await session.commitTransaction();
    session.endSession();
    return { settlement, resolutionAmount, resolutionType };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const rejectSettlementOverride = async (
  settlementId,
  userId,
  notes,
  cooperativeId,
  ip = null
) => {
  const coopId = requireCooperativeId(cooperativeId);
  const settlement = await Settlement.findOne({
    _id: settlementId,
    cooperativeId: coopId,
  });
  if (!settlement) throw new Error('Settlement not found');
  if (settlement.status !== 'OVERRIDE_REQUESTED') {
    throw new Error(
      `Settlement is ${settlement.status}; can only reject a pending OVERRIDE_REQUESTED`
    );
  }

  settlement.status = 'MISMATCH';
  if (settlement.overrideRequest) {
    settlement.overrideRequest.status = 'REJECTED';
    settlement.overrideRequest.approvedBy = userId;
    settlement.overrideRequest.approvedAt = new Date();
    settlement.overrideRequest.resolutionNotes = notes
      ? String(notes).trim()
      : 'Rejected';
  }
  await settlement.save();

  await createAuditLog(
    userId,
    'SETTLEMENT_OVERRIDE_REJECTED',
    {
      settlementId: settlement._id,
      cooperativeId: coopId,
      notes: notes || '',
    },
    ip,
    null
  );

  return { settlement };
};

const getPendingOverrides = async (cooperativeId, query = {}) => {
  const coopId = requireCooperativeId(cooperativeId);
  const page = parseInt(query.page, 10) || 1;
  const limit = parseInt(query.limit, 10) || 20;
  const skip = (page - 1) * limit;

  const filter = {
    cooperativeId: coopId,
    status: 'OVERRIDE_REQUESTED',
    'overrideRequest.status': 'PENDING',
  };

  const [items, total] = await Promise.all([
    Settlement.find(filter)
      .populate('farmerId', 'name farmer_code phone')
      .populate('overrideRequest.requestedBy', 'name')
      .sort({ 'overrideRequest.requestedAt': -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Settlement.countDocuments(filter),
  ]);

  return {
    overrides: items,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit) || 0,
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

  requestSettlementOverride,
  approveSettlementOverride,
  rejectSettlementOverride,
  getPendingOverrides,

  getBatch,
  getBatchSettlements,
  getFarmerSettlements,
  getBatches,
};