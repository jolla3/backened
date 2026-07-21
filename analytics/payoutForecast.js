// analytics/payoutForecast.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const RateVersion = require('../models/rateVersion');
const Transaction = require('../models/transaction');
const { getLatestBalances, getFarmerLifetimeLedger } = require('./financialAnalytics');
const logger = require('../utils/logger');

const linearRegression = (data) => {
  const n = data.length;
  if (n < 2) return { slope: 0, intercept: 0, r2: 0 };
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0, sumY2 = 0;
  for (let i = 0; i < n; i++) {
    const x = i;
    const y = data[i];
    sumX += x;
    sumY += y;
    sumXY += x * y;
    sumX2 += x * x;
    sumY2 += y * y;
  }
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;
  const ssTotal = sumY2 - (sumY * sumY) / n;
  const ssRes = data.reduce((sum, y, i) => {
    const pred = slope * i + intercept;
    return sum + (y - pred) ** 2;
  }, 0);
  const r2 = ssTotal > 0 ? 1 - ssRes / ssTotal : 0;
  return { slope, intercept, r2 };
};

const fillMissingMonths = (rawData, months = 12) => {
  const now = new Date();
  const result = [];
  const dataMap = new Map();
  for (const entry of rawData) {
    const key = `${entry._id.year}-${String(entry._id.month).padStart(2, '0')}`;
    dataMap.set(key, entry.totalLitres);
  }
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    result.push({
      month: key,
      litres: dataMap.get(key) || 0
    });
  }
  return result;
};

const computeSeasonalFactors = (historicalData) => {
  if (historicalData.length < 24) return null;
  const monthlyAverages = new Array(12).fill(0);
  const monthlyCounts = new Array(12).fill(0);
  for (const entry of historicalData) {
    const monthIndex = entry.month - 1;
    monthlyAverages[monthIndex] += entry.totalLitres;
    monthlyCounts[monthIndex]++;
  }
  for (let i = 0; i < 12; i++) {
    monthlyAverages[i] = monthlyCounts[i] > 0 ? monthlyAverages[i] / monthlyCounts[i] : 0;
  }
  const overallAvg = monthlyAverages.reduce((sum, v) => sum + v, 0) / 12;
  if (overallAvg === 0) return null;
  return monthlyAverages.map(avg => avg / overallAvg);
};

const getActiveFarmerChange = async (cooperativeId) => {
  const now = new Date();
  const thirtyDaysAgo = new Date(now);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const sixtyDaysAgo = new Date(now);
  sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);

  const result = await Transaction.aggregate([
    { $match: { type: 'milk', cooperativeId } },
    {
      $facet: {
        thirtyDays: [
          { $match: { timestamp_server: { $gte: thirtyDaysAgo } } },
          { $group: { _id: null, farmers: { $addToSet: '$farmer_id' } } }
        ],
        sixtyDays: [
          { $match: { timestamp_server: { $gte: sixtyDaysAgo, $lt: thirtyDaysAgo } } },
          { $group: { _id: null, farmers: { $addToSet: '$farmer_id' } } }
        ]
      }
    }
  ]);

  const farmers30 = result[0]?.thirtyDays[0]?.farmers?.length || 0;
  const farmers60 = result[0]?.sixtyDays[0]?.farmers?.length || 0;
  const changePercent = farmers60 > 0 ? ((farmers30 - farmers60) / farmers60) * 100 : 0;
  return { farmers30, farmers60, changePercent };
};

const getTotalDeductions = async (cooperativeId, farmerIds) => {
  if (!farmerIds || farmerIds.length === 0) return { totalFeedDebit: 0, totalLoans: 0, totalOther: 0 };
  const objectIds = farmerIds.map(id => new mongoose.Types.ObjectId(id));
  const result = await mongoose.model('Ledger').aggregate([
    {
      $match: {
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        farmerId: { $in: objectIds },
        type: { $in: ['FEED_DEBIT', 'LOAN', 'INTEREST', 'PENALTY', 'SETTLEMENT_DEBIT'] }
      }
    },
    {
      $group: {
        _id: '$type',
        total: { $sum: { $abs: '$amount' } }
      }
    }
  ]);
  let totalFeedDebit = 0, totalLoans = 0, totalOther = 0;
  for (const r of result) {
    if (r._id === 'FEED_DEBIT') totalFeedDebit = r.total;
    else if (r._id === 'LOAN') totalLoans = r.total;
    else if (r._id === 'INTEREST') totalLoans += r.total;
    else totalOther += r.total;
  }
  return { totalFeedDebit, totalLoans, totalOther };
};

