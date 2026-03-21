const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getFarmerRisks = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const risks = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: cooperative._id } },
      { 
        $group: {
          _id: '$farmer_id',
          lastDelivery: { $max: '$timestamp_server' },
          totalLitres: { $sum: { $ifNull: ['$litres', 0] } }
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
      { $unwind: { path: '$farmer', preserveNullAndEmptyArrays: true } },
      { 
        $project: {
          farmerName: { $ifNull: ['$farmer.name', 'Unknown'] },
          lastDelivery: 1,
          currentBalance: '$farmer.balance',
          totalLitres: 1
        }
      },
      { $sort: { lastDelivery: 1 } }  // Oldest first
    ]);

    const riskList = risks
      .filter(item => item.lastDelivery)
      .map(item => {
        const daysSince = (Date.now() - new Date(item.lastDelivery)) / 86400000;
        const debtLevel = Math.abs(item.currentBalance || 0) / 1000;
        const riskScore = (daysSince * 0.5) + (debtLevel * 0.3);
        
        let risk = 'LOW';
        if (riskScore >= 8) risk = 'CRITICAL';
        else if (riskScore >= 6) risk = 'HIGH';
        else if (riskScore >= 3) risk = 'MEDIUM';

        return {
          farmer: item.farmerName,
          lastDelivery: `${Math.round(daysSince)} days ago`,
          risk,
          riskScore: riskScore.toFixed(1),
          currentBalance: item.currentBalance || 0,
          totalLitres: Math.round(item.totalLitres || 0)
        };
      })
      .filter(item => item.risk !== 'LOW')
      .slice(0, 10);  // Top 10 risks

    return riskList.sort((a, b) => parseFloat(b.riskScore) - parseFloat(a.riskScore));
  } catch (error) {
    logger.error('FarmerRisks failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getFarmerRisks };