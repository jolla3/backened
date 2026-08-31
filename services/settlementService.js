// services/settlementService.js
//
// Accounting model:
//   periodNet        = ledger activity in [periodStart, nextPeriodStart) only
//   openingBalance   = ledger runningBalance strictly before periodStart
//   closingBalance   = openingBalance + periodNet
//   amountPayable    = max(closingBalance, 0)   // only this may be paid
//   amountOwedToCoop = max(-closingBalance, 0)  // debt; never paid; never zeroed by settle
//
// Farmer.currentBalance is a live counter — never the definition of a month.
// Settlement posts SETTLEMENT only for amountPayable > 0.
// Payment is separate and only allowed when amountPayable > 0.
//
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

const LOCKED_BATCH_STATUSES = ['SETTLING', 'PARTIALLY_SETTLED', 'SETTLED', 'CLOSED'];
const MAX_POST_GENERATION_ENTRIES = 50;

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

// ─── Period lock (call from every ledger writer) ─────────────
const assertPeriodOpen = async (cooperativeId, timestamp, session = null) => {
  const ts = timestamp instanceof Date ? timestamp : new Date(timestamp);
  const year = ts.getUTCFullYear();
  const month = ts.getUTCMonth() + 1;
  let query = SettlementBatch.findOne({
    cooperativeId,
    year,
    month,
    status: { $in: LOCKED_BATCH_STATUSES },
  });
  if (session) query = query.session(session);
  const lockedBatch = await query;
  if (lockedBatch) {
    throw new PeriodLockedError(
      `Accounting period ${year}-${String(month).padStart(2, '0')} is ${lockedBatch.status} and locked.`
    );
  }
  return true;
};

const incrementFarmerBalance = async (farmerId, cooperativeId, amount, ledgerId, session) => {
  const updated = await Farmer.findOneAndUpdate(
    { _id: farmerId, cooperativeId },
    {
      $inc: { currentBalance: amount },
      $set: { lastLedgerId: ledgerId, balanceUpdatedAt: new Date() },
    },
    { returnDocument: 'after', session }
  );
  if (!updated) {
    throw new Error(`Farmer ${farmerId} not found in cooperative ${cooperativeId}`);
  }
  return round2(updated.currentBalance);
};

const getBalanceBefore = async (cooperativeId, farmerId, beforeTimestamp, session) => {
  let query = Ledger.find({
    cooperativeId,
    farmerId,
    timestamp: { $lt: beforeTimestamp },
  })
    .sort({ timestamp: -1, _id: -1 })
    .limit(1);
  if (session) query = query.session(session);
  const [row] = await query;
  return row ? round2(row.runningBalance) : 0;
};

