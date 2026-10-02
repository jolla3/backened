// services/monthlyPaymentService.js
//
// Authoritative monthly payment calculation for Excel exports.
// Source of truth: Ledger
// Accounting model (same as settlementMath / settlementService):
//
//   openingBalance  = sum(ledger.amount) where timestamp < periodStart  (audit only)
//   periodNet       = settleable activity in [periodStart, nextPeriodStart) ONLY
//   closingBalance  = openingBalance + periodNet  (wallet position, audit only)
//
// MONTH ISOLATION (business rule):
//   Monthly report / bank payout must NOT mix prior months into this month.
//   netPayout       = max(periodNet, 0)     ← THIS MONTH only
//   amountOwedToCoop (month) = max(-periodNet, 0)
//
// Wallet carry (opening/closing) is still computed for reconciliation, but is
// NOT used as the bank/SMS monthly payout amount.
//
// Does NOT use Settlement documents as the calculation source.
// Does NOT use farmer.currentBalance as opening (that is live, not historical).
//
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Cooperative = require('../models/cooperative');
const { SETTLEABLE_TYPES } = require('../models/ledgerTypes');
const {
  getPeriodBounds,
  computePeriodSettlement,
  computeSettlementPosition,
  round2,
} = require('./settlementMath');
const logger = require('../utils/logger');

const requireCooperativeId = (cooperativeId) => {
  if (!cooperativeId) throw new Error('cooperativeId is required');
  if (!mongoose.Types.ObjectId.isValid(cooperativeId)) {
    throw new Error('Invalid cooperativeId');
  }
  return new mongoose.Types.ObjectId(cooperativeId);
};

/**
 * Opening wallet position per farmer: sum of ALL ledger amounts
 * with timestamp strictly before periodStart.
 * Matches settlementService.getOpeningBalanceFromAmounts (no type filter).
 */
const loadOpeningBalancesByFarmer = async (cooperativeId, farmerIds, periodStart) => {
  if (!farmerIds.length) return new Map();

  const rows = await Ledger.aggregate([
    {
      $match: {
        cooperativeId,
        farmerId: { $in: farmerIds },
        timestamp: { $lt: periodStart },
      },
    },
    {
      $group: {
        _id: '$farmerId',
        total: { $sum: '$amount' },
      },
    },
  ]);

  const map = new Map();
  for (const row of rows) {
    map.set(row._id.toString(), round2(row.total || 0));
  }
  return map;
};

/**
 * Settleable period activity per farmer (type totals + milk litres).
 * Mirrors settlementService.loadPeriodTotalsByFarmer.
 */
const loadPeriodTotalsByFarmer = async (
  cooperativeId,
  farmerIds,
  periodStart,
  nextPeriodStart
) => {
  if (!farmerIds.length) return new Map();

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
  ]);

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

/**
 * Calculate monthly payment rows for a cooperative.
 *
 * Monthly breakdown (activity): milkLitres, grossEarnings, deductions,
 *   bonuses, adjustments, periodNet  — all THIS MONTH only (Ledger timestamp window)
 * netPayout = max(periodNet, 0)  — month-isolated; does NOT include opening balance
 * openingBalance / closingBalance returned for audit only
 */
