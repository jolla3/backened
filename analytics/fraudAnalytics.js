const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const logger = require('../utils/logger');

const detectAnomalies = async () => {
  const anomalies = [];

  // 1. Large deliveries
  const largeDeliveries = await Transaction.aggregate([
    { $match: { type: 'milk', litres: { $gt: 100 } } },
    { $group: { _id: null, count: { $sum: 1 }, maxLitres: { $max: '$litres' } } }
  ]);

  if (largeDeliveries[0]?.count > 0) {
    anomalies.push({ type: 'large_delivery', severity: 'high', count: largeDeliveries[0].count, maxLitres: largeDeliveries[0].maxLitres, description: 'Milk deliveries exceeding 100 litres' });
  }

  // 2. Midnight transactions
  const midnightTransactions = await Transaction.aggregate([
    { $match: { type: 'milk', timestamp_server: { $gte: new Date(new Date().setHours(22, 0, 0, 0)) } } },
    { $group: { _id: null, count: { $sum: 1 } } }
  ]);

  if (midnightTransactions[0]?.count > 0) {
    anomalies.push({ type: 'midnight_transaction', severity: 'medium', count: midnightTransactions[0].count, description: 'Transactions during midnight hours' });
  }

  // 3. Duplicate receipts
  const duplicateReceipts = await Transaction.aggregate([
    { $group: { _id: '$receipt_num', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  if (duplicateReceipts.length > 0) {
    anomalies.push({ type: 'duplicate_receipt', severity: 'critical', count: duplicateReceipts.length, description: 'Duplicate receipt numbers detected' });
  }

  return anomalies.sort((a, b) => {
    const severityOrder = { critical: 3, high: 2, medium: 1 };
    return severityOrder[b.severity] - severityOrder[a.severity];
  });
};

const getPorterFraudRiskScore = async () => {
  const porters = await Porter.find({});
  const riskScores = [];

  for (const porter of porters) {
    let riskScore = 0;
    const indicators = [];

    const midnightCount = await Transaction.countDocuments({
      device_id: porter._id,
      type: 'milk',
      timestamp_server: { $gte: new Date(new Date().setHours(22, 0, 0, 0)) }
    });

    if (midnightCount > 0) { riskScore += midnightCount * 10; indicators.push('midnight_transactions'); }

    const largeDeliveryCount = await Transaction.countDocuments({
      device_id: porter._id,
      type: 'milk',
      litres: { $gt: 100 }
    });

    if (largeDeliveryCount > 0) { riskScore += largeDeliveryCount * 5; indicators.push('large_deliveries'); }

    let riskLevel = 'low';
    if (riskScore >= 50) riskLevel = 'critical';
    else if (riskScore >= 30) riskLevel = 'high';
    else if (riskScore >= 10) riskLevel = 'medium';

    riskScores.push({ porterId: porter._id, porterName: porter.name, zones: porter.zones, riskScore, riskLevel, indicators });
  }

  return riskScores.sort((a, b) => b.riskScore - a.riskScore);
};

module.exports = { detectAnomalies, getPorterFraudRiskScore };