// analytics/engines/forecastEngine.js
const { safeNumber } = require('../utils/formatters');

/**
 * Simple rolling average forecast.
 * Returns forecast for next period and confidence.
 */
const rollingAverage = (values, window = 3) => {
  if (values.length < window) return { forecast: null, confidence: 0 };
  const recent = values.slice(-window);
  const avg = recent.reduce((s, v) => s + v, 0) / recent.length;
  const mean = avg;
  const variance = recent.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / recent.length;
  const std = Math.sqrt(variance);
  const cv = mean > 0 ? (std / mean) * 100 : 100;
  const confidence = Math.min(95, Math.max(20, 80 - cv));
  return { forecast: avg, confidence: Math.round(confidence) };
};

/**
 * Weighted average: recent days weighted more heavily.
 * weights: [0.5, 0.3, 0.2] for last week, previous week, previous month.
 */
const weightedAverage = (dailyAggregates) => {
  // Need at least 30 days
  if (dailyAggregates.length < 30) return null;
  const last7 = dailyAggregates.slice(-7);
  const prev7 = dailyAggregates.slice(-14, -7);
  const prev30 = dailyAggregates.slice(-30);
  const avg7 = last7.reduce((s, d) => s + d.litres, 0) / last7.length;
  const avgPrev7 = prev7.reduce((s, d) => s + d.litres, 0) / prev7.length;
  const avgPrev30 = prev30.reduce((s, d) => s + d.litres, 0) / prev30.length;
  return (avg7 * 0.5) + (avgPrev7 * 0.3) + (avgPrev30 * 0.2);
};

