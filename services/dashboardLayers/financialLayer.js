const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getFinancial = async (cooperativeId) => {
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
    const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());

    // 1. Milk payout this month
    const milkStats = await Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId: cooperative._id,
          timestamp_server: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalPayout: { $sum: { $ifNull: ['$payout', 0] } },
          totalLitres: { $sum: { $ifNull: ['$litres', 0] } }
        }
      }
    ]);

    // 2. Feed revenue this month
    const feedStats = await Transaction.aggregate([
      {
        $match: {
          type: 'feed',
          cooperativeId: cooperative._id,
          timestamp_server: { $gte: startOfMonth }
        }
      },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: { $ifNull: ['$cost', 0] } },
          totalQty: { $sum: { $ifNull: ['$quantity', 0] } }
        }
      }
    ]);

    // 3. Farmers with negative balance (debtors)
    const debtors = await Farmer.find(
      { cooperativeId: cooperative._id, balance: { $lt: 0 } },
      'name farmer_code balance phone'
    ).sort({ balance: 1 }).lean();  // most negative first

    const totalDebt = debtors.reduce((sum, f) => sum + Math.abs(f.balance), 0);

    // 4. Today's milk stats
    const todayStats = await Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId: cooperative._id,
          timestamp_server: { $gte: startOfToday }
        }
      },
      {
        $group: {
          _id: null,
          totalPayout: { $sum: { $ifNull: ['$payout', 0] } },
          totalLitres: { $sum: { $ifNull: ['$litres', 0] } }
        }
      }
    ]);

    const milkPayout = milkStats[0]?.totalPayout || 0;
    const feedRevenue = feedStats[0]?.totalRevenue || 0;
    const todayPayout = todayStats[0]?.totalPayout || 0;
    const todayLitres = todayStats[0]?.totalLitres || 0;

    const netCashFlow = feedRevenue - milkPayout;
    const profitMargin = feedRevenue > 0 ? (netCashFlow / feedRevenue) * 100 : 0;
    const hasRealData = feedRevenue > 0 || milkPayout > 0;

    return {
      milkRevenue: Math.round(milkPayout),
      feedRevenue: Math.round(feedRevenue),
      netCashFlow: Math.round(netCashFlow),
      profitMargin: hasRealData ? parseFloat(profitMargin.toFixed(1)) : null,
      todayMilkPayout: Math.round(todayPayout),
      todayMilkLitres: Math.round(todayLitres),
      farmerDebtTotal: Math.round(totalDebt),
      farmerDebtList: debtors.map(f => ({
        id: f._id,
        name: f.name,
        code: f.farmer_code,
        balance: f.balance,
        phone: f.phone
      })),
      hasRealData
    };
  } catch (error) {
    logger.error('Financial layer failed', { cooperativeId, error: error.message });
    return getDefaultFinancial();
  }
};

const getDefaultFinancial = () => ({
  milkRevenue: 0,
  feedRevenue: 0,
  netCashFlow: 0,
  profitMargin: null,
  todayMilkPayout: 0,
  todayMilkLitres: 0,
  farmerDebtTotal: 0,
  farmerDebtList: [],
  hasRealData: false
})

module.exports = { getFinancial };