const calculateMonthlyPayments = async ({ cooperativeId, year, month }) => {
  const coopId = requireCooperativeId(cooperativeId);
  const y = parseInt(year, 10);
  const m = parseInt(month, 10);
  const bounds = getPeriodBounds(y, m);
  const { periodStart, periodEnd, nextPeriodStart } = bounds;

  const cooperative = await Cooperative.findById(coopId).select('name').lean();
  if (!cooperative) throw new Error('Cooperative not found');

  const farmers = await Farmer.find({ cooperativeId: coopId })
    .select('farmer_code name phone bankName accountNumber isActive')
    .lean();

  const farmerIds = farmers.map((f) => f._id);

  const [openingByFarmer, totalsByFarmer] = await Promise.all([
    loadOpeningBalancesByFarmer(coopId, farmerIds, periodStart),
    loadPeriodTotalsByFarmer(coopId, farmerIds, periodStart, nextPeriodStart),
  ]);

  const rows = [];
  for (const farmer of farmers) {
    const idStr = farmer._id.toString();
    const types = totalsByFarmer.get(idStr) || {};
    const period = computePeriodSettlement(types);
    const openingBalance = openingByFarmer.get(idStr) || 0;

    // Month isolation: only farmers with THIS MONTH ledger activity appear.
    // Prior-month wallet alone must not create a row or a payout.
    if (!period.hadActivity) continue;

    // Wallet position (opening + period) kept for audit / reconciliation only
    const position = computeSettlementPosition(openingBalance, period.periodNet);

    // ── PAYOUT = THIS MONTH ONLY ─────────────────────────────
    // periodNet = grossEarnings + bonuses + adjustments - deductions (period)
    // Never add openingBalance into netPayout (would mix last month in).
    const monthNetPayout = period.periodNet > 0 ? period.periodNet : 0;
    const monthOwedToCoop = period.periodNet < 0 ? round2(-period.periodNet) : 0;

    rows.push({
      farmerId: farmer._id,
      farmerCode: farmer.farmer_code || '',
      farmerName: farmer.name || '',
      phone: farmer.phone || '',

      // ── Monthly activity breakdown (Ledger, this period only) ──
      milkLitres: round2(period.grossMilkLitres),
      grossEarnings: period.grossMilkEarnings,
      deductions: period.totalDeductions,
      bonuses: period.bonuses,
      adjustments: period.adjustments,
      periodNet: period.periodNet,

      // ── Audit: wallet position (not used for bank amount) ──
      openingBalance: position.openingBalance,
      closingBalance: position.closingBalance,

      // ── Bank / report Net Payout = THIS MONTH only ──
      netPayout: monthNetPayout,
      amountOwedToCooperative: monthOwedToCoop,

      bankName: farmer.bankName || '',
      accountNumber: farmer.accountNumber || '',
      isActive: farmer.isActive !== false,
      deductionBreakdown: period.deductions,
    });
  }

  rows.sort((a, b) =>
    String(a.farmerCode).localeCompare(String(b.farmerCode), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );

  const totals = rows.reduce(
    (acc, r) => {
      acc.milkLitres = round2(acc.milkLitres + r.milkLitres);
      acc.grossEarnings = round2(acc.grossEarnings + r.grossEarnings);
      acc.deductions = round2(acc.deductions + r.deductions);
      acc.bonuses = round2(acc.bonuses + r.bonuses);
      acc.adjustments = round2(acc.adjustments + r.adjustments);
      acc.periodNet = round2(acc.periodNet + r.periodNet);
      acc.openingBalance = round2(acc.openingBalance + r.openingBalance);
      acc.closingBalance = round2(acc.closingBalance + r.closingBalance);
      acc.netPayout = round2(acc.netPayout + r.netPayout);
      acc.amountOwedToCooperative = round2(
        acc.amountOwedToCooperative + r.amountOwedToCooperative
      );
      return acc;
    },
    {
      milkLitres: 0,
      grossEarnings: 0,
      deductions: 0,
      bonuses: 0,
      adjustments: 0,
      periodNet: 0,
      openingBalance: 0,
      closingBalance: 0,
      netPayout: 0,
      amountOwedToCooperative: 0,
    }
  );

  logger.info('Monthly payments calculated', {
    cooperativeId: String(coopId),
    year: y,
    month: m,
    farmerCount: rows.length,
    totalPeriodNet: totals.periodNet,
    totalNetPayout: totals.netPayout,
    totalOwedToCoop: totals.amountOwedToCooperative,
  });

  return {
    cooperative: { id: cooperative._id, name: cooperative.name },
    period: {
      year: y,
      month: m,
      periodStart,
      periodEnd,
      nextPeriodStart,
    },
    rows,
    totals,
  };
};

/**
 * Farmers with positive net payout (amountPayable) but missing accountNumber.
 */
const findMissingBankDetails = (paymentResult) => {
  return (paymentResult.rows || [])
    .filter((r) => r.netPayout > 0 && !String(r.accountNumber || '').trim())
    .map((r) => ({
      farmerId: r.farmerId,
      farmerCode: r.farmerCode,
      farmerName: r.farmerName,
      netPayout: r.netPayout,
    }));
};

module.exports = {
  calculateMonthlyPayments,
  findMissingBankDetails,
  loadPeriodTotalsByFarmer,
  loadOpeningBalancesByFarmer,
};