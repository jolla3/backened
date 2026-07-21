// analytics/engines/benchmarkEngine.js
const { safeNumber } = require('../utils/formatters');

const computeBenchmarks = (context, financial, operations) => {
  const { milkTransactions, now, today, dailyAggregates } = context;

  const todayStr = today.toISOString().split('T')[0];
  const todayData = dailyAggregates?.find(d => d.date === todayStr);
  const todayLitres = todayData ? todayData.litres : 0;

  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);
  const yesterdayStr = yesterday.toISOString().split('T')[0];
  const yesterdayData = dailyAggregates?.find(d => d.date === yesterdayStr);
  const yesterdayLitres = yesterdayData ? yesterdayData.litres : 0;

  // Last 7 days (excluding today)
  const last7Days = dailyAggregates?.slice(-7) || [];
  const avgWeekDay = last7Days.length > 0 ? last7Days.reduce((s, d) => s + d.litres, 0) / last7Days.length : 0;

  // Last 30 days (excluding today)
  const last30Days = dailyAggregates?.slice(-30) || [];
  const avgMonthDay = last30Days.length > 0 ? last30Days.reduce((s, d) => s + d.litres, 0) / last30Days.length : 0;

  // Last year same month
  const lastYearStart = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const lastYearEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);
  const lastYearTxs = milkTransactions.filter(t => t.timestamp_server >= lastYearStart && t.timestamp_server <= lastYearEnd);
  const lastYearLitres = lastYearTxs.reduce((s, t) => s + (t.litres || 0), 0);
  const lastYearDays = new Set(lastYearTxs.map(t => t.timestamp_server.toISOString().split('T')[0])).size || 1;
  const avgLastYearDay = lastYearLitres / lastYearDays;

  // Seasonal average (last 12 months)
  const twelveMonthsAgo = new Date(today);
  twelveMonthsAgo.setMonth(twelveMonthsAgo.getMonth() - 12);
  const allTxs = milkTransactions.filter(t => t.timestamp_server >= twelveMonthsAgo);
  const totalLitres = allTxs.reduce((s, t) => s + (t.litres || 0), 0);
  const totalDays = new Set(allTxs.map(t => t.timestamp_server.toISOString().split('T')[0])).size || 1;
  const seasonalAvg = totalLitres / totalDays;

  const expectedToday = Math.round(avgWeekDay);

  // Calculate percentages
  const calcPct = (current, previous) => {
    if (previous === 0) return current > 0 ? '+100%' : '0%';
    return ((current - previous) / previous * 100).toFixed(1) + '%';
  };

  return {
    todayLitres,
    yesterdayLitres,
    expectedToday,
    avgWeekDay: Math.round(avgWeekDay),
    weekSamples: last7Days.length,
    avgMonthDay: Math.round(avgMonthDay),
    monthSamples: last30Days.length,
    avgLastYearDay: Math.round(avgLastYearDay),
    seasonalAvg: Math.round(seasonalAvg),
    comparisons: {
      vsYesterday: calcPct(todayLitres, yesterdayLitres),
      vsLastWeek: calcPct(todayLitres, avgWeekDay),
      vsLastMonth: calcPct(todayLitres, avgMonthDay),
      vsLastYear: calcPct(todayLitres, avgLastYearDay),
      vsSeasonal: calcPct(todayLitres, seasonalAvg),
    },
  };
};

module.exports = { computeBenchmarks };