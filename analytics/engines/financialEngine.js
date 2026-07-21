// analytics/engines/financialEngine.js
const { safeNumber } = require('../utils/formatters');

const computeFinancial = (context) => {
  const {
    milkTransactions,
    feedTransactions,
    ledgerEntries,
    farmerBalances,
    activeRate,
    thirtyDaysAgo,
  } = context;

  // Month milk (operational – what was recorded)
  const monthMilk = context.monthMilk || milkTransactions.filter(t => t.timestamp_server >= thirtyDaysAgo);
  const monthMilkLitres = monthMilk.reduce((s, t) => s + (t.litres || 0), 0);
  const grossMilkValue = monthMilk.reduce((s, t) => s + (t.payout || 0), 0); // sum of transaction payouts – operational

  // Month feed
  const monthFeed = context.monthFeed || feedTransactions.filter(t => t.timestamp_server >= thirtyDaysAgo);
  const feedRevenue = monthFeed.reduce((s, t) => s + (t.cost || 0), 0);
  const feedRevenueCash = monthFeed.filter(t => t.paymentMethod === 'cash').reduce((s, t) => s + (t.cost || 0), 0);
  const feedRevenueBalance = monthFeed.filter(t => t.paymentMethod === 'balance').reduce((s, t) => s + (t.cost || 0), 0);
  const feedQuantity = monthFeed.reduce((s, t) => s + (t.quantity || 0), 0);

  // Ledger credits (financial truth – what is actually owed)
  const milkCredits = ledgerEntries
    .filter(e => e.type === 'MILK_CREDIT' && e.timestamp >= thirtyDaysAgo)
    .reduce((s, e) => s + e.amount, 0);

  const feedDebits = ledgerEntries
    .filter(e => e.type === 'FEED_DEBIT' && e.timestamp >= thirtyDaysAgo)
    .reduce((s, e) => s + Math.abs(e.amount), 0);

  // Current balances (from ledger runningBalance)
  let amountToPayFarmers = 0;
  let amountFarmersOweCoop = 0;
  let farmersToPay = 0;
  let farmersOwingCoop = 0;
  let farmersWithZero = 0;
  let totalBalanceSum = 0;
  let balanceCount = 0;

  for (const balance of farmerBalances.values()) {
    totalBalanceSum += balance;
    balanceCount++;
    if (balance > 0) {
      amountToPayFarmers += balance;
      farmersToPay++;
    } else if (balance < 0) {
      amountFarmersOweCoop += Math.abs(balance);
      farmersOwingCoop++;
    } else {
      farmersWithZero++;
    }
  }

  const avgFarmerBalance = balanceCount > 0 ? totalBalanceSum / balanceCount : 0;
  const avgPricePerLiter = monthMilkLitres > 0 ? milkCredits / monthMilkLitres : 0;

  return {
    // Operational
    monthMilkLitres,              // renamed from milkLitres
    grossMilkValue,               // renamed from milkCollectionValue
    milkCredits,                  // ledger truth
    feedRevenue,
    feedRevenueCash,
    feedRevenueBalance,
    feedQuantity,
    feedDebits,

    // Current balances
    amountToPayFarmers,
    amountFarmersOweCoop,
    farmersToPay,
    farmersOwingCoop,
    farmersWithZero,
    avgFarmerBalance,
    avgPricePerLiter: parseFloat(avgPricePerLiter.toFixed(2)),
    activeRate,

    hasRealData: monthMilkLitres > 0 || feedRevenue > 0,
  };
};

module.exports = { computeFinancial };