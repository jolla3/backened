// services/settlementService.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Settlement = require('../models/settlement');
const SettlementBatch = require('../models/SettlementBatch');
const Counter = require('../models/Counter');
const Cooperative = require('../models/cooperative');
const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────

// Atomic batch creation
const getOrCreateBatch = async (cooperativeId, year, month, periodStart, periodEnd, userId, session) => {
  // cooperativeId is already ObjectId here (passed from generateSettlements)
  const batch = await SettlementBatch.findOneAndUpdate(
    { cooperativeId, year, month },
    {
      $setOnInsert: {
        periodStart,
        periodEnd,
        status: 'GENERATING',
        generatedBy: userId,
        generatedAt: new Date(),
        totalFarmers: 0,
        totalSkippedFarmers: 0,
        totalGrossMilkLitres: 0,
        totalGrossMilkEarnings: 0,
        totalDeductions: 0,
        totalBonuses: 0,
        totalNetPayable: 0,
        averageMilkRate: 0,
        highestSettlement: 0,
        lowestSettlement: 0,
      },
    },
    {
      upsert: true,
      new: true,
      session,
      setDefaultsOnInsert: true,
    }
  );
  return batch;
};

// Reserve settlement number block
const reserveSettlementNumbers = async (cooperativeId, year, month, count, session) => {
  const key = `${cooperativeId.toString()}-${year}-${month}`;
  const counter = await Counter.findOneAndUpdate(
    { _id: key },
    { $inc: { sequence: count } },
    { upsert: true, new: true, session }
  );
  const start = counter.sequence - count + 1;
  const numbers = [];
  const yearShort = String(year).slice(2);
  const monthStr = String(month).padStart(2, '0');
  for (let i = 0; i < count; i++) {
    const seq = String(start + i).padStart(4, '0');
    numbers.push(`SET-${yearShort}${monthStr}-${seq}`);
  }
  return numbers;
};

// Transaction-safe audit log
const createAuditLog = async (userId, action, metadata, ip, session) => {
  if (!AuditLog) return;
  try {
    const log = new AuditLog({
      userId,
      action,
      metadata,
      ipAddress: ip,
      timestamp: new Date(),
    });
    await log.save({ session });
  } catch (e) {
    logger.warn('Audit log failed', { error: e.message });
  }
};

