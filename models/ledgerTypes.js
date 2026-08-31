// models/ledgerTypes.js
//
// This is the single source of truth for which ledger entry types exist and
// how they affect a farmer's wallet. Any service that writes to the Ledger
// (milk credit, feed deduction, loans, interest, penalties, manual
// adjustments, bonuses, settlement...) must add new types HERE first.
//
// If a new type is introduced in some other service without being added to
// this file, settlementService will silently exclude it from netPayable —
// exactly the class of bug this file exists to prevent.
//
// OPEN STRUCTURAL ISSUE (not fixed by this file): amount/runningBalance are
// still plain JS numbers. round2() in settlementService keeps this service's
// own writes to two decimal places, but it cannot retroactively make every
// OTHER writer's numbers financial-grade, and float arithmetic can still
// accumulate error across thousands of entries. The durable fix is
// representing money as integer minor-units (cents) or Mongo Decimal128 on
// the Ledger/Settlement/SettlementBatch schemas themselves — a migration
// that has to happen at the schema layer, across every writer, not inside
// one service.

// Types that increase a farmer's wallet, stored with a positive amount.
const CREDIT_TYPES = ['MILK_CREDIT', 'BONUS'];

// Types that decrease a farmer's wallet, stored with a negative amount.
const DEBIT_TYPES = ['FEED_DEBIT', 'LOAN', 'INTEREST', 'PENALTY'];

// Types whose stored sign is trusted as-is (can be positive or negative).
const SIGNED_TYPES = ['MANUAL_ADJUSTMENT'];

// Structural / non-economic types — never counted twice into a settlement's
// netPayable, but still valid ledger rows.
const SETTLEMENT_TYPES = ['SETTLEMENT'];
const OTHER_TYPES = ['FEED_CASH_SALE', 'PAYMENT'];

// A REVERSAL is not "structural" — it economically undoes a settleable entry
// (e.g. an incorrectly posted FEED_DEBIT) and is stored with the sign needed
// to cancel that entry out. If it's excluded from settlement math, the
// original mistake it was meant to correct still gets settled as if the
// reversal never happened. So it's trusted-signed, same as MANUAL_ADJUSTMENT.
const REVERSAL_TYPES = ['REVERSAL'];

const ALL_TYPES = [...CREDIT_TYPES, ...DEBIT_TYPES, ...SIGNED_TYPES, ...REVERSAL_TYPES, ...SETTLEMENT_TYPES, ...OTHER_TYPES];

// Everything a monthly settlement should sum into netPayable.
const SETTLEABLE_TYPES = [...CREDIT_TYPES, ...DEBIT_TYPES, ...SIGNED_TYPES, ...REVERSAL_TYPES];

module.exports = {
  CREDIT_TYPES,
  DEBIT_TYPES,
  SIGNED_TYPES,
  REVERSAL_TYPES,
  SETTLEMENT_TYPES,
  OTHER_TYPES,
  ALL_TYPES,
  SETTLEABLE_TYPES,
};