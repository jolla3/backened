const Transaction = require('../models/transaction');
const Porter = require('../models/porter');

const getAdvancedFraudSignals = async (adminId) => {
  const cooperative = await require('../models/cooperative').findById(adminId);
  if (!cooperative) throw new Error('Cooperative not found');

  const signals = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1. Porter vs Zone Average
  const porters = await Porter.find({ cooperativeId: cooperative._id });
  const zoneAvg = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    { $group: { _id: null, avgLitres: { $avg: '$litres' } } }
  ]);
  const globalAvg = zoneAvg[0]?.avgLitres || 0;

  for (const porter of porters) {
    const porterStats = await Transaction.aggregate([
      { $match: { device_id: porter._id, type: 'milk', cooperativeId: cooperative._id } },
      { $group: { _id: null, avgLitres: { $avg: '$litres' } } }
    ]);

    const porterAvg = porterStats[0]?.avgLitres || 0;
    if (globalAvg > 0 && porterAvg > globalAvg * 2) {
      signals.push({
        porter: porter.name,
        anomaly: `Milk ${((porterAvg / globalAvg) * 100).toFixed(0)}% higher than average`,
        risk: 'HIGH'
      });
    }
  }

  // 2. Night Transactions (22:00 - 04:00)
  const nightTx = await Transaction.aggregate([
    { $match: {
      type: 'milk',
      cooperativeId: cooperative._id,
      timestamp_server: {
        $gte: new Date(new Date().setHours(22, 0, 0, 0)),
        $lt: new Date(new Date().setHours(4, 0, 0, 0))
      }
    }},
    { $group: { _id: '$device_id', count: { $sum: 1 } } },
    { $match: { count: { $gt: 0 } } }
  ]);

  if (nightTx.length > 0) {
    signals.push({
      type: 'night_transactions',
      count: nightTx.length,
      risk: 'MEDIUM'
    });
  }

  // 3. Large Deliveries (>100L)
  const largeDeliveries = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, litres: { $gt: 100 } } },
    { $group: { _id: '$device_id', count: { $sum: 1 } } },
    { $match: { count: { $gt: 0 } } }
  ]);

  if (largeDeliveries.length > 0) {
    signals.push({
      type: 'large_deliveries',
      count: largeDeliveries.length,
      risk: 'HIGH'
    });
  }

  // 4. Duplicate Receipt Numbers
  const duplicateReceipts = await Transaction.aggregate([
    { $match: { cooperativeId: cooperative._id } },
    { $group: { _id: '$receipt_num', count: { $sum: 1 } } },
    { $match: { count: { $gt: 1 } } }
  ]);

  if (duplicateReceipts.length > 0) {
    signals.push({
      type: 'duplicate_receipts',
      count: duplicateReceipts.length,
      risk: 'CRITICAL'
    });
  }

  return signals.sort((a, b) => (b.risk === 'CRITICAL' ? 1 : b.risk === 'HIGH' ? 0 : -1));
};

module.exports = { getAdvancedFraudSignals };