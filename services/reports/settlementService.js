const mongoose = require('mongoose');
const Settlement = require('../../models/settlement');
const { getPeriodBounds } = require('../settlementMath');

const OPEN_STATUSES = ['GENERATED', 'MISMATCH', 'OVERRIDE_REQUESTED'];
const SETTLED_STATUSES = ['SETTLED'];

const fetchSettlementData = async (year, month, cooperativeId) => {
  const { periodStart, periodEnd, nextPeriodStart } = getPeriodBounds(year, month);
  const coopId = new mongoose.Types.ObjectId(cooperativeId);

  // Match settlements for this calendar period (batch year/month or periodStart)
  const settlements = await Settlement.find({
    cooperativeId: coopId,
    $or: [
      { year: Number(year), month: Number(month) },
      { periodStart: { $gte: periodStart, $lt: nextPeriodStart } },
    ],
  }).lean();

  return { settlements, period: { periodStart, periodEnd, nextPeriodStart, year, month } };
};

const buildSettlement = (data) => {
  const { settlements } = data;

  const sumField = (rows, ...keys) =>
    rows.reduce((sum, s) => {
      for (const k of keys) {
        if (s[k] != null && Number.isFinite(Number(s[k]))) return sum + Number(s[k]);
      }
      return sum;
    }, 0);

  const open = settlements.filter((s) => OPEN_STATUSES.includes(s.status));
  const settled = settlements.filter((s) => SETTLED_STATUSES.includes(s.status));
  const mismatch = settlements.filter((s) => s.status === 'MISMATCH');

  const totalNetPayable = sumField(
    settlements,
    'amountPayable',
    'totalPayable',
    'payableToFarmer',
    'netPayable'
  );
  const totalPaid = settled.reduce((sum, s) => {
    const paid = s.amountPaid != null
      ? Number(s.amountPaid)
      : Number(s.amountPayable ?? s.totalPayable ?? s.payableToFarmer ?? 0);
    return sum + (Number.isFinite(paid) ? paid : 0);
  }, 0);

  const summary = {
    totalCount: settlements.length,
    // Real model statuses (not legacy pending/paid/cancelled)
    pendingCount: open.length,
    paidCount: settled.length,
    mismatchCount: mismatch.length,
    cancelledCount: 0,
    totalGross: sumField(settlements, 'grossMilkEarnings', 'grossEarnings'),
    totalFeedDeductions: sumField(settlements, 'totalDeductions', 'feedDeductions'),
    totalOtherDeductions: sumField(settlements, 'otherDeductions'),
    totalBonuses: sumField(settlements, 'bonuses'),
    totalNetPayable,
    totalPaid,
    totalPendingAmount: sumField(
      open,
      'amountPayable',
      'totalPayable',
      'payableToFarmer',
      'netPayable'
    ),
  };

  return { summary, details: settlements };
};

module.exports = { fetchSettlementData, buildSettlement, OPEN_STATUSES, SETTLED_STATUSES };
