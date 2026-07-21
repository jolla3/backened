// analytics/engines/anomalyEngine.js
const computeAnomalies = (context) => {
  const { dailyAggregates, today } = context;

  const availableDays = dailyAggregates?.length || 0;
  const requiredDays = 30;

  if (availableDays < requiredDays) {
    return {
      hasAnomaly: false,
      expectedMilk: null,
      actualMilk: null,
      deviation: null,
      severity: 'unknown',
      interpretation: `Insufficient data to detect anomalies (need ${requiredDays} days, have ${availableDays})`,
      requiredDays,
      availableDays,
    };
  }

  const todayStr = today.toISOString().split('T')[0];
  const todayData = dailyAggregates.find(d => d.date === todayStr);
  if (!todayData) {
    return {
      hasAnomaly: false,
      expectedMilk: null,
      actualMilk: 0,
      deviation: null,
      severity: 'normal',
      interpretation: 'No data for today yet',
      requiredDays,
      availableDays,
    };
  }

  const last30 = dailyAggregates.slice(-30);
  const avg = last30.reduce((s, d) => s + d.litres, 0) / last30.length;
  const std = Math.sqrt(last30.reduce((s, d) => s + Math.pow(d.litres - avg, 2), 0) / last30.length);

  const deviation = std > 0 ? ((todayData.litres - avg) / std) : 0;
  const isAnomaly = Math.abs(deviation) > 2.5;

  let severity = 'normal';
  let interpretation = `Today's collection (${todayData.litres}L) is within expected range (average ${Math.round(avg)}L).`;
  if (isAnomaly) {
    if (deviation > 0) {
      severity = 'high';
      interpretation = `Today's collection (${todayData.litres}L) is significantly ABOVE average (${Math.round(avg)}L).`;
    } else {
      severity = 'critical';
      interpretation = `Today's collection (${todayData.litres}L) is significantly BELOW average (${Math.round(avg)}L). Investigate immediately.`;
    }
  }

  return {
    hasAnomaly: isAnomaly,
    expectedMilk: Math.round(avg),
    actualMilk: todayData.litres,
    deviation: parseFloat(deviation.toFixed(2)),
    severity,
    interpretation,
    requiredDays,
    availableDays,
  };
};

module.exports = { computeAnomalies };