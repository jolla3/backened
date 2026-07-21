const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Ledger = require('../../models/ledger');
const Settlement = require('../../models/settlement');

const fetchAuditData = async (year, month, cooperativeId) => {
  const startDate = new Date(year, month - 1, 1);
  const endDate = new Date(year, month, 0, 23, 59, 59, 999);
  const coopId = new mongoose.Types.ObjectId(cooperativeId);

  const [txCount, ledgerCount, settlementCount, farmerCount] = await Promise.all([
    Transaction.countDocuments({ cooperativeId: coopId, timestamp_server: { $gte: startDate, $lte: endDate } }),
    Ledger.countDocuments({ cooperativeId: coopId, timestamp: { $gte: startDate, $lte: endDate } }),
    Settlement.countDocuments({ cooperativeId: coopId, periodStart: { $gte: startDate, $lte: endDate } }),
    Farmer.countDocuments({ cooperativeId: coopId, isActive: true })
  ]);

  const exceptions = [];

  // Orphan MILK_CREDIT without transaction
  const orphanMilkCredits = await Ledger.countDocuments({
    cooperativeId: coopId,
    type: 'MILK_CREDIT',
    transactionId: { $exists: false }
  });
  if (orphanMilkCredits > 0) {
    exceptions.push({
      type: 'milk_credit_orphan',
      count: orphanMilkCredits,
      details: 'MILK_CREDIT ledger entries without transaction reference'
    });
  }

  // Orphan SETTLEMENT_DEBIT without settlement
  const orphanSettlementDebits = await Ledger.countDocuments({
    cooperativeId: coopId,
    type: 'SETTLEMENT_DEBIT',
    settlementId: { $exists: false }
  });
  if (orphanSettlementDebits > 0) {
    exceptions.push({
      type: 'settlement_debit_orphan',
      count: orphanSettlementDebits,
      details: 'SETTLEMENT_DEBIT ledger entries without settlement reference'
    });
  }

  // Orphan FEED_DEBIT without transaction
  const orphanFeedDebits = await Ledger.countDocuments({
    cooperativeId: coopId,
    type: 'FEED_DEBIT',
    transactionId: { $exists: false }
  });
  if (orphanFeedDebits > 0) {
    exceptions.push({
      type: 'feed_debit_orphan',
      count: orphanFeedDebits,
      details: 'FEED_DEBIT ledger entries without transaction reference'
    });
  }

  // Orphan FEED_CASH_SALE without transaction
  const orphanFeedCashSales = await Ledger.countDocuments({
    cooperativeId: coopId,
    type: 'FEED_CASH_SALE',
    transactionId: { $exists: false }
  });
  if (orphanFeedCashSales > 0) {
    exceptions.push({
      type: 'feed_cash_sale_orphan',
      count: orphanFeedCashSales,
      details: 'FEED_CASH_SALE ledger entries without transaction reference'
    });
  }

  return {
    counts: { transactions: txCount, ledgerEntries: ledgerCount, settlements: settlementCount, activeFarmers: farmerCount },
    exceptions
  };
};

const buildAudit = (data) => {
  const { counts, exceptions } = data;
  return {
    counts,
    exceptions,
    hasExceptions: exceptions.length > 0
  };
};

module.exports = { fetchAuditData, buildAudit };