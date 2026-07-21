// analytics/farmerRisks.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const { getLatestBalances, getFarmerLifetimeLedger } = require('./financialAnalytics');
const logger = require('../utils/logger');

const calculateCV = (values) => {
  if (!values || values.length < 3) return null;
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  if (mean === 0) return null;
  const squaredDiffs = values.map(v => Math.pow(v - mean, 2));
  const variance = squaredDiffs.reduce((sum, v) => sum + v, 0) / values.length;
  const stdDev = Math.sqrt(variance);
  return (stdDev / mean) * 100;
};

const getFarmerRisks = async (cooperativeId) => {
  try {
    // ─── Convert to ObjectId once ──────────────────────────────
    const coopId = new mongoose.Types.ObjectId(cooperativeId);

    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(sevenDaysAgo.getDate() - 7);
    const fourteenDaysAgo = new Date(now);
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    const thirtyDaysAgo = new Date(now);
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const sixtyDaysAgo = new Date(now);
    sixtyDaysAgo.setDate(sixtyDaysAgo.getDate() - 60);
    const ninetyDaysAgo = new Date(now);
    ninetyDaysAgo.setDate(ninetyDaysAgo.getDate() - 90);

    // ─── Get balances and ledger ────────────────────────────────
    const balanceMap = await getLatestBalances(cooperativeId);
    const ledgerMap = await getFarmerLifetimeLedger(cooperativeId);

    // ─── Get farmer transaction summaries ──────────────────────
    const farmerData = await Transaction.aggregate([
      { $match: { type: 'milk', cooperativeId: coopId } },
      {
        $group: {
          _id: '$farmer_id',
          lastDelivery: { $max: '$timestamp_server' },
          totalLitres: { $sum: '$litres' },
          totalPayout: { $sum: '$payout' },
          transactionCount: { $sum: 1 },
          avgLitresPerDelivery: { $avg: '$litres' },
          litres30: {
            $sum: { $cond: [{ $gte: ['$timestamp_server', thirtyDaysAgo] }, '$litres', 0] }
          },
          litres60: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$timestamp_server', thirtyDaysAgo] }, { $gte: ['$timestamp_server', sixtyDaysAgo] }] },
                '$litres',
                0
              ]
            }
          },
          litres90: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$timestamp_server', sixtyDaysAgo] }, { $gte: ['$timestamp_server', ninetyDaysAgo] }] },
                '$litres',
                0
              ]
            }
          },
          deliveries30: {
            $sum: { $cond: [{ $gte: ['$timestamp_server', thirtyDaysAgo] }, 1, 0] }
          },
          deliveries60: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$timestamp_server', thirtyDaysAgo] }, { $gte: ['$timestamp_server', sixtyDaysAgo] }] },
                1,
                0
              ]
            }
          },
          deliveries90: {
            $sum: {
              $cond: [
                { $and: [{ $lt: ['$timestamp_server', sixtyDaysAgo] }, { $gte: ['$timestamp_server', ninetyDaysAgo] }] },
                1,
                0
              ]
            }
          },
          dailyLitres: {
            $push: {
              $cond: [
                { $gte: ['$timestamp_server', thirtyDaysAgo] },
                { litres: '$litres', day: { $dateToString: { format: '%Y-%m-%d', date: '$timestamp_server' } } },
                null
              ]
            }
          }
        }
      }
    ]);

    const farmerMap = new Map();
    for (const f of farmerData) {
      const dailyArray = f.dailyLitres.filter(d => d !== null);
      const dailyMap = {};
      for (const entry of dailyArray) {
        const day = entry.day;
        if (!dailyMap[day]) dailyMap[day] = 0;
        dailyMap[day] += entry.litres;
      }
      const dailyValues = Object.values(dailyMap);
      const cv = calculateCV(dailyValues);
      farmerMap.set(f._id.toString(), { ...f, cv });
    }

    // ─── Get all active farmers ────────────────────────────────
    const allFarmers = await Farmer.find({ cooperativeId: coopId, isActive: true }).lean();

    // Build farmer lookup map
    const farmerLookup = new Map();
    for (const f of allFarmers) {
      farmerLookup.set(f._id.toString(), f);
    }

    // ─── Build risks ─────────────────────────────────────────────
    const risks = [];

    for (const [id, farmer] of farmerLookup) {
      const stats = farmerMap.get(id) || {
        lastDelivery: null,
        totalLitres: 0,
        totalPayout: 0,
        transactionCount: 0,
        avgLitresPerDelivery: 0,
        litres30: 0,
        litres60: 0,
        litres90: 0,
        deliveries30: 0,
        deliveries60: 0,
        deliveries90: 0,
        cv: null
      };

      const balance = balanceMap.get(id) || 0;
      const ledger = ledgerMap.get(id) || { netValue: 0, feedDebits: 0, milkCredits: 0 };

      const daysSinceLastDelivery = stats.lastDelivery
        ? (Date.now() - new Date(stats.lastDelivery)) / 86400000
        : null;

      // Skip new farmers (< 30 days old, no deliveries)
      const farmerCreatedAt = farmer.createdAt || new Date(0);
      const daysSinceCreation = (Date.now() - new Date(farmerCreatedAt)) / 86400000;
      const isNewFarmer = daysSinceCreation < 30 && (stats.transactionCount === 0 || daysSinceLastDelivery === null);

      if (isNewFarmer) {
        risks.push({
          farmer: farmer.name,
          farmerCode: farmer.farmer_code,
          lastDelivery: 'New farmer',
          totalLitres: 0,
          currentBalance: Math.round(balance),
          overallRisk: 'LOW',
          overallScore: 0,
          operationalScore: 0,
          financialScore: 0,
          loyaltyScore: 0,
          valueScore: 0,
          churnProbability: 0,
          estimatedRevenueAtRisk: 0,
          recommendedAction: 'Monitor first 30 days',
          reasons: ['New farmer – building history'],
          operationalRisk: 'LOW',
          financialRisk: 'LOW'
        });
        continue;
      }

      // ─── Scoring ───────────────────────────────────────────────
      let riskScore = 0;
      const reasons = [];

      // 1. Inactivity
      if (daysSinceLastDelivery !== null) {
        if (daysSinceLastDelivery > 30) {
          riskScore += 4;
          reasons.push(`No delivery in ${Math.floor(daysSinceLastDelivery)} days`);
        } else if (daysSinceLastDelivery > 14) {
          riskScore += 2;
          reasons.push(`No delivery in ${Math.floor(daysSinceLastDelivery)} days`);
        } else if (daysSinceLastDelivery > 7) {
          riskScore += 1;
          reasons.push(`No delivery in ${Math.floor(daysSinceLastDelivery)} days`);
        }
      } else {
        riskScore += 4;
        reasons.push('Never delivered');
      }

      // 2. Declining production
      const avg30 = stats.deliveries30 > 0 ? stats.litres30 / stats.deliveries30 : 0;
      const avg60 = stats.deliveries60 > 0 ? stats.litres60 / stats.deliveries60 : 0;

      if (avg60 > 0 && avg30 < avg60 * 0.5) {
        riskScore += 4;
        reasons.push(`Milk dropped >50% vs previous month`);
      } else if (avg60 > 0 && avg30 < avg60 * 0.8) {
        riskScore += 2;
        reasons.push(`Milk dropped >20% vs previous month`);
      }

      // 3. Low delivery frequency
      if (stats.deliveries30 < 5) {
        riskScore += 3;
        reasons.push(`Only ${stats.deliveries30} deliveries in last 30 days`);
      } else if (stats.deliveries30 < 10) {
        riskScore += 1;
        reasons.push(`Only ${stats.deliveries30} deliveries in last 30 days`);
      }

      // 4. Inconsistent delivery
      if (stats.cv !== null) {
        if (stats.cv > 80) {
          riskScore += 2;
          reasons.push(`Highly inconsistent delivery (CV ${Math.round(stats.cv)}%)`);
        } else if (stats.cv > 60) {
          riskScore += 1;
          reasons.push(`Inconsistent delivery (CV ${Math.round(stats.cv)}%)`);
        }
      }

      // 5. Financial risk (debt)
      const debt = balance < 0 ? Math.abs(balance) : 0;
      if (debt > 10000) {
        riskScore += 4;
        reasons.push(`Debt: KES ${debt.toFixed(0)}`);
      } else if (debt > 5000) {
        riskScore += 2;
        reasons.push(`Debt: KES ${debt.toFixed(0)}`);
      } else if (debt > 1000) {
        riskScore += 1;
        reasons.push(`Debt: KES ${debt.toFixed(0)}`);
      }

      // 6. Negative net value
      if (ledger.netValue < -10000) {
        riskScore += 4;
        reasons.push(`Net loss: KES ${Math.abs(ledger.netValue).toFixed(0)}`);
      } else if (ledger.netValue < -5000) {
        riskScore += 2;
        reasons.push(`Net loss: KES ${Math.abs(ledger.netValue).toFixed(0)}`);
      } else if (ledger.netValue < -1000) {
        riskScore += 1;
        reasons.push(`Net loss: KES ${Math.abs(ledger.netValue).toFixed(0)}`);
      }

      // 7. High feed dependency
      const milkEarnings = ledger.milkCredits || 0;
      const feedSpent = ledger.feedDebits || 0;
      if (milkEarnings > 0 && feedSpent > milkEarnings * 0.5) {
        riskScore += 2;
        reasons.push(`High feed purchases (${Math.round(feedSpent/milkEarnings*100)}% of earnings)`);
      }

      riskScore = Math.min(riskScore, 12);

      let riskLevel = 'LOW';
      if (riskScore >= 9) riskLevel = 'CRITICAL';
      else if (riskScore >= 6) riskLevel = 'HIGH';
      else if (riskScore >= 3) riskLevel = 'MEDIUM';

      const operationalScore = Math.min(10, (riskScore * 0.6) + (stats.cv ? stats.cv / 10 : 0));
      const financialScore = Math.min(10, (debt / 2000) + (ledger.netValue < 0 ? Math.abs(ledger.netValue) / 2000 : 0));
      const loyaltyScore = Math.min(10, (stats.totalLitres / 1000) + (stats.transactionCount / 20));
      const valueScore = Math.min(10, stats.totalLitres / 5000);
      const churnProbability = Math.min(100, (riskScore / 12) * 70 + 20);
      const avgDaily = stats.litres30 > 0 ? stats.litres30 / Math.max(1, stats.deliveries30) : 0;
      const estimatedRevenueAtRisk = Math.round(avgDaily * 30 * 55);

      let recommendedAction = 'Monitor regularly';
      if (riskLevel === 'CRITICAL') {
        recommendedAction = 'Immediate intervention required. Visit farmer within 48 hours.';
      } else if (riskLevel === 'HIGH') {
        recommendedAction = 'Contact farmer within 7 days to discuss performance.';
      } else if (riskLevel === 'MEDIUM') {
        recommendedAction = 'Check in with farmer via SMS or phone call.';
      }

      risks.push({
        farmer: farmer.name,
        farmerCode: farmer.farmer_code,
        lastDelivery: stats.lastDelivery ? `${Math.floor(daysSinceLastDelivery)} days ago` : 'Never',
        totalLitres: Math.round(stats.totalLitres || 0),
        currentBalance: Math.round(balance),
        overallRisk: riskLevel,
        overallScore: parseFloat(riskScore.toFixed(1)),
        operationalScore: parseFloat(operationalScore.toFixed(1)),
        financialScore: parseFloat(financialScore.toFixed(1)),
        loyaltyScore: parseFloat(loyaltyScore.toFixed(1)),
        valueScore: parseFloat(valueScore.toFixed(1)),
        churnProbability: Math.round(churnProbability),
        estimatedRevenueAtRisk,
        recommendedAction,
        reasons: reasons.slice(0, 5),
        operationalRisk: operationalScore > 5 ? 'HIGH' : (operationalScore > 3 ? 'MEDIUM' : 'LOW'),
        financialRisk: financialScore > 5 ? 'HIGH' : (financialScore > 3 ? 'MEDIUM' : 'LOW')
      });
    }

    return risks.sort((a, b) => b.overallScore - a.overallScore);
  } catch (error) {
    logger.error('FarmerRisks failed', { error: error.message, cooperativeId });
    return [];
  }
};

module.exports = { getFarmerRisks };