// ─── Generate Settlements (FULLY FIXED) ──────────────────
const generateSettlements = async (cooperativeId, periodStart, periodEnd, userId, ip = null) => {
  let session;
  try {
    session = await mongoose.startSession();
    session.startTransaction();

    // 🔥 CRITICAL FIX: Convert string cooperativeId to ObjectId
    const coopId = new mongoose.Types.ObjectId(cooperativeId);

    const cooperative = await Cooperative.findById(coopId).session(session);
    if (!cooperative) throw new Error('Cooperative not found');

    const year = periodStart.getFullYear();
    const month = periodStart.getMonth() + 1;

    // 1. Create/load batch using ObjectId
    const batch = await getOrCreateBatch(coopId, year, month, periodStart, periodEnd, userId, session);
    if (batch.status !== 'GENERATING' && batch.status !== 'GENERATED') {
      throw new Error(`Settlements for ${year}-${month} are already ${batch.status}`);
    }
    if (batch.status === 'GENERATED') {
      const settlements = await Settlement.find({ batchId: batch._id }).session(session);
      await session.commitTransaction();
      session.endSession();
      return { success: true, batch, settlements, count: settlements.length };
    }

    // 2. Get active farmers for this cooperative
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

    const farmerIds = farmers.map(f => f._id);

    // 3. Aggregations – all use coopId (ObjectId)
    const [milkAgg, feedAgg, balanceAgg] = await Promise.all([
      Ledger.aggregate([
        {
          $match: {
            cooperativeId: coopId,
            farmerId: { $in: farmerIds },
            type: 'MILK_CREDIT',
            timestamp: { $gte: periodStart, $lte: periodEnd },
          },
        },
        {
          $group: {
            _id: '$farmerId',
            totalEarnings: { $sum: '$amount' },
            totalLitres: { $sum: '$metadata.litres' },
          },
        },
      ]).session(session),

      Ledger.aggregate([
        {
          $match: {
            cooperativeId: coopId,
            farmerId: { $in: farmerIds },
            type: 'FEED_DEBIT',
            timestamp: { $gte: periodStart, $lte: periodEnd },
          },
        },
        {
          $group: {
            _id: '$farmerId',
            total: { $sum: { $abs: '$amount' } },
          },
        },
      ]).session(session),

      // Running balance at period end
      Ledger.aggregate([
        {
          $match: {
            cooperativeId: coopId,
            farmerId: { $in: farmerIds },
            timestamp: { $lte: periodEnd },
          },
        },
        { $sort: { timestamp: -1 } },
        {
          $group: {
            _id: '$farmerId',
            runningBalance: { $first: '$runningBalance' },
          },
        },
      ]).session(session),
    ]);

    const milkMap = new Map(milkAgg.map(i => [i._id.toString(), { earnings: i.totalEarnings || 0, litres: i.totalLitres || 0 }]));
    const feedMap = new Map(feedAgg.map(i => [i._id.toString(), i.total || 0]));
    const balanceMap = new Map(balanceAgg.map(i => [i._id.toString(), i.runningBalance || 0]));

    // 4. Build settlement documents
    const docs = [];
    let summary = {
      totalGrossMilkLitres: 0,
      totalGrossMilkEarnings: 0,
      totalDeductions: 0,
      totalBonuses: 0,
      totalNetPayable: 0,
      highest: 0,
      lowest: Infinity,
      totalSkipped: 0,
    };

    for (const farmer of farmers) {
      const idStr = farmer._id.toString();
      const milk = milkMap.get(idStr) || { earnings: 0, litres: 0 };
      const feed = feedMap.get(idStr) || 0;
      const grossMilkLitres = milk.litres;
      const grossMilkEarnings = milk.earnings;
      const totalDeductions = feed;
      const bonuses = 0;
      const netPayable = grossMilkEarnings - totalDeductions + bonuses;

      // Skip farmers with zero activity
      if (grossMilkEarnings === 0 && totalDeductions === 0) {
        summary.totalSkipped += 1;
        continue;
      }

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
        year,
        month,
        grossMilkLitres,
        grossMilkEarnings,
        deductions: feed > 0 ? [{ type: 'FEED', amount: feed, description: 'Feed purchases' }] : [],
        totalDeductions,
        bonuses,
        netPayable,
        status: 'GENERATED',
        generatedBy: userId,
        notes: `Settlement for ${periodStart.toISOString().slice(0,10)} to ${periodEnd.toISOString().slice(0,10)}`,
      });

      summary.totalGrossMilkLitres += grossMilkLitres;
      summary.totalGrossMilkEarnings += grossMilkEarnings;
      summary.totalDeductions += totalDeductions;
      summary.totalBonuses += bonuses;
      summary.totalNetPayable += netPayable;
      if (netPayable > summary.highest) summary.highest = netPayable;
      if (netPayable < summary.lowest) summary.lowest = netPayable;
    }

    // 5. Reserve settlement numbers (atomic block)
    const numbers = await reserveSettlementNumbers(coopId, year, month, docs.length, session);
    docs.forEach((doc, idx) => {
      doc.settlementNumber = numbers[idx];
    });

    // 6. Bulk insert
    let settlements = [];
    if (docs.length) {
      settlements = await Settlement.insertMany(docs, { session, ordered: true });
    }

    // 7. Update batch summary
    batch.status = 'GENERATED';
    batch.totalFarmers = settlements.length;
    batch.totalSkippedFarmers = summary.totalSkipped;
    batch.totalGrossMilkLitres = summary.totalGrossMilkLitres;
    batch.totalGrossMilkEarnings = summary.totalGrossMilkEarnings;
    batch.totalDeductions = summary.totalDeductions;
    batch.totalBonuses = summary.totalBonuses;
    batch.totalNetPayable = summary.totalNetPayable;
    batch.averageMilkRate = summary.totalGrossMilkLitres > 0 ? summary.totalGrossMilkEarnings / summary.totalGrossMilkLitres : 0;
    batch.highestSettlement = summary.highest || 0;
    batch.lowestSettlement = summary.lowest === Infinity ? 0 : summary.lowest;
    batch.generatedAt = new Date();
    await batch.save({ session });

    // 8. Audit log
    await createAuditLog(userId, 'SETTLEMENT_GENERATED', {
      cooperativeId: coopId,
      year,
      month,
      count: settlements.length,
      skipped: summary.totalSkipped,
      summary,
    }, ip, session);

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
    throw error; // Controller will catch and return JSON
  }
};

