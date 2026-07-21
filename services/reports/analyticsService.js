// analyticsService.js – all computations in memory from raw data
const computeGraphs = (opData, finData, setData) => {
  // All data already fetched; compute graphs without extra DB calls
  const { daily, weekly, zoneBreakdown, rateBreakdown, topPorters, productBreakdown, milkOverview } = opData;

  // Example: Calendar heatmap
  const calendarHeatmap = daily.map(d => ({ date: d.date, litres: d.litres, payout: d.payout, transactions: d.transactionCount }));

  // Payment methods (from feed revenue)
  const feedRev = opData.feedRevenue;
  const totalPayments = feedRev.cashRevenue + feedRev.balanceRevenue;
  const paymentMethods = [
    { label: 'Cash', amount: feedRev.cashRevenue, percentage: totalPayments > 0 ? (feedRev.cashRevenue / totalPayments) * 100 : 0 },
    { label: 'Balance', amount: feedRev.balanceRevenue, percentage: totalPayments > 0 ? (feedRev.balanceRevenue / totalPayments) * 100 : 0 }
  ];

  // Zone ranking (no extra query)
  const totalZoneLitres = zoneBreakdown.reduce((s, z) => s + z.totalLitres, 0);
  const zoneRanking = zoneBreakdown.map((z, idx) => ({
    rank: idx + 1,
    zone: z.zone || 'Unassigned',
    litres: z.totalLitres,
    percentage: totalZoneLitres > 0 ? (z.totalLitres / totalZoneLitres) * 100 : 0,
    farmers: 0 // would need separate query; could be omitted or computed from farmer data if available
  }));

  // Product contribution
  const totalProductRevenue = productBreakdown.reduce((s, p) => s + p.totalCost, 0);
  const productContribution = productBreakdown.map(p => ({
    product: p.productName,
    revenue: p.totalCost,
    quantity: p.totalQuantity,
    percentage: totalProductRevenue > 0 ? (p.totalCost / totalProductRevenue) * 100 : 0
  }));

  // Add metadata for each graph
  return {
    calendarHeatmap: { title: 'Milk Collection Calendar', type: 'heatmap', xAxis: 'Date', yAxis: 'Milk (L)', data: calendarHeatmap },
    paymentMethods: { title: 'Payment Method Distribution', type: 'pie', data: paymentMethods },
    zoneRanking: { title: 'Zone Production Ranking', type: 'bar', xAxis: 'Zone', yAxis: 'Litres', data: zoneRanking },
    productContribution: { title: 'Feed Product Contribution', type: 'pie', data: productContribution },
    // ... more graphs
  };
};

module.exports = { computeGraphs };