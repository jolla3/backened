const mongoose = require('mongoose');
const Settlement = require('../../models/settlement');

const fetchSettlementData = async (year, month, cooperativeId) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  const coopId = new mongoose.Types.ObjectId(cooperativeId);

  const settlements = await Settlement.find({
    cooperativeId: coopId,
    periodStart: { $gte: startDate, $lte: endDate }
  }).lean();

  return { settlements };
};

const buildSettlement = (data) => {
  const { settlements } = data;

  const summary = {
    totalCount: settlements.length,
    pendingCount: settlements.filter(s => s.status === 'pending').length,
    paidCount: settlements.filter(s => s.status === 'paid').length,
    cancelledCount: settlements.filter(s => s.status === 'cancelled').length,
    totalGross: settlements.reduce((sum, s) => sum + s.grossMilkEarnings, 0),
    totalFeedDeductions: settlements.reduce((sum, s) => sum + s.feedDeductions, 0),
    totalOtherDeductions: settlements.reduce((sum, s) => sum + s.otherDeductions, 0),
    totalBonuses: settlements.reduce((sum, s) => sum + s.bonuses, 0),
    totalNetPayable: settlements.reduce((sum, s) => sum + s.netPayable, 0),
    totalPaid: settlements.reduce((sum, s) => sum + s.amountPaid, 0),
    totalPendingAmount: settlements
      .filter(s => s.status === 'pending')
      .reduce((sum, s) => sum + (s.netPayable - s.amountPaid), 0)
  };

  return { summary, details: settlements };
};

module.exports = { fetchSettlementData, buildSettlement };