// ─── Approve Batch ──────────────────────────────────────────
const approveBatch = async (batchId, userId, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (batch.status !== 'GENERATED') {
      throw new Error(`Batch is ${batch.status}, cannot approve`);
    }

    batch.status = 'APPROVED';
    batch.approvedBy = userId;
    batch.approvedAt = new Date();
    await batch.save({ session });

    await createAuditLog(userId, 'SETTLEMENT_BATCH_APPROVED', {
      batchId: batch._id,
      cooperativeId: batch.cooperativeId,
      year: batch.year,
      month: batch.month,
      totalNetPayable: batch.totalNetPayable,
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
const settleBatch = async (batchId, userId, ip = null) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const batch = await SettlementBatch.findById(batchId).session(session);
    if (!batch) throw new Error('Batch not found');
    if (batch.status !== 'GENERATED' && batch.status !== 'APPROVED') {
      throw new Error(`Batch is ${batch.status}, cannot settle`);
    }
    if (batch.status === 'SETTLED' || batch.status === 'PAID' || batch.status === 'CLOSED') {
      throw new Error('Batch already settled');
    }
    if (batch.periodEnd > new Date()) {
      throw new Error('Cannot settle an open accounting period');
    }

    // Lock
    const lockedBatch = await SettlementBatch.findOneAndUpdate(
      { _id: batchId, status: { $in: ['GENERATED', 'APPROVED'] } },
      {
        $set: {
          status: 'SETTLING',
          settlingStartedBy: userId,
          settlingStartedAt: new Date(),
        },
      },
      { new: true, session }
    );
    if (!lockedBatch) throw new Error('Another process is already settling this batch');

    const settlements = await Settlement.find({ batchId: batch._id, status: 'GENERATED' }).session(session);
    if (!settlements.length) {
      lockedBatch.status = 'GENERATED';
      await lockedBatch.save({ session });
      throw new Error('No settlements to settle');
    }

    // Get running balances
    const farmerIds = settlements.map(s => s.farmerId);
    const balanceAgg = await Ledger.aggregate([
      { $match: { cooperativeId: batch.cooperativeId, farmerId: { $in: farmerIds } } },
      { $sort: { timestamp: -1 } },
      { $group: { _id: '$farmerId', runningBalance: { $first: '$runningBalance' } } },
    ]).session(session);
    const balanceMap = new Map(balanceAgg.map(i => [i._id.toString(), i.runningBalance || 0]));

    const ledgerEntries = [];
    const farmerUpdateOps = [];
    const settlementUpdateOps = [];

    for (const settlement of settlements) {
      const idStr = settlement.farmerId.toString();
      const currentBalance = balanceMap.get(idStr) || 0;
      if (currentBalance !== settlement.netPayable) {
        throw new Error(
          `Farmer ${settlement.farmerSnapshot?.code || settlement.farmerId} balance mismatch. Expected ${settlement.netPayable}, found ${currentBalance}`
        );
      }

      ledgerEntries.push({
        cooperativeId: settlement.cooperativeId,
        farmerId: settlement.farmerId,
        settlementId: settlement._id,
        type: 'SETTLEMENT',
        amount: -settlement.netPayable,
        runningBalance: 0,
        description: `Monthly settlement ${settlement.periodStart.toISOString().slice(0,10)} to ${settlement.periodEnd.toISOString().slice(0,10)}`,
        reference: settlement.settlementNumber,
        createdBy: userId,
        metadata: {
          periodStart: settlement.periodStart,
          periodEnd: settlement.periodEnd,
          grossMilk: settlement.grossMilkEarnings,
          grossLitres: settlement.grossMilkLitres,
          totalDeductions: settlement.totalDeductions,
          settlementPeriod: `${settlement.year}-${String(settlement.month).padStart(2, '0')}`,
        },
        timestamp: new Date(),
      });

      farmerUpdateOps.push({
        updateOne: { filter: { _id: settlement.farmerId }, update: { $set: { balance: 0 } } },
      });

      settlementUpdateOps.push({
        updateOne: {
          filter: { _id: settlement._id },
          update: {
            $set: {
              status: 'SETTLED',
              settledBy: userId,
              settledAt: new Date(),
              ledgerEntryId: new mongoose.Types.ObjectId(),
            },
          },
        },
      });
    }

    const ledgerDocs = await Ledger.insertMany(ledgerEntries, { session, ordered: true });
    if (farmerUpdateOps.length) await Farmer.bulkWrite(farmerUpdateOps, { session });

    // Link ledger IDs
    for (let i = 0; i < settlements.length; i++) {
      settlementUpdateOps[i].updateOne.update.$set.ledgerEntryId = ledgerDocs[i]._id;
    }
    if (settlementUpdateOps.length) await Settlement.bulkWrite(settlementUpdateOps, { session });

    lockedBatch.status = 'SETTLED';
    lockedBatch.settledBy = userId;
    lockedBatch.settledAt = new Date();
    await lockedBatch.save({ session });

    await createAuditLog(userId, 'SETTLEMENT_BATCH_SETTLED', {
      batchId: lockedBatch._id,
      cooperativeId: lockedBatch.cooperativeId,
      year: lockedBatch.year,
      month: lockedBatch.month,
      count: settlements.length,
      totalAmount: lockedBatch.totalNetPayable,
    }, ip, session);

    await session.commitTransaction();
    session.endSession();

    return { success: true, batch: lockedBatch, settledCount: settlements.length, ledgerEntries: ledgerDocs };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── Get Batch ─────────────────────────────────────────────
const getBatch = async (batchId) => {
  const batch = await SettlementBatch.findById(batchId)
    .populate('generatedBy', 'name')
    .populate('approvedBy', 'name')
    .populate('settledBy', 'name')
    .lean();
  if (!batch) throw new Error('Batch not found');
  return batch;
};

// ─── Get Batch Settlements ─────────────────────────────────
const getBatchSettlements = async (batchId, query = {}) => {
  const { page = 1, limit = 20, farmerId } = query;
  const pageNumber = parseInt(page, 10);
  const pageSize = parseInt(limit, 10);
  const skip = (pageNumber - 1) * pageSize;
  const filter = { batchId };
  if (farmerId) filter.farmerId = farmerId;

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

  return { settlements, total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) };
};

// ─── Get Farmer Settlements ────────────────────────────────
const getFarmerSettlements = async (farmerId, cooperativeId, limit = 12, status = null) => {
  const filter = { cooperativeId, farmerId };
  if (status) filter.status = status;
  const settlements = await Settlement.find(filter)
    .populate('settledBy', 'name')
    .sort({ periodStart: -1 })
    .limit(parseInt(limit))
    .lean();
  return settlements;
};

// ─── Get Batches (list) ────────────────────────────────────
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
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(pageSize)
      .lean(),
    SettlementBatch.countDocuments(filter),
  ]);

  return { batches, total, page: pageNumber, limit: pageSize, totalPages: Math.ceil(total / pageSize) };
};

module.exports = {
  generateSettlements,
  approveBatch,
  settleBatch,
  getBatch,
  getBatchSettlements,
  getFarmerSettlements,
  getBatches,
};