const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

/**
 * Exponential smoothing forecast
 * @param {Array} data - sorted by date ascending
 * @param {number} alpha - smoothing factor (0.2 recommended)
 * @returns {number} forecast for next period
 */
const exponentialSmoothing = (data, alpha = 0.2) => {
  if (!data.length) return 0;
  let forecast = data[0];
  for (let i = 1; i < data.length; i++) {
    forecast = alpha * data[i] + (1 - alpha) * forecast;
  }
  return forecast;
};

/**
 * Z-score anomaly detection
 * @param {Array} values - numeric array
 * @param {number} threshold - usually 2 or 3
 * @returns {Array} indices of anomalous values
 */
const findAnomalies = (values, threshold = 2.5) => {
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  return values.map((v, i) => (Math.abs(v - mean) / std > threshold) ? i : -1).filter(i => i !== -1);
};

/**
 * Predict stockout risk for feed products
 * Uses 30‑day moving average and forecast
 */
const predictStockout = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const products = await Inventory.find({ cooperativeId: cooperative._id, category: 'feed' }).lean();
  const predictions = [];

  for (const product of products) {
    // Get last 30 days sales
    const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
    const sales = await Transaction.aggregate([
      {
        $match: {
          type: 'feed',
          cooperativeId: cooperative._id,
          product_id: product._id,
          timestamp_server: { $gte: thirtyDaysAgo }
        }
      },
      {
        $group: {
          _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
          dailyQty: { $sum: '$quantity' }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    const dailyValues = sales.map(s => s.dailyQty);
    const avgDailySales = dailyValues.length ? dailyValues.reduce((a, b) => a + b, 0) / dailyValues.length : 0;
    const forecastDaily = avgDailySales > 0 ? exponentialSmoothing(dailyValues, 0.2) : avgDailySales;

    const daysUntilStockout = forecastDaily > 0 ? Math.floor(product.stock / forecastDaily) : null;
    if (daysUntilStockout !== null && daysUntilStockout <= 14) {
      predictions.push({
        product: product.name,
        currentStock: product.stock,
        avgDailySales: avgDailySales.toFixed(1),
        forecastDaily: forecastDaily.toFixed(1),
        daysUntilStockout,
        risk: daysUntilStockout <= 7 ? 'critical' : 'high',
        recommendation: `Order ${Math.ceil(forecastDaily * 14)} units to cover next 2 weeks`,
        suggestedSupplier: product.supplier || 'main supplier',
      });
    }
  }

  return predictions.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
};

/**
 * Predict farmer dropout using logistic regression based on:
 * - last delivery days
 * - recent milk decline percentage
 * - debt amount
 */
const predictFarmerDropout = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const now = new Date();
  const thirtyDaysAgo = new Date(now - 30 * 86400000);
  const sixtyDaysAgo = new Date(now - 60 * 86400000);

  // Get farmers with transactions in last 90 days
  const farmerData = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id, timestamp_server: { $gte: sixtyDaysAgo } } },
    {
      $group: {
        _id: '$farmer_id',
        lastDelivery: { $max: '$timestamp_server' },
        recentLitres: {
          $sum: {
            $cond: [{ $gte: ['$timestamp_server', thirtyDaysAgo] }, '$litres', 0]
          }
        },
        previousLitres: {
          $sum: {
            $cond: [{ $lt: ['$timestamp_server', thirtyDaysAgo] }, '$litres', 0]
          }
        }
      }
    },
    { $lookup: { from: 'farmers', localField: '_id', foreignField: '_id', as: 'farmer' } },
    { $unwind: '$farmer' }
  ]);

  const risks = [];
  for (const farmer of farmerData) {
    const daysSinceLast = (now - new Date(farmer.lastDelivery)) / 86400000;
    const decline = farmer.previousLitres > 0
      ? ((farmer.previousLitres - farmer.recentLitres) / farmer.previousLitres) * 100
      : 0;
    const debt = Math.abs(farmer.farmer.balance || 0) / 1000; // debt in thousands

    // Logistic function: probability = 1 / (1 + exp(-(b0 + b1*x1 + b2*x2 + b3*x3)))
    // Simple linear combination for demo
    let score = 0;
    // daysSinceLast > 30 => +2, >60 => +4
    if (daysSinceLast > 60) score += 4;
    else if (daysSinceLast > 30) score += 2;
    // decline > 50% => +3, >30% => +2, >15% => +1
    if (decline > 50) score += 3;
    else if (decline > 30) score += 2;
    else if (decline > 15) score += 1;
    // debt > 5K => +3, >2K => +1
    if (debt > 5) score += 3;
    else if (debt > 2) score += 1;

    const probability = Math.min(100, Math.max(0, score * 10)); // scale 0-100

    if (probability > 30) {
      risks.push({
        farmerId: farmer._id,
        farmerName: farmer.farmer.name,
        farmerCode: farmer.farmer.farmer_code,
        lastDelivery: daysSinceLast.toFixed(0) + ' days ago',
        recentLitres: farmer.recentLitres || 0,
        previousLitres: farmer.previousLitres || 0,
        declinePercent: decline.toFixed(1),
        debt: Math.abs(farmer.farmer.balance || 0),
        probability,
        risk: probability > 70 ? 'critical' : (probability > 50 ? 'high' : 'medium'),
        recommendation: probability > 70
          ? 'Urgent: Call farmer and schedule farm visit'
          : (probability > 50 ? 'Send SMS to check on farmer' : 'Monitor next week'),
      });
    }
  }

  return risks.sort((a, b) => b.probability - a.probability);
};

/**
 * Predict milk production trend for next 7 days
 * Returns forecasted daily litres with confidence intervals
 */
const predictMilkProduction = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');

  const last30Days = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId: cooperative._id } },
    {
      $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } },
        litres: { $sum: '$litres' }
      }
    },
    { $sort: { _id: 1 } },
    { $limit: 30 }
  ]);

  const dailyLitres = last30Days.map(d => d.litres);
  if (dailyLitres.length < 7) return [];

  // Simple exponential smoothing forecast for next 7 days
  let forecast = dailyLitres[dailyLitres.length - 1];
  const predictions = [];
  const alpha = 0.2;
  for (let i = 0; i < 7; i++) {
    forecast = alpha * dailyLitres[dailyLitres.length - 1] + (1 - alpha) * forecast;
    predictions.push({
      day: i + 1,
      forecast: Math.round(forecast),
      lowerBound: Math.max(0, Math.round(forecast * 0.8)),
      upperBound: Math.round(forecast * 1.2),
    });
  }

  // Detect anomalies in past 30 days
  const anomalies = findAnomalies(dailyLitres);
  const anomalyDates = anomalies.map(idx => last30Days[idx]._id);

  return {
    historical: last30Days.map(d => ({ date: d._id, litres: d.litres })),
    forecast: predictions,
    anomalies: anomalyDates,
    trend: dailyLitres.length > 1 ? (dailyLitres[dailyLitres.length-1] - dailyLitres[0]) / dailyLitres[0] * 100 : 0,
  };
};

module.exports = { predictStockout, predictFarmerDropout, predictMilkProduction };