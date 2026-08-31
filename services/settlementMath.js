// services/settlementMath.js
//
// Pure accounting helpers. No mongoose.
//
// Model:
//   periodNet       = activity in [periodStart, nextPeriodStart) only
//   closingBalance  = openingBalance + periodNet
//   amountPayable   = max(closingBalance, 0)   // cooperative may pay this
//   amountOwedToCoop = max(-closingBalance, 0) // farmer debt; never paid out
//
const { DEBIT_TYPES, SIGNED_TYPES } = require('../models/ledgerTypes');

const CENT = 0.01;

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;

const amountsMatch = (a, b) => Math.abs(round2(a) - round2(b)) < CENT;

const money = (n) => {
  const v = round2(Number(n));
  if (!Number.isFinite(v)) {
    throw new Error('Monetary value is not a finite number');
  }
  return v;
};

/** UTC half-open period: [periodStart, nextPeriodStart) */
const getPeriodBounds = (year, month) => {
  const y = Number(year);
  const m = Number(month);
  if (!Number.isInteger(y) || !Number.isInteger(m) || m < 1 || m > 12) {
    throw new Error(`Invalid period year/month: ${year}-${month}`);
  }
  const periodStart = new Date(Date.UTC(y, m - 1, 1, 0, 0, 0, 0));
  const nextPeriodStart = new Date(
    Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 1, 0, 0, 0, 0)
  );
  const periodEnd = new Date(nextPeriodStart.getTime() - 1); // display only
  return { periodStart, periodEnd, nextPeriodStart };
};

/**
 * perTypeTotals: { [ledgerType]: { total, litres? } } for ONE period only.
 * Debit types are assumed stored as negative amounts on the ledger.
 */
const computePeriodSettlement = (perTypeTotals = {}) => {
  const grossMilkLitres = Number(perTypeTotals.MILK_CREDIT?.litres) || 0;
  const grossMilkEarnings = Number(perTypeTotals.MILK_CREDIT?.total) || 0;
  const bonuses = Number(perTypeTotals.BONUS?.total) || 0;

  const adjustments = round2(
    SIGNED_TYPES.reduce((sum, t) => sum + (Number(perTypeTotals[t]?.total) || 0), 0)
  );

  const deductions = [];
  let totalDeductions = 0;
  for (const debitType of DEBIT_TYPES) {
    const amt = Number(perTypeTotals[debitType]?.total) || 0;
    if (amt !== 0) {
      const magnitude = Math.abs(amt);
      totalDeductions = round2(totalDeductions + magnitude);
      deductions.push({
        type: debitType,
        amount: magnitude,
        description: `${debitType.replace(/_/g, ' ')} for the period`,
      });
    }
  }

  const periodNet = round2(grossMilkEarnings + bonuses + adjustments - totalDeductions);
  const hadActivity =
    grossMilkEarnings !== 0 ||
    totalDeductions !== 0 ||
    bonuses !== 0 ||
    adjustments !== 0;

  return {
    grossMilkLitres,
    grossMilkEarnings: round2(grossMilkEarnings),
    bonuses: round2(bonuses),
    adjustments,
    deductions,
    totalDeductions,
    periodNet,
    // aliases for older call sites
    netPayable: periodNet,
    hadActivity,
  };
};

/**
 * Split a closing balance into payable vs debt.
 * NEVER returns a negative amountPayable / payableToFarmer.
 */
const splitPosition = (closingBalance) => {
  const pos = money(closingBalance);
  const amountPayable = pos > 0 ? pos : 0;
  const amountOwedToCoop = pos < 0 ? money(-pos) : 0;
  return {
    closingBalance: pos,
    netPosition: pos, // alias
    amountPayable,
    amountOwedToCoop,
    // aliases used across the codebase
    payableToFarmer: amountPayable,
    amountOwedByFarmer: amountOwedToCoop,
  };
};

/**
 * openingBalance = ledger position strictly before periodStart
 * periodNet      = activity inside the period only
 */
const computeSettlementPosition = (openingBalance, periodNet) => {
  const opening = money(openingBalance);
  const period = money(periodNet);
  const closingBalance = round2(opening + period);
  return {
    openingBalance: opening,
    periodNet: period,
    ...splitPosition(closingBalance),
  };
};

const computeClosingBalances = ({
  payableToFarmer,
  amountOwedByFarmer,
  amountPaidOut,
} = {}) => {
  const paid = money(amountPaidOut || 0);
  const payable = money(payableToFarmer || 0);
  const owed = money(amountOwedByFarmer || 0);
  return {
    closingPayableToFarmer: round2(Math.max(payable - paid, 0)),
    // Debt is not cleared by settlement/payment of “payable”
    closingAmountOwedByFarmer: owed,
  };
};

/**
 * @deprecated Prefer computeSettlementPosition.
 * totalPayable is ONLY the non-negative payout amount (never net position).
 */
const computeTotalPayable = (openingBalance, periodNet) => {
  const r = computeSettlementPosition(openingBalance, periodNet);
  return {
    openingBalance: r.openingBalance,
    netPayable: r.periodNet,
    periodNet: r.periodNet,
    closingBalance: r.closingBalance,
    netPosition: r.closingBalance,
    // CRITICAL: must not be negative
    totalPayable: r.amountPayable,
    amountPayable: r.amountPayable,
    amountOwedToCoop: r.amountOwedToCoop,
    payableToFarmer: r.amountPayable,
    amountOwedByFarmer: r.amountOwedToCoop,
  };
};

/** @deprecated Prefer computeClosingBalances */
const computeClosingOutstandingBalance = (totalPayable, resolutionAmount) =>
  round2(money(totalPayable) - money(resolutionAmount));

module.exports = {
  round2,
  money,
  amountsMatch,
  getPeriodBounds,
  computePeriodSettlement,
  splitPosition,
  computeSettlementPosition,
  computeClosingBalances,
  computeTotalPayable,
  computeClosingOutstandingBalance,
};