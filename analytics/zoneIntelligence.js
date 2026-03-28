const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getZoneIntelligence = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const last7DaysStart = new Date(todayStart);
    last7DaysStart.setDate(last7DaysStart.getDate() - 7);

    // Aggregation to get zone performance
    const zones = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id } },
      { 
        $lookup: {
          from: 'farmers',
          localField: 'farmer_id',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      {
        $group: {
          _id: { $ifNull: ['$farmer.branch_id', 'main'] },
          totalLitres: { $sum: '$litres' },
          totalPayout: { $sum: '$payout' },
          transactionCount: { $sum: 1 },
          uniqueFarmers: { $addToSet: '$farmer_id' },
          recentLitres: {
            $sum: {
              $cond: [
                { $gte: ['$timestamp_server', last7DaysStart] },
                '$litres',
                0
              ]
            }
          },
          recentTransactions: {
            $sum: {
              $cond: [
                { $gte: ['$timestamp_server', last7DaysStart] },
                1,
                0
              ]
            }
          }
        }
      },
      {
        $project: {
          zoneName: '$_id',
          totalLitres: 1,
          totalPayout: 1,
          transactionCount: 1,
          farmerCount: { $size: '$uniqueFarmers' },
          recentLitres: 1,
          recentTransactions: 1,
          avgLitresPerTransaction: { $cond: [{ $gt: ['$transactionCount', 0] }, { $divide: ['$totalLitres', '$transactionCount'] }, 0] },
          avgPayoutPerTransaction: { $cond: [{ $gt: ['$transactionCount', 0] }, { $divide: ['$totalPayout', '$transactionCount'] }, 0] },
          recentAvgPerDay: { $cond: [{ $gt: ['$recentTransactions', 0] }, { $divide: ['$recentLitres', 7] }, 0] }
        }
      },
      { $sort: { totalLitres: -1 } }
    ]);

    // Get overall average for anomaly detection
    const overallAvg = zones.reduce((sum, z) => sum + z.avgLitresPerTransaction, 0) / (zones.length || 1);
    const overallTotal = zones.reduce((sum, z) => sum + z.totalLitres, 0);

    // Enhance zones with derived metrics
    const enhancedZones = zones.map(zone => ({
      zone: zone.zoneName === 'main' ? 'Main Branch' : `Zone ${zone.zoneName}`,
      totalMilk: Math.round(zone.totalLitres),
      totalPayout: Math.round(zone.totalPayout),
      farmers: zone.farmerCount,
      transactions: zone.transactionCount,
      avgMilkPerFarmer: zone.farmerCount ? Math.round(zone.totalLitres / zone.farmerCount) : 0,
      avgMilkPerTransaction: Math.round(zone.avgLitresPerTransaction),
      avgPayoutPerTransaction: Math.round(zone.avgPayoutPerTransaction),
      recentTrend: {
        last7DaysLitres: Math.round(zone.recentLitres),
        avgPerDay: Math.round(zone.recentAvgPerDay),
        transactions: zone.recentTransactions
      },
      contribution: ((zone.totalLitres / overallTotal) * 100).toFixed(1) + '%',
      anomalyScore: zone.avgLitresPerTransaction > overallAvg * 1.5 ? 'HIGH' : (zone.avgLitresPerTransaction < overallAvg * 0.5 ? 'LOW' : 'NORMAL')
    }));

    return enhancedZones;
  } catch (error) {
    logger.error('ZoneIntelligence failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getZoneIntelligence };