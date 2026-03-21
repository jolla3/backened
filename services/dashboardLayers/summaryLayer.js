const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');
const Device = require('../../models/device');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getSummary = async (cooperativeId) => {  // ✅ FIXED: cooperativeId
  try {
    // ✅ VALIDATE cooperative
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    const lastWeek = new Date(today);
    lastWeek.setDate(lastWeek.getDate() - 7);
    const lastMonth = new Date(today);
    lastMonth.setMonth(lastMonth.getMonth() - 1);

    logger.info('Summary query', { 
      cooperativeId, 
      today: today.toISOString().split('T')[0],
      cooperativeName: cooperative.name 
    });

    const [todayMilk, yesterdayMilk, weekMilk, monthMilk] = await Promise.all([
      Transaction.aggregate([
        { 
          $match: { 
            type: 'milk', 
            cooperativeId: cooperative._id, 
            timestamp_server: { $gte: today } 
          } 
        },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { 
          $match: { 
            type: 'milk', 
            cooperativeId: cooperative._id, 
            timestamp_server: { $gte: yesterday, $lt: today } 
          } 
        },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { 
          $match: { 
            type: 'milk', 
            cooperativeId: cooperative._id, 
            timestamp_server: { $gte: lastWeek, $lt: today } 
          } 
        },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ]),
      Transaction.aggregate([
        { 
          $match: { 
            type: 'milk', 
            cooperativeId: cooperative._id, 
            timestamp_server: { $gte: lastMonth, $lt: today } 
          } 
        },
        { $group: { _id: null, totalLitres: { $sum: { $ifNull: ['$litres', 0] } } } }
      ])
    ]);

    const todayLitres = todayMilk[0]?.totalLitres || 0;
    const yesterdayLitres = yesterdayMilk[0]?.totalLitres || 0;
    const weekLitres = weekMilk[0]?.totalLitres || 0;
    const monthLitres = monthMilk[0]?.totalLitres || 0;

    const milkChange = yesterdayLitres > 0 
      ? Math.round(((todayLitres - yesterdayLitres) / yesterdayLitres) * 100 * 10) / 10
      : todayLitres > 0 ? 100 : 0;

    const [totalFarmers, totalPorters, totalDevices, farmersToday, transactionsToday] = await Promise.all([
      Farmer.countDocuments({ cooperativeId: cooperative._id }),
      Porter.countDocuments({ cooperativeId: cooperative._id }),
      Device.countDocuments({ 
        cooperativeId: cooperative._id, 
        revoked: false  // Exclude revoked devices
      }),
      Farmer.countDocuments({ 
        cooperativeId: cooperative._id, 
        createdAt: { $gte: today } 
      }),
      Transaction.countDocuments({ 
        cooperativeId: cooperative._id, 
        timestamp_server: { $gte: today } 
      })
    ]);

    const result = {
      milkToday: Math.round(todayLitres),
      milkYesterday: Math.round(yesterdayLitres),
      milkThisWeek: Math.round(weekLitres),
      milkThisMonth: Math.round(monthLitres),
      milkChange: milkChange,
      farmersToday,
      transactionsToday,
      totalFarmers,
      totalPorters,
      totalDevices
    };

    logger.info('Summary result', { 
      result,
      cooperativeId 
    });

    return result;
  } catch (error) {
    logger.error('Summary failed', { error: error.message, coopId: cooperativeId });
    return getDefaultSummary();
  }
};

const getDefaultSummary = () => ({
  milkToday: 0,
  milkYesterday: 0,
  milkThisWeek: 0,
  milkThisMonth: 0,
  milkChange: 0,
  farmersToday: 0,
  transactionsToday: 0,
  totalFarmers: 0,
  totalPorters: 0,
  totalDevices: 0
});

module.exports = { getSummary };