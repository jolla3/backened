const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getMilkQuality = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [rejected, totalMilk] = await Promise.all([
      Transaction.aggregate([
        { $match: { 
          type: 'milk', 
          cooperativeId: cooperative._id, 
          timestamp_server: { $gte: today },
          status: 'rejected'  // Assuming you have status field
        }},
        { $group: { _id: null, count: { $sum: 1 }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { $match: { 
          type: 'milk', 
          cooperativeId: cooperative._id, 
          timestamp_server: { $gte: today } 
        }},
        { $group: { _id: null, count: { $sum: 1 }, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ])
    ]);

    const rejectedCount = rejected[0]?.count || 0;
    const totalCount = totalMilk[0]?.count || 1;
    const rejectedLitres = rejected[0]?.totalLitres || 0;
    const totalLitres = totalMilk[0]?.totalLitres || 1;
    
    const rejectedPercentage = ((rejectedCount / totalCount) * 100).toFixed(1);
    const rejectedVolumePercentage = ((rejectedLitres / totalLitres) * 100).toFixed(1);

    return {
      rejectedToday: rejectedCount,
      rejectedPercentage: `${rejectedPercentage}%`,
      rejectedVolumePercentage: `${rejectedVolumePercentage}%`,
      problemZones: [],  // Would need zone data
      totalMilkToday: Math.round(totalLitres)
    };
  } catch (error) {
    logger.error('MilkQuality failed', { error: error.message, coopId });
    return getDefaultMilkQuality();
  }
};

const getDefaultMilkQuality = () => ({ 
  rejectedToday: 0, 
  rejectedPercentage: '0%', 
  rejectedVolumePercentage: '0%',
  problemZones: [],
  totalMilkToday: 0
});

module.exports = { getMilkQuality };