/** Period activity only — never uses Farmer.currentBalance */
const loadPeriodTotalsByFarmer = async (cooperativeId, farmerIds, periodStart, nextPeriodStart, session) => {
  const perTypeAgg = await Ledger.aggregate([
    {
      $match: {
        cooperativeId,
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
  const byFarmer = await loadPeriodTotalsByFarmer(
    cooperativeId,
    [farmerId],
    periodStart,
    nextPeriodStart,
    session
  );
  const types = byFarmer.get(farmerId.toString()) || {};
  const period = computePeriodSettlement(types);
  const openingBalance = await getBalanceBefore(cooperativeId, farmerId, periodStart, session);
  const position = computeSettlementPosition(openingBalance, period.periodNet);
  return { period, position };
};

const getOrCreateBatch = async (cooperativeId, year, month, bounds, userId, session) => {
  return SettlementBatch.findOneAndUpdate(
    { cooperativeId, year, month },
    {
      $setOnInsert: {
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

const reserveSettlementNumbers = async (cooperativeId, year, month, count, session) => {
  if (count <= 0) return [];
  const key = `${cooperativeId.toString()}-${year}-${month}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { sequence: count } },
    { upsert: true, returnDocument: 'after', session }
  );
  const start = counter.sequence - count + 1;
  const yearShort = String(year).slice(2);
  const monthStr = String(month).padStart(2, '0');
  const numbers = [];
  for (let i = 0; i < count; i++) {
    numbers.push(`SET-${yearShort}${monthStr}-${String(start + i).padStart(4, '0')}`);
  }
  return numbers;
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

// ─── Generate ────────────────────────────────────────────────
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
      const settlements = await Settlement.find({ batchId: existingBatch._id }).session(session);
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
      { _id: existingBatch._id, status: 'GENERATING', generationLockedAt: null },
      { $set: { generationLockedAt: new Date(), generationLockedBy: userId } },
      { returnDocument: 'after', session }
    );
    if (!batch) {
      throw new Error(`Settlement generation for ${year}-${month} is already in progress`);
    }

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

      // Opening = ledger before periodStart only (not currentBalance)
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
        // payout obligation only (>= 0)
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

    const numbers = await reserveSettlementNumbers(coopId, year, month, docs.length, session);
    docs.forEach((doc, idx) => {
      doc.settlementNumber = numbers[idx];
    });

    let settlements = [];
    if (docs.length) {
      settlements = await Settlement.insertMany(docs, { session, ordered: true });
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
    return {
      success: true,
      batch,
      settlements,
      count: settlements.length,
      summary,
    };
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    logger.error('Generate settlements error', { error: error.message, stack: error.stack });
    throw error;
  }
};

// ─── Approve (admin only — no farmer step) ───────────────────
const approveBatch = async (batchId, userId, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (cooperativeId && String(batch.cooperativeId) !== String(cooperativeId)) {
      throw new Error('Batch does not belong to this cooperative');
    }
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
        cooperativeId: batch.cooperativeId,
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
// Recomputes each farmer from ledger period bounds (not currentBalance).
// Posts SETTLEMENT only for amountPayable > 0. Never zeroes debt.
const settleBatch = async (batchId, userId, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);

  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (cooperativeId && String(batch.cooperativeId) !== String(cooperativeId)) {
      throw new Error('Batch does not belong to this cooperative');
    }

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

    const pending = await Settlement.find({
      batchId: batch._id,
      status: { $in: ['GENERATED', 'MISMATCH'] },
    }).session(session);

    const settledOps = [];
    let settledCount = 0;

    for (const settlement of pending) {
      const { period, position } = await recomputeFarmerPeriodPosition(
        settlement.cooperativeId,
        settlement.farmerId,
        settlement.periodStart,
        settlement.nextPeriodStart,
        session
      );

      const amountPayable = position.amountPayable;
      const amountOwedToCoop = position.amountOwedToCoop;

      let ledgerEntryId = null;

      if (amountPayable > 0) {
        const idempotencyKey = `SETTLEMENT:${settlement._id}`;
        const { doc: ledgerDoc, wasAlreadyDone } = await insertLedgerIdempotent(
          {
            cooperativeId: settlement.cooperativeId,
            farmerId: settlement.farmerId,
            settlementId: settlement._id,
            batchId: batch._id,
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
            settlement.cooperativeId,
            -amountPayable,
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
      // amountPayable === 0: no ledger entry; debt remains on account

      settledOps.push({
        updateOne: {
          filter: { _id: settlement._id },
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
      { $match: { batchId: batch._id } },
      {
        $group: {
          _id: null,
          totalPayableToFarmers: { $sum: { $ifNull: ['$amountPayable', '$payableToFarmer'] } },
          totalOwedByFarmers: { $sum: { $ifNull: ['$amountOwedToCoop', '$amountOwedByFarmer'] } },
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
const closeBatch = async (batchId, userId, cooperativeId = null, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction(TX_OPTS);
  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (cooperativeId && String(batch.cooperativeId) !== String(cooperativeId)) {
      throw new Error('Batch does not belong to this cooperative');
    }
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
        cooperativeId: batch.cooperativeId,
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

// ─── Payment (physical money only) ───────────────────────────
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
      amount: newAmount,
      totalPaidNow,
      amountPayable: payable,
    },
    ip,
    null
  );

  return { success: true, payment, settlement };
};

const confirmPayment = async (paymentId, userId, externalReference, cooperativeId = null, ip = null) => {
  const payment = await Payment.findById(paymentId);
  if (!payment) throw new Error('Payment not found');
  if (cooperativeId && String(payment.cooperativeId) !== String(cooperativeId)) {
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
      amount: payment.amount,
      externalReference,
    },
    ip,
    null
  );

  return { success: true, payment };
};

// ─── Reads ───────────────────────────────────────────────────
const getBatch = async (batchId, cooperativeId = null) => {
  const filter = cooperativeId ? { _id: batchId, cooperativeId } : { _id: batchId };
  const batch = await SettlementBatch.findOne(filter)
    .populate('generatedBy', 'name')
    .populate('approvedBy', 'name')
    .populate('settledBy', 'name')
    .populate('closedBy', 'name')
    .lean();
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
  const filter = { cooperativeId, farmerId };
  if (status) filter.status = status;
  return Settlement.find(filter)
    .populate('settledBy', 'name')
    .sort({ periodStart: -1 })
    .limit(parseInt(limit, 10))
    .lean();
};

const getBatches = async (cooperativeId, query = {}) => {
  const { page = 1, limit = 20, status } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;
  const filter = { cooperativeId };
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