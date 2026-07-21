// services/reports/graphBuilder.js

const buildGraphs = (operational, financial, settlement) => {
  // ── Safe destructuring ──
  const ops = operational || {};
  const set = settlement || {};

  const trends = ops.trends || { daily: [], weekly: [], rateBreakdown: [] };
  const feedRevenue = ops.feedRevenue || { cash: 0, balance: 0, total: 0 };
  const zoneBreakdown = ops.zoneBreakdown || [];
  const productBreakdown = ops.productBreakdown || [];
  const porterPerformance = ops.porterPerformance || {};
  const farmerPerformance = ops.farmerPerformance || {};

  const daily = trends.daily || [];
  const weekly = trends.weekly || [];
  const rateBreakdown = trends.rateBreakdown || [];
  const topPorters = porterPerformance.detailedPorterStats || [];
  const settlementSummary = set.summary || {};

  // ── Calendar Heatmap ──
  const calendarHeatmap = {
    title: 'Milk Collection Calendar',
    type: 'heatmap',
    xAxis: 'Date',
    yAxis: 'Milk (L)',
    data: daily.map(d => ({
      date: d.date,
      litres: d.litres || 0,
      transactions: d.transactionCount || 0
    }))
  };

  // ── Payment Methods ──
  const totalPayments = feedRevenue.cash + feedRevenue.balance;
  const paymentMethods = {
    title: 'Payment Method Distribution',
    type: 'pie',
    data: [
      {
        label: 'Cash',
        amount: feedRevenue.cash || 0,
        percentage: totalPayments > 0 ? (feedRevenue.cash / totalPayments) * 100 : 0
      },
      {
        label: 'Balance',
        amount: feedRevenue.balance || 0,
        percentage: totalPayments > 0 ? (feedRevenue.balance / totalPayments) * 100 : 0
      }
    ]
  };

  // ── Zone Ranking ──
  const totalZoneLitres = Array.isArray(zoneBreakdown)
    ? zoneBreakdown.reduce((sum, z) => sum + (z.totalLitres || 0), 0)
    : 0;

  const zoneRanking = {
    title: 'Zone Production Ranking',
    type: 'bar',
    xAxis: 'Zone',
    yAxis: 'Litres',
    data: (Array.isArray(zoneBreakdown) ? zoneBreakdown : []).map((z, idx) => ({
      rank: idx + 1,
      zone: z.zone || 'Unassigned',
      litres: z.totalLitres || 0,
      percentage: totalZoneLitres > 0 ? ((z.totalLitres || 0) / totalZoneLitres) * 100 : 0
    }))
  };

  // ── Porter Leaderboard ──
  const porterLeaderboard = {
    title: 'Porter Leaderboard',
    type: 'leaderboard',
    data: (Array.isArray(topPorters) ? topPorters : []).map((p, idx) => ({
      rank: idx + 1,
      name: p.porterName || 'Unknown',
      litres: p.totalLitres || 0,
      transactions: p.transactionCount || 0,
      avgLitresPerTrip: p.transactionCount > 0 ? (p.totalLitres / p.transactionCount) : 0
    }))
  };

  // ── Product Contribution ──
  const totalProductRevenue = Array.isArray(productBreakdown)
    ? productBreakdown.reduce((sum, p) => sum + (p.totalCost || 0), 0)
    : 0;

  const productContribution = {
    title: 'Feed Product Contribution',
    type: 'pie',
    data: (Array.isArray(productBreakdown) ? productBreakdown : []).map(p => ({
      product: p.productName || 'Unknown',
      revenue: p.totalCost || 0,
      quantity: p.totalQuantity || 0,
      percentage: totalProductRevenue > 0 ? ((p.totalCost || 0) / totalProductRevenue) * 100 : 0
    }))
  };

  // ── Balance Histogram (placeholder) ──
  const balanceHistogram = {
    title: 'Farmer Balance Distribution',
    type: 'histogram',
    xAxis: 'Balance Range (KES)',
    yAxis: 'Number of Farmers',
    data: []
  };

  // ── Settlement Gauge ──
  const totalNetPayable = settlementSummary.totalNetPayable || 0;
  const completionRate = totalNetPayable > 0
    ? ((settlementSummary.totalPaid || 0) / totalNetPayable) * 100
    : 0;

  const settlementGauge = {
    title: 'Settlement Progress',
    type: 'gauge',
    value: completionRate,
    max: 100,
    unit: '%'
  };

  // ── Weekly Performance ──
  const weeklyPerformance = {
    title: 'Weekly Performance',
    type: 'table',
    data: (Array.isArray(weekly) ? weekly : []).map((w, idx) => {
      const prevWeek = idx > 0 ? weekly[idx - 1] : null;
      const growth = prevWeek && prevWeek.totalLitres > 0
        ? ((w.totalLitres - prevWeek.totalLitres) / prevWeek.totalLitres) * 100
        : null;
      return {
        week: w.week || idx + 1,
        litres: w.totalLitres || 0,
        transactions: w.transactionCount || 0,
        avgPerDay: (w.totalLitres || 0) / 7,
        growth: growth !== null ? parseFloat(growth.toFixed(1)) : null
      };
    })
  };

  // ── Rate Usage ──
  const totalRateTx = (Array.isArray(rateBreakdown) ? rateBreakdown : [])
    .reduce((sum, r) => sum + (r.transactionCount || 0), 0);

  const rateUsage = {
    title: 'Milk Rate Adoption',
    type: 'bar',
    xAxis: 'Rate (KES/L)',
    yAxis: '% of Transactions',
    data: (Array.isArray(rateBreakdown) ? rateBreakdown : []).map(r => ({
      rate: r.rate || 0,
      percentage: totalRateTx > 0 ? ((r.transactionCount || 0) / totalRateTx) * 100 : 0
    }))
  };

  // ── Cumulative Milk Value (operational, not cash) ──
  let cumulative = 0;
  const cumulativeMilkValue = {
    title: 'Cumulative Milk Value',
    type: 'area',
    xAxis: 'Date',
    yAxis: 'KES',
    data: (Array.isArray(daily) ? daily : []).map(d => {
      cumulative += d.payout || 0;
      return { date: d.date || '', cumulativeMilkValue: cumulative };
    })
  };

  return {
    calendarHeatmap,
    paymentMethods,
    zoneRanking,
    porterLeaderboard,
    productContribution,
    balanceHistogram,
    settlementGauge,
    weeklyPerformance,
    rateUsage,
    cumulativeMilkValue
  };
};

module.exports = { buildGraphs };