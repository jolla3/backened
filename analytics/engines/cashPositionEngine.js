// analytics/engines/cashPositionEngine.js
const { safeNumber } = require('../utils/formatters');

const computeCashPosition = (context, financial) => {
  const liability = safeNumber(financial.amountToPayFarmers);

  // No cash tracking – return unknown
  return {
    cashTracked: false,
    cashInHand: null,
    expectedCashNeeded: liability,
    shortfall: null,
    status: 'Cash account not configured.',
    explanation: 'Cash position cannot be determined because cash accounts are not configured.',
  };
};

module.exports = { computeCashPosition };