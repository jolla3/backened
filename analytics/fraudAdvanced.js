const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getAdvancedFraudSignals = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const signals = [];

    // 1. Porter vs Zone Average Anomaly
    const porters = await Porter.find({ cooperativeId: cooperative._id });
    const zoneAvg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id } },
      { $group: { _id: null, avgLitres: { $avg: { $ifNull: ['$litres', 0] } } } }
    ]);
    const globalAvg = zoneAvg[0]?.avgLitres || 0;

    for (const porter of porters) {
      const porterStats = await Transaction.aggregate([
        { $match: { porter_id: porter._id, type: 'milk', cooperativeId: cooperative._id } },
        { $group: { _id: null, avgLitres: { $avg: { $ifNull: ['$litres', 0] } } } }
      ]);

      const porterAvg = porterStats[0]?.avgLitres || 0;
      if (globalAvg > 0 && porterAvg > globalAvg * 2) {
        signals.push({
          type: 'porter_anomaly',
          porter: porter.name,
          anomaly: `Avg ${Math.round(porterAvg)}L vs zone ${Math.round(globalAvg)}L (${((porterAvg/globalAvg)*100).toFixed(0)}%)`,
          risk: 'HIGH',
          score: Math.round((porterAvg / globalAvg) * 10) / 10
        });
      }
    }

    // 2. Night Transactions (22:00 - 06:00)
    const nightTx = await Transaction.aggregate([
      { $match: { 
        type: 'milk', 
        cooperativeId: cooperative._id,
        timestamp_server: {
          $expr: {
            $or: [
              { $and: [{ $gte: [{ $hour: '$timestamp_server' }, 22] }, { $lte: [{ $hour: '$timestamp_server' }, 23] }] },
              { $and: [{ $gte: [{ $hour: '$timestamp_server' }, 0] }, { $lte: [{ $hour: '$timestamp_server' }, 6] }] }
            ]
          }
        }
      }},
      { $group: { _id: '$device_id', count: { $sum: 1 }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } },
      { $match: { count: { $gt: 0 } } }
    ]);

    if (nightTx.length > 0) {
      signals.push({
        type: 'night_transactions',
        count: nightTx.length,
        totalLitres: Math.round(nightTx.reduce((sum, tx) => sum + tx.totalLitres, 0)),
        risk: 'MEDIUM'
      });
    }

    // 3. Large Single Deliveries (>100L)
    const largeDeliveries = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, litres: { $gt: 100 } } },
      { $group: { _id: '$device_id', count: { $sum: 1 }, totalLarge: { $sum: '$litres' } } },
      { $match: { count: { $gt: 0 } } }
    ]);

    if (largeDeliveries.length > 0) {
      signals.push({
        type: 'large_deliveries',
        count: largeDeliveries.length,
        totalVolume: Math.round(largeDeliveries.reduce((sum, d) => sum + d.totalLarge, 0)),
        risk: 'HIGH'
      });
    }

    // 4. Duplicate Receipt Numbers
    const duplicateReceipts = await Transaction.aggregate([
      { $match: { cooperativeId: cooperative._id } },
      { $group: { _id: '$receipt_num', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } }
    ]);

    if (duplicateReceipts.length > 0) {
      signals.push({
        type: 'duplicate_receipts',
        count: duplicateReceipts.length,
        mostDuplicates: duplicateReceipts[0]._id,
        risk: 'CRITICAL'
      });
    }

    return signals.slice(0, 10).sort((a, b) => {
      const riskOrder = { 'CRITICAL': 3, 'HIGH': 2, 'MEDIUM': 1 };
      return riskOrder[b.risk] - riskOrder[a.risk];
    });
  } catch (error) {
    logger.error('FraudAdvanced failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getAdvancedFraudSignals };