// analytics/engines/trendEngine.js
const computeTrends = (context) => {
  const { dailyAggregates, now } = context;

  if (!dailyAggregates || dailyAggregates.length < 14) {
    return {
      trend7: { currentAverage: null, previousAverage: null, growth: null, direction: 'unknown', confidence: 0, interpretation: 'Insufficient data for 7-day trend' },
      trend30: { currentAverage: null, previousAverage: null, growth: null, direction: 'unknown', confidence: 0, interpretation: 'Insufficient data for 30-day trend' },
      trend90: { currentAverage: null, previousAverage: null, growth: null, direction: 'unknown', confidence: 0, interpretation: 'Insufficient data for 90-day trend' },
    };
  }

  const today = new Date(now);
  today.setHours(0, 0, 0, 0);

  const getWindowAverage = (days, offset = 0) => {
    const end = new Date(today);
    end.setDate(end.getDate() - offset);
    const start = new Date(end);
    start.setDate(start.getDate() - days);
    const filtered = dailyAggregates.filter(d => {
      const dDate = new Date(d.date);
      return dDate >= start && dDate < end;
    });
    if (filtered.length === 0) return 0;
    return filtered.reduce((s, d) => s + d.litres, 0) / filtered.length;
  };

  const computeTrend = (current, previous, label) => {
    if (previous === 0 || current === 0) {
      return {
        currentAverage: Math.round(current),
        previousAverage: Math.round(previous),
        growth: null,
        direction: 'unknown',
        confidence: 0,
        interpretation: 'Insufficient data for ' + label,
      };
    }
    const change = ((current - previous) / previous) * 100;
    let direction = 'stable';
    let interpretation = `Milk deliveries are stable (${change.toFixed(1)}% change).`;
    if (change > 5) {
      direction = 'up';
      interpretation = `Milk deliveries are increasing (${change.toFixed(1)}% over ${label}).`;
    } else if (change < -5) {
      direction = 'down';
      interpretation = `Milk deliveries are declining (${Math.abs(change).toFixed(1)}% over ${label}).`;
    }
    return {
      currentAverage: Math.round(current),
      previousAverage: Math.round(previous),
      growth: parseFloat(change.toFixed(1)),
      direction,
      confidence: 91,
      interpretation,
    };
  };

  const avg7_recent = getWindowAverage(7, 0);
  const avg7_prev = getWindowAverage(7, 7);
  const avg30_recent = getWindowAverage(30, 0);
  const avg30_prev = getWindowAverage(30, 30);
  const avg90_recent = getWindowAverage(90, 0);
  const avg90_prev = getWindowAverage(90, 90);

  return {
    trend7: computeTrend(avg7_recent, avg7_prev, 'the previous 7 days'),
    trend30: computeTrend(avg30_recent, avg30_prev, 'the previous 30 days'),
    trend90: computeTrend(avg90_recent, avg90_prev, 'the previous 90 days'),
  };
};

module.exports = { computeTrends };