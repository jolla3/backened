// analytics/engines/operationsEngine.js
const CONFIG = require('../analyticsConfig');
const { safeNumber } = require('../utils/formatters');

const computeOperations = (context) => {
  const {
    farmers,
    devices,
    now,
    today,
    yesterday,
    sevenDaysAgo,
    thirtyDaysAgo,
    todayMilk,
    yesterdayMilk,
    weekMilk,
    monthMilk,
  } = context;

  const totalActive = farmers.filter(f => f.isActive !== false).length;

  // Today
  const todayLitres = todayMilk.reduce((s, t) => s + (t.litres || 0), 0);
  const todayTransactions = todayMilk.length;
  const todayFarmers = new Set(todayMilk.map(t => t.farmer_id.toString())).size;
  const todayPorters = new Set(todayMilk.map(t => t.porter_id?.toString()).filter(Boolean)).size;

  const yesterdayLitres = yesterdayMilk.reduce((s, t) => s + (t.litres || 0), 0);

  // Week
  const weekLitres = weekMilk.reduce((s, t) => s + (t.litres || 0), 0);
  const weekDays = new Set(weekMilk.map(t => t.timestamp_server.toISOString().split('T')[0])).size || 1;
  const avgWeekDay = weekLitres / weekDays;
  const weekFarmers = new Set(weekMilk.map(t => t.farmer_id.toString())).size;

  // Month
  const monthLitres = monthMilk.reduce((s, t) => s + (t.litres || 0), 0);
  const monthFarmers = new Set(monthMilk.map(t => t.farmer_id.toString())).size;

  // Derived
  const collectionEfficiency = totalActive > 0 ? (todayFarmers / totalActive) * 100 : 0;
  const litresPerPorter = todayPorters > 0 ? todayLitres / todayPorters : 0;
  const farmersPerPorter = todayPorters > 0 ? todayFarmers / todayPorters : 0;
  const avgLitresPerTransaction = todayTransactions > 0 ? (todayLitres / todayTransactions).toFixed(1) : '0';
  const avgMilkPerFarmerToday = todayFarmers > 0 ? Math.round(todayLitres / todayFarmers) : 0;
  const avgMilkPerFarmerWeek = weekFarmers > 0 ? Math.round(weekLitres / weekFarmers) : 0;
  const avgMilkPerFarmerMonth = monthFarmers > 0 ? Math.round(monthLitres / monthFarmers) : 0;

  const growthVsYesterday = yesterdayLitres > 0
    ? (((todayLitres - yesterdayLitres) / yesterdayLitres) * 100).toFixed(1) + '%'
    : (todayLitres > 0 ? '+100%' : '0%');
  const growthVsLastWeek = avgWeekDay > 0
    ? (((todayLitres - avgWeekDay) / avgWeekDay) * 100).toFixed(1) + '%'
    : (todayLitres > 0 ? '+100%' : '0%');

  // Offline devices
  const offlineDevices = devices.filter(d => {
    const lastTx = context.milkTransactions.find(t => t.device_id === d.uuid);
    return !lastTx || new Date(lastTx.timestamp_server) < yesterday;
  });

  // Missed farmers
  const deliveredToday = new Set(todayMilk.map(t => t.farmer_id.toString()));
  const missedFarmers = farmers.filter(f => f.isActive !== false && !deliveredToday.has(f._id.toString()));

  // Collection performance index (simple proxy)
  const avgPerTx = todayTransactions > 0 ? todayLitres / todayTransactions : 0;
  const collectionPerformanceIndex = avgPerTx > 50 ? 90 : avgPerTx > 30 ? 70 : 50;

  // Duplicate collections (simplified)
  const farmerTxCount = {};
  for (const t of todayMilk) {
    const id = t.farmer_id.toString();
    farmerTxCount[id] = (farmerTxCount[id] || 0) + 1;
  }
  const duplicateCollections = Object.values(farmerTxCount).filter(c => c > 3).length;

  // Peak hour
  const hourCounts = {};
  for (const t of todayMilk) {
    const hour = new Date(t.timestamp_server).getHours();
    hourCounts[hour] = (hourCounts[hour] || 0) + 1;
  }
  let peakHour = null;
  let maxCount = 0;
  for (const [hour, count] of Object.entries(hourCounts)) {
    if (count > maxCount) {
      maxCount = count;
      peakHour = `${hour}:00-${parseInt(hour) + 1}:00`;
    }
  }

  // Retention
  const monthFarmerIds = new Set(monthMilk.map(t => t.farmer_id.toString()));
  const retentionRate = totalActive > 0 ? ((monthFarmerIds.size / totalActive) * 100).toFixed(1) + '%' : '0%';

  return {
    totalFarmers: totalActive,
    activeFarmersToday: todayFarmers,
    todayLitres,                    // explicit naming
    todayTransactions,
    avgMilkPerFarmerToday,
    avgMilkPerFarmerWeek,
    avgMilkPerFarmerMonth,
    avgLitresPerTransaction,
    growthVsYesterday,
    growthVsLastWeek,
    peakCollectionHour: peakHour || '—',
    retentionRate,
    weekTrend: {
      totalLitres: Math.round(weekLitres),
      avgPerDay: Math.round(avgWeekDay),
      activeFarmers: weekFarmers,
    },
    monthTrend: {
      totalLitres: Math.round(monthLitres),
      activeFarmers: monthFarmers,
    },
    collectionEfficiency: parseFloat(collectionEfficiency.toFixed(1)),
    collectionPerformanceIndex: parseFloat(collectionPerformanceIndex.toFixed(1)),
    missedCollections: missedFarmers.length,
    offlineDevices: offlineDevices.length,
    activePorters: todayPorters,
    averageLitresPerPorter: parseFloat(litresPerPorter.toFixed(1)),
    averageFarmersPerPorter: parseFloat(farmersPerPorter.toFixed(1)),
    duplicateCollections,
  };
};

module.exports = { computeOperations };