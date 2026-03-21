const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const getZoneIntelligence = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const zoneData = await Transaction.aggregate([
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
          totalMilk: { $sum: { $ifNull: ['$litres', 0] } },
          activeFarmers: { $addToSet: { $ifNull: ['$farmer._id', null] } },
          transactions: { $sum: 1 }
        }
      },
      { $sort: { totalMilk: -1 } }
    ]);

    const zones = zoneData.map(zone => ({
      zone: zone._id === 'main' ? 'Main Branch' : `Zone ${zone._id}`,
      milkTotal: Math.round(zone.totalMilk),
      farmersActive: (zone.activeFarmers || []).filter(f => f).length,
      avgMilkPerFarmer: zone.activeFarmers?.length > 0 ? 
        Math.round(zone.totalMilk / zone.activeFarmers.filter(f => f).length) : 0,
      transactions: zone.transactions
    }));

    return zones;
  } catch (error) {
    logger.error('ZoneIntelligence failed', { error: error.message, coopId });
    return [];
  }
};

module.exports = { getZoneIntelligence };