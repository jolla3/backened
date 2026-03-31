const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Inventory = require('../models/inventory');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// ========================== CONFIGURATION (via env) ==========================
const ANOMALY_THRESHOLD = parseFloat(process.env.ANOMALY_THRESHOLD || '2.5');
const SMOOTHING_ALPHA = parseFloat(process.env.SMOOTHING_ALPHA || '0.2');

const STOCKOUT_WARNING_DAYS = parseInt(process.env.STOCKOUT_WARNING_DAYS || '14');
const STOCKOUT_CRITICAL_DAYS = parseInt(process.env.STOCKOUT_CRITICAL_DAYS || '7');
const STOCKOUT_ORDER_DAYS = parseInt(process.env.STOCKOUT_ORDER_DAYS || '14');

const DROPOUT_DAYS_THRESHOLD_1 = parseInt(process.env.DROPOUT_DAYS_THRESHOLD_1 || '30');
const DROPOUT_DAYS_THRESHOLD_2 = parseInt(process.env.DROPOUT_DAYS_THRESHOLD_2 || '60');
const DROPOUT_DECLINE_THRESHOLD_1 = parseFloat(process.env.DROPOUT_DECLINE_THRESHOLD_1 || '15');
const DROPOUT_DECLINE_THRESHOLD_2 = parseFloat(process.env.DROPOUT_DECLINE_THRESHOLD_2 || '30');
const DROPOUT_DECLINE_THRESHOLD_3 = parseFloat(process.env.DROPOUT_DECLINE_THRESHOLD_3 || '50');
const DROPOUT_DEBT_THRESHOLD_1 = parseFloat(process.env.DROPOUT_DEBT_THRESHOLD_1 || '2000');
const DROPOUT_DEBT_THRESHOLD_2 = parseFloat(process.env.DROPOUT_DEBT_THRESHOLD_2 || '5000');
const DROPOUT_PROBABILITY_SCALE = parseFloat(process.env.DROPOUT_PROBABILITY_SCALE || '10');

const MILK_FORECAST_DAYS = parseInt(process.env.MILK_FORECAST_DAYS || '7');
const MILK_FORECAST_LOWER_BOUND = parseFloat(process.env.MILK_FORECAST_LOWER_BOUND || '0.8');
const MILK_FORECAST_UPPER_BOUND = parseFloat(process.env.MILK_FORECAST_UPPER_BOUND || '1.2');

// ========================== HELPER FUNCTIONS ==========================
/**
 * Exponential smoothing forecast
 * @param {Array} data - sorted by date ascending
 * @param {number} alpha - smoothing factor
 * @returns {number} forecast for next period
 */
const exponentialSmoothing = (data, alpha) => {
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
 * @param {number} threshold - number of standard deviations
 * @returns {Array} indices of anomalous values
 */
const findAnomalies = (values, threshold) => {
  if (values.length < 2) return [];
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / values.length;
  const std = Math.sqrt(variance);
  if (std === 0) return [];
  return values.map((v, i) => (Math.abs(v - mean) / std > threshold) ? i : -1).filter(i => i !== -1);
};

// ========================== PUBLIC FUNCTIONS ==========================

/**
 * Predict stockout risk for feed products
 * Uses configurable thresholds for days until stockout.
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
    const forecastDaily = avgDailySales > 0 ? exponentialSmoothing(dailyValues, SMOOTHING_ALPHA) : avgDailySales;

    const daysUntilStockout = forecastDaily > 0 ? Math.floor(product.stock / forecastDaily) : null;
    if (daysUntilStockout !== null && daysUntilStockout <= STOCKOUT_WARNING_DAYS) {
      predictions.push({
        product: product.name,
        currentStock: product.stock,
        avgDailySales: avgDailySales.toFixed(1),
        forecastDaily: forecastDaily.toFixed(1),
        daysUntilStockout,
        risk: daysUntilStockout <= STOCKOUT_CRITICAL_DAYS ? 'critical' : 'high',
        recommendation: `Order ${Math.ceil(forecastDaily * STOCKOUT_ORDER_DAYS)} units to cover next ${STOCKOUT_ORDER_DAYS} days`,
        suggestedSupplier: product.supplier || 'main supplier',
      });
    }
  }

  return predictions.sort((a, b) => a.daysUntilStockout - b.daysUntilStockout);
};

/**
 * Predict farmer dropout using configurable thresholds for:
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
    const debt = Math.abs(farmer.farmer.balance || 0); // debt in actual currency

    // Logistic-like scoring using configurable thresholds
    let score = 0;
    if (daysSinceLast > DROPOUT_DAYS_THRESHOLD_2) score += 4;
    else if (daysSinceLast > DROPOUT_DAYS_THRESHOLD_1) score += 2;

    if (decline > DROPOUT_DECLINE_THRESHOLD_3) score += 3;
    else if (decline > DROPOUT_DECLINE_THRESHOLD_2) score += 2;
    else if (decline > DROPOUT_DECLINE_THRESHOLD_1) score += 1;

    if (debt > DROPOUT_DEBT_THRESHOLD_2) score += 3;
    else if (debt > DROPOUT_DEBT_THRESHOLD_1) score += 1;

    const probability = Math.min(100, Math.max(0, score * DROPOUT_PROBABILITY_SCALE));

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
 * Predict milk production trend for next N days (configurable)
 * Returns forecasted daily litres with confidence intervals.
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

  // Exponential smoothing forecast for MILK_FORECAST_DAYS
  let forecast = dailyLitres[dailyLitres.length - 1];
  const predictions = [];
  for (let i = 0; i < MILK_FORECAST_DAYS; i++) {
    forecast = SMOOTHING_ALPHA * dailyLitres[dailyLitres.length - 1] + (1 - SMOOTHING_ALPHA) * forecast;
    predictions.push({
      day: i + 1,
      forecast: Math.round(forecast),
      lowerBound: Math.max(0, Math.round(forecast * MILK_FORECAST_LOWER_BOUND)),
      upperBound: Math.round(forecast * MILK_FORECAST_UPPER_BOUND),
    });
  }

  // Detect anomalies in past 30 days
  const anomalies = findAnomalies(dailyLitres, ANOMALY_THRESHOLD);
  const anomalyDates = anomalies.map(idx => last30Days[idx]._id);

  const trend = dailyLitres.length > 1
    ? ((dailyLitres[dailyLitres.length-1] - dailyLitres[0]) / dailyLitres[0]) * 100
    : 0;

  return {
    historical: last30Days.map(d => ({ date: d._id, litres: d.litres })),
    forecast: predictions,
    anomalies: anomalyDates,
    trend,
  };
};

module.exports = { predictStockout, predictFarmerDropout, predictMilkProduction };