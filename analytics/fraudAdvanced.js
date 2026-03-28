const Transaction = require('../models/transaction');
const Porter = require('../models/porter');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getAdvancedFraudSignals = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const signals = [];
    const now = new Date();
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

    // 1. Porter anomalies: compare average litres per transaction to zone average
    const porterAvg = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { porter: '$porter_id', zone: '$zone' },
          avgLitres: { $avg: '$litres' },
          count: { $sum: 1 }
        }
      }
    ]);

    const zoneAverages = {};
    for (const p of porterAvg) {
      if (!zoneAverages[p._id.zone]) zoneAverages[p._id.zone] = { sum: 0, count: 0 };
      zoneAverages[p._id.zone].sum += p.avgLitres * p.count;
      zoneAverages[p._id.zone].count += p.count;
    }
    for (const zone in zoneAverages) {
      zoneAverages[zone] = zoneAverages[zone].sum / zoneAverages[zone].count;
    }

    for (const p of porterAvg) {
      const zoneAvg = zoneAverages[p._id.zone] || 0;
      if (zoneAvg > 0 && p.avgLitres > zoneAvg * 2) {
        const porter = await Porter.findById(p._id.porter);
        signals.push({
          type: 'porter_anomaly',
          porter: porter ? porter.name : 'Unknown',
          zone: p._id.zone,
          avgLitres: Math.round(p.avgLitres),
          zoneAvg: Math.round(zoneAvg),
          risk: 'HIGH',
          score: (p.avgLitres / zoneAvg).toFixed(1),
          description: `Porter averaging ${Math.round(p.avgLitres)}L per delivery vs zone avg ${Math.round(zoneAvg)}L (${Math.round((p.avgLitres/zoneAvg)*100)}% higher)`
        });
      }
    }

    // 2. Night transactions (22:00 - 06:00)
    const nightTx = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: thirtyDaysAgo } } },
      {
        $match: {
          $expr: {
            $or: [
              { $gte: [{ $hour: '$timestamp_server' }, 22] },
              { $lte: [{ $hour: '$timestamp_server' }, 6] }
            ]
          }
        }
      },
      { $group: { _id: null, count: { $sum: 1 }, totalLitres: { $sum: '$litres' }, totalPayout: { $sum: '$payout' } } }
    ]);
    if (nightTx[0] && nightTx[0].count > 5) {
      signals.push({
        type: 'night_transactions',
        count: nightTx[0].count,
        totalLitres: Math.round(nightTx[0].totalLitres),
        totalPayout: Math.round(nightTx[0].totalPayout),
        risk: 'MEDIUM',
        description: `${nightTx[0].count} night transactions in last 30 days (${Math.round(nightTx[0].totalLitres)}L)`
      });
    }

    // 3. Large single deliveries (>100L) - possible fraud
    const largeDeliveries = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, litres: { $gt: 100 }, timestamp_server: { $gte: thirtyDaysAgo } } },
      { $group: { _id: null, count: { $sum: 1 }, totalLitres: { $sum: '$litres' } } }
    ]);
    if (largeDeliveries[0] && largeDeliveries[0].count > 5) {
      signals.push({
        type: 'large_deliveries',
        count: largeDeliveries[0].count,
        totalVolume: Math.round(largeDeliveries[0].totalLitres),
        risk: 'HIGH',
        description: `${largeDeliveries[0].count} large deliveries (>100L) in last 30 days`
      });
    }

    // 4. Duplicate receipt numbers
    const duplicateReceipts = await Transaction.aggregate([
      { $match: { cooperativeId: cooperative._id, receipt_num: { $ne: null } } },
      { $group: { _id: '$receipt_num', count: { $sum: 1 } } },
      { $match: { count: { $gt: 1 } } },
      { $sort: { count: -1 } },
      { $limit: 5 }
    ]);
    if (duplicateReceipts.length > 0) {
      signals.push({
        type: 'duplicate_receipts',
        count: duplicateReceipts.length,
        mostDuplicates: duplicateReceipts[0]._id,
        risk: 'CRITICAL',
        description: `${duplicateReceipts.length} receipt numbers duplicated (max ${duplicateReceipts[0].count} times)`
      });
    }

    // 5. Farmer with very high frequency (multiple deliveries per day)
    const highFrequency = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: thirtyDaysAgo } } },
      {
        $group: {
          _id: { farmer: '$farmer_id', day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } },
          count: { $sum: 1 }
        }
      },
      { $match: { count: { $gt: 3 } } },
      { $group: { _id: '$_id.farmer', days: { $push: '$_id.day' }, maxCount: { $max: '$count' } } }
    ]);
    if (highFrequency.length > 0) {
      const farmers = await Farmer.find({ _id: { $in: highFrequency.map(f => f._id) } });
      for (const f of highFrequency) {
        const farmer = farmers.find(farmer => farmer._id.toString() === f._id.toString());
        signals.push({
          type: 'high_frequency',
          farmer: farmer ? farmer.name : 'Unknown',
          maxPerDay: f.maxCount,
          risk: 'MEDIUM',
          description: `${farmer ? farmer.name : 'Farmer'} had ${f.maxCount} deliveries on a single day in last 30 days`
        });
      }
    }

    // Sort by risk
    const riskOrder = { 'CRITICAL': 3, 'HIGH': 2, 'MEDIUM': 1 };
    return signals.sort((a, b) => riskOrder[b.risk] - riskOrder[a.risk]);
  } catch (error) {
    logger.error('FraudAdvanced failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getAdvancedFraudSignals };