const computeForecast = (context, financial) => {
  const { dailyAggregates, activeRate, now } = context;
  const daysAvailable = dailyAggregates ? dailyAggregates.length : 0;

  // ─── Availability info ────────────────────────────────────────
  const availability = {
    available: false,
    reason: `Only ${daysAvailable} collection days recorded.`,
    required: 7,
    current: daysAvailable,
  };

  let dailyForecast = null;
  let weeklyForecast = null;
  let monthlyForecast = null;
  let seasonalForecast = null;
  let bestForecast = null;

  // ─── LEVEL 1: Daily forecast (7-30 days) ────────────────────
  if (daysAvailable >= 7) {
    const last7 = dailyAggregates.slice(-7);
    const values = last7.map(d => d.litres);
    const { forecast, confidence } = rollingAverage(values, 3);
    if (forecast !== null) {
      dailyForecast = {
        forecastTomorrow: Math.round(forecast),
        confidence,
        basedOnDays: last7.length,
        interpretation: `Based on the last ${last7.length} days, tomorrow's milk is estimated at ${Math.round(forecast)}L.`,
      };
      bestForecast = dailyForecast;
    }
  }

  // ─── LEVEL 2: Weekly forecast (30-90 days) ──────────────────
  if (daysAvailable >= 30) {
    const weightedAvg = weightedAverage(dailyAggregates);
    if (weightedAvg !== null) {
      const forecast = weightedAvg;
      // Confidence based on variance of last 30 days
      const last30 = dailyAggregates.slice(-30);
      const values = last30.map(d => d.litres);
      const mean = values.reduce((s, v) => s + v, 0) / values.length;
      const variance = values.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / values.length;
      const std = Math.sqrt(variance);
      const cv = mean > 0 ? (std / mean) * 100 : 100;
      const confidence = Math.min(95, Math.max(20, 80 - cv));
      weeklyForecast = {
        forecastNextWeek: Math.round(forecast * 7),
        confidence,
        basedOnDays: last30.length,
        interpretation: `Based on weighted average of last 30 days, next week's total is estimated at ${Math.round(forecast * 7)}L.`,
      };
      bestForecast = weeklyForecast;
    }
  }

  // ─── LEVEL 3: Monthly forecast (90+ days) ────────────────────
  if (daysAvailable >= 90) {
    const last90 = dailyAggregates.slice(-90);
    const values = last90.map(d => d.litres);
    const { forecast, confidence } = rollingAverage(values, 30);
    if (forecast !== null) {
      monthlyForecast = {
        forecastNextMonth: Math.round(forecast * 30),
        confidence,
        basedOnDays: last90.length,
        interpretation: `Based on the last ${last90.length} days, next month's total is estimated at ${Math.round(forecast * 30)}L.`,
      };
      bestForecast = monthlyForecast;
    }
  }

  // ─── LEVEL 4: Seasonal forecast (365+ days) ──────────────────
  if (daysAvailable >= 365) {
    const monthMap = {};
    for (const d of dailyAggregates) {
      const m = new Date(d.date).getMonth();
      if (!monthMap[m]) monthMap[m] = [];
      monthMap[m].push(d.litres);
    }
    const monthlyAvgs = Object.keys(monthMap).map(m => ({
      month: parseInt(m),
      avg: monthMap[m].reduce((s, v) => s + v, 0) / monthMap[m].length
    }));
    const overallAvg = monthlyAvgs.reduce((s, m) => s + m.avg, 0) / monthlyAvgs.length;
    const currentMonth = new Date(now).getMonth();
    const currentAvg = monthMap[currentMonth] ? monthMap[currentMonth].reduce((s, v) => s + v, 0) / monthMap[currentMonth].length : overallAvg;
    const seasonalFactor = overallAvg > 0 ? currentAvg / overallAvg : 1;
    const forecast = Math.round(currentAvg * seasonalFactor * 30);
    seasonalForecast = {
      forecastNextMonth: forecast,
      confidence: 70,
      basedOnMonths: Object.keys(monthMap).length,
      interpretation: `Seasonal forecast for next month: ${forecast}L (based on ${Object.keys(monthMap).length} months of history).`,
    };
    bestForecast = seasonalForecast;
  }

  // ─── Update availability ──────────────────────────────────────
  if (bestForecast) {
    availability.available = true;
    availability.reason = `Forecast available (based on ${daysAvailable} days).`;
  } else if (daysAvailable >= 7) {
    availability.reason = `Forecast unavailable due to insufficient history (need 7 days, have ${daysAvailable}).`;
  }

  // ─── Use best available forecast ─────────────────────────────
  const forecastLitres = bestForecast?.forecastNextMonth || bestForecast?.forecastNextWeek || bestForecast?.forecastTomorrow || null;
  const confidence = bestForecast?.confidence || null;
  const explanation = bestForecast?.interpretation || availability.reason;

  // ─── Historical monthly litres ──────────────────────────────
  const historical = [];
  if (dailyAggregates && dailyAggregates.length > 0) {
    const monthMap = {};
    for (const d of dailyAggregates) {
      const key = d.date.slice(0, 7);
      if (!monthMap[key]) monthMap[key] = 0;
      monthMap[key] += d.litres;
    }
    const sorted = Object.keys(monthMap).sort();
    for (const key of sorted) {
      historical.push({
        month: key.slice(5),
        litres: Math.round(monthMap[key]),
      });
    }
  }

  const currentLiability = safeNumber(financial.amountToPayFarmers);
  const farmersToPay = financial.farmersToPay || 0;

  // ─── Operational forecast (tomorrow value, feed demand) ──────
  let tomorrowMilk = null;
  let tomorrowValue = null;
  let tomorrowFeedDemand = null;
  if (dailyForecast) {
    tomorrowMilk = dailyForecast.forecastTomorrow;
    tomorrowValue = Math.round(tomorrowMilk * activeRate);
    // Very rough feed demand: assume 1 bag per 100L (placeholder)
    tomorrowFeedDemand = Math.round(tomorrowMilk / 100);
  }

  return {
    // Availability
    forecastAvailable: availability,
    // Current liability
    currentLiability,
    farmersToPay,
    // Forecasts
    dailyForecast,
    weeklyForecast,
    monthlyForecast,
    seasonalForecast,
    // Best available
    forecastLitres,
    confidence,
    explanation,
    hasEnoughData: dailyForecast !== null,
    activeRate,
    historicalMonthlyLitres: historical.slice(-6),
    daysAvailable,
    // Operational forecasts
    tomorrowMilk,
    tomorrowValue,
    tomorrowFeedDemand,
  };
};

module.exports = { computeForecast };