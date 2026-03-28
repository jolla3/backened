const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getFarmerRisks = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // Get all farmers with their transaction summaries
    const farmerData = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id } },
      {
        $group: {
          _id: '$farmer_id',
          lastDelivery: { $max: '$timestamp_server' },
          totalLitres: { $sum: '$litres' },
          totalPayout: { $sum: '$payout' },
          transactionCount: { $sum: 1 },
          avgLitresPerDelivery: { $avg: '$litres' },
          deliveriesInLast90Days: {
            $sum: {
              $cond: [{ $gte: ['$timestamp_server', ninetyDaysAgo] }, 1, 0]
            }
          },
          recentLitres: {
            $sum: {
              $cond: [{ $gte: ['$timestamp_server', ninetyDaysAgo] }, '$litres', 0]
            }
          }
        }
      },
      {
        $lookup: {
          from: 'farmers',
          localField: '_id',
          foreignField: '_id',
          as: 'farmer'
        }
      },
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } }
    ]);

    // Get all active farmers
    const allFarmers = await Farmer.find({ cooperativeId: cooperative._id, isActive: true }).lean();
    const farmerMap = new Map();
    for (const f of allFarmers) farmerMap.set(f._id.toString(), f);

    // Combine data and calculate risk scores
    const risks = [];
    for (const farmer of allFarmers) {
      const stats = farmerData.find(f => f._id.toString() === farmer._id.toString()) || {
        lastDelivery: null,
        totalLitres: 0,
        totalPayout: 0,
        transactionCount: 0,
        avgLitresPerDelivery: 0,
        deliveriesInLast90Days: 0,
        recentLitres: 0
      };

      const daysSinceLastDelivery = stats.lastDelivery ? (Date.now() - new Date(stats.lastDelivery)) / 86400000 : 90;
      const hasRecentActivity = daysSinceLastDelivery <= 30;

      // Calculate risk factors
      let riskScore = 0;
      let reasons = [];

      // Factor 1: Inactivity
      if (daysSinceLastDelivery > 60) {
        riskScore += 4;
        reasons.push(`No delivery in ${Math.floor(daysSinceLastDelivery)} days`);
      } else if (daysSinceLastDelivery > 30) {
        riskScore += 2;
        reasons.push(`No delivery in ${Math.floor(daysSinceLastDelivery)} days`);
      }

      // Factor 2: Declining volume (compare last 30 days vs previous 60)
      const last30Days = stats.recentLitres || 0;
      const previous60Days = stats.totalLitres - last30Days;
      if (previous60Days > 0 && last30Days < previous60Days * 0.5) {
        riskScore += 3;
        reasons.push('Significant drop in deliveries');
      } else if (previous60Days > 0 && last30Days < previous60Days * 0.8) {
        riskScore += 1;
        reasons.push('Declining delivery volume');
      }

      // Factor 3: Debt
      const debt = farmer.balance || 0;
      if (debt > 5000) {
        riskScore += Math.min(5, Math.floor(debt / 5000));
        reasons.push(`High debt: KES ${debt.toFixed(0)}`);
      }

      // Factor 4: Low consistency (few deliveries)
      if (stats.transactionCount > 0 && stats.deliveriesInLast90Days < 3) {
        riskScore += 2;
        reasons.push('Low delivery frequency');
      }

      // Determine risk level
      let risk = 'LOW';
      if (riskScore >= 7) risk = 'CRITICAL';
      else if (riskScore >= 4) risk = 'HIGH';
      else if (riskScore >= 2) risk = 'MEDIUM';

      if (risk !== 'LOW') {
        risks.push({
          farmer: farmer.name,
          farmerCode: farmer.farmer_code,
          lastDelivery: stats.lastDelivery ? `${Math.floor(daysSinceLastDelivery)} days ago` : 'Never',
          totalLitres: Math.round(stats.totalLitres),
          currentBalance: Math.round(debt),
          risk,
          riskScore: riskScore.toFixed(1),
          reasons
        });
      }
    }

    // Sort by risk score descending
    return risks.sort((a, b) => b.riskScore - a.riskScore).slice(0, 15);
  } catch (error) {
    logger.error('FarmerRisks failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getFarmerRisks };