const getPayoutForecast = async (cooperativeId) => {
  try {
    const now = new Date();
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');
    const payoutDay = cooperative.payout_day || 15;

    const balanceMap = await getLatestBalances(cooperativeId);
    let totalPositive = 0;
    const eligibleFarmers = [];
    const farmerIdsWithBalance = [];
    for (const [farmerId, balance] of balanceMap) {
      if (balance > 0) {
        totalPositive += balance;
        eligibleFarmers.push({ farmerId, balance });
        farmerIdsWithBalance.push(farmerId);
      }
    }

    const farmerObjectIds = farmerIdsWithBalance.map(id => new mongoose.Types.ObjectId(id));
    const deductions = await getTotalDeductions(cooperativeId, farmerObjectIds);

    const farmers = await Farmer.find({ _id: { $in: farmerIdsWithBalance } })
      .select('name farmer_code')
      .lean();
    const farmerMap = new Map(farmers.map(f => [f._id.toString(), f]));

    const topEligible = eligibleFarmers
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10)
      .map(f => {
        const farmer = farmerMap.get(f.farmerId) || {};
        return {
          name: farmer.name || 'Unknown',
          code: farmer.farmer_code || 'N/A',
          balance: Math.round(f.balance)
        };
      });

    const nextPayout = new Date(now);
    nextPayout.setDate(payoutDay);
    if (nextPayout <= now) nextPayout.setMonth(nextPayout.getMonth() + 1);

    const activeRateDoc = await RateVersion.findOne({
      cooperativeId,
      type: 'milk',
      effective_date: { $lte: now }
    }).sort({ effective_date: -1 }).lean();
    const milkRate = activeRateDoc?.rate || 0;

    const twentyFourMonthsAgo = new Date(now);
    twentyFourMonthsAgo.setMonth(twentyFourMonthsAgo.getMonth() - 24);
    const milkVolumesRaw = await Transaction.aggregate([
      {
        $match: {
          type: 'milk',
          cooperativeId,
          timestamp_server: { $gte: twentyFourMonthsAgo }
        }
      },
      {
        $group: {
          _id: { year: { $year: '$timestamp_server' }, month: { $month: '$timestamp_server' } },
          totalLitres: { $sum: '$litres' }
        }
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } }
    ]);

    const historicalMonths = fillMissingMonths(milkVolumesRaw, 6);

    let forecastLitres = 0;
    let forecastNetPayout = 0;
    let forecastGrossPayout = 0;
    let confidence = 0;
    let expectedGrowth = 0;
    let explanation = '';
    let hasEnoughData = false;

    const twelveMonthsFilled = fillMissingMonths(milkVolumesRaw, 12);
    const values = twelveMonthsFilled.map(m => m.litres);
    const nonZeroMonths = values.filter(v => v > 0).length;

    if (nonZeroMonths >= 4) {
      hasEnoughData = true;
      const monthsCount = values.length;
      const { slope, intercept, r2 } = linearRegression(values);

      let baseForecast = 0;
      if (r2 >= 0.6) {
        const nextIndex = monthsCount;
        baseForecast = slope * nextIndex + intercept;
        explanation = `Linear regression (R²=${r2.toFixed(2)}) suggests a ${slope > 0 ? 'rising' : 'falling'} trend.`;
      } else {
        const recent = values.slice(-3);
        baseForecast = recent.reduce((s, v) => s + v, 0) / recent.length;
        explanation = `Moving average of the last 3 months (R²=${r2.toFixed(2)} < 0.6).`;
      }

      const seasonalFactors = computeSeasonalFactors(milkVolumesRaw);
      let seasonalFactor = 1.0;
      if (seasonalFactors) {
        const currentMonth = now.getMonth();
        seasonalFactor = seasonalFactors[currentMonth] || 1.0;
        explanation += ` Seasonal adjustment: ${Math.round(seasonalFactor * 100)}% of average month.`;
      }

      forecastLitres = Math.max(0, baseForecast * seasonalFactor);

      const mean = values.reduce((a, b) => a + b, 0) / values.length;
      const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length;
      const stdDev = Math.sqrt(variance);
      const cv = mean > 0 ? (stdDev / mean) * 100 : 100;

      let confidenceScore = 70;
      if (r2 >= 0.7) confidenceScore += 20;
      else if (r2 >= 0.5) confidenceScore += 10;
      else confidenceScore -= 10;
      if (cv < 20) confidenceScore += 10;
      else if (cv > 50) confidenceScore -= 10;
      confidence = Math.min(95, Math.max(20, confidenceScore));

      if (values.length >= 2) {
        const prevMonth = values[values.length - 1];
        expectedGrowth = prevMonth > 0 ? ((forecastLitres - prevMonth) / prevMonth) * 100 : 0;
      }

      const { farmers30, farmers60, changePercent } = await getActiveFarmerChange(cooperativeId);
      if (changePercent < -20) {
        const dropFactor = 1 + (changePercent / 100);
        forecastLitres = forecastLitres * Math.max(0.7, dropFactor);
        explanation += ` Adjusted for ${Math.abs(Math.round(changePercent))}% drop in active farmers (${farmers30} vs ${farmers60}).`;
      }

      forecastGrossPayout = forecastLitres * milkRate;
      const totalDeductions = deductions.totalFeedDebit + deductions.totalLoans + deductions.totalOther;
      const avgDeductionPerFarmer = farmerIdsWithBalance.length > 0 ? totalDeductions / farmerIdsWithBalance.length : 0;
      forecastNetPayout = Math.max(0, forecastGrossPayout - (avgDeductionPerFarmer * (forecastLitres / 30)));
    } else {
      explanation = `Need at least 4 months with data. Found ${nonZeroMonths} month(s) with data.`;
    }

    return {
      currentLiability: Math.round(totalPositive),
      farmersToPay: eligibleFarmers.length,
      eligibleFarmers: topEligible,
      nextPayoutDate: nextPayout.toISOString().split('T')[0],
      payoutDay,
      forecastNetPayout: Math.round(forecastNetPayout),
      forecastGrossPayout: Math.round(forecastGrossPayout),
      forecastLitres: Math.round(forecastLitres),
      confidence: Math.round(confidence),
      expectedGrowth: parseFloat(expectedGrowth.toFixed(1)),
      explanation,
      hasEnoughData,
      totalFeedDebt: Math.round(deductions.totalFeedDebit),
      totalLoans: Math.round(deductions.totalLoans),
      totalOtherDeductions: Math.round(deductions.totalOther),
      activeRate: milkRate,
      payoutRateAssumed: milkRate > 0 ? `KES ${milkRate} per litre` : 'No active rate',
      historicalMonthlyLitres: historicalMonths,
      availableCash: null,
      shortfall: null,
    };
  } catch (error) {
    logger.error('PayoutForecast failed', { error: error.message, cooperativeId });
    return getDefaultPayoutForecast();
  }
};

const getDefaultPayoutForecast = () => ({
  currentLiability: 0,
  forecastNetPayout: 0,
  forecastGrossPayout: 0,
  forecastLitres: 0,
  farmersToPay: 0,
  eligibleFarmers: [],
  nextPayoutDate: null,
  payoutDay: 15,
  confidence: 0,
  expectedGrowth: 0,
  explanation: 'No data available',
  hasEnoughData: false,
  activeRate: 0,
  payoutRateAssumed: 'No active rate',
  historicalMonthlyLitres: [],
  totalFeedDebt: 0,
  totalLoans: 0,
  totalOtherDeductions: 0,
  availableCash: null,
  shortfall: null,
});

module.exports = { getPayoutForecast };