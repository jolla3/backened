// analytics/engines/farmerEngine.js
const computeFarmerValue = (context) => {
  const { farmerBalances, milkTransactions, ledgerEntries, farmerMap, now, thirtyDaysAgo } = context;

  // Lifetime litres per farmer
  const litresMap = {};
  for (const t of milkTransactions) {
    const id = t.farmer_id.toString();
    litresMap[id] = (litresMap[id] || 0) + (t.litres || 0);
  }

  // Lifetime ledger per farmer
  const ledgerMap = {};
  for (const e of ledgerEntries) {
    const id = e.farmerId.toString();
    if (!ledgerMap[id]) ledgerMap[id] = { milkCredits: 0, feedDebits: 0, netValue: 0 };
    if (e.type === 'MILK_CREDIT') {
      ledgerMap[id].milkCredits += e.amount;
    } else if (e.type === 'FEED_DEBIT') {
      ledgerMap[id].feedDebits += Math.abs(e.amount);
    }
    ledgerMap[id].netValue = (ledgerMap[id].milkCredits || 0) - (ledgerMap[id].feedDebits || 0);
  }

  // Recent 30 days litres
  const recentLitres = {};
  for (const t of milkTransactions) {
    if (t.timestamp_server >= thirtyDaysAgo) {
      const id = t.farmer_id.toString();
      recentLitres[id] = (recentLitres[id] || 0) + (t.litres || 0);
    }
  }

  const result = [];
  for (const [id, farmer] of farmerMap) {
    const balance = farmerBalances.get(id) || 0;
    const lifetimeLitres = litresMap[id] || 0;
    const ledger = ledgerMap[id] || { milkCredits: 0, feedDebits: 0, netValue: 0 };
    const netValue = ledger.netValue || 0;
    const recent = recentLitres[id] || 0;

    let valueTier = '';
    if (netValue > 50000) valueTier = 'High Value';
    else if (netValue > 10000) valueTier = 'Loyal';
    else if (netValue > 1000) valueTier = 'Growing';
    else if (netValue > 0) valueTier = 'New';
    else valueTier = 'Inactive';

    // Determine if improved or declining (compare recent vs lifetime average)
    const lifetimeAvg = lifetimeLitres / Math.max(1, milkTransactions.filter(t => t.farmer_id.toString() === id).length);
    const status = recent > lifetimeAvg * 1.2 ? 'improving' : recent < lifetimeAvg * 0.8 ? 'declining' : 'stable';

    result.push({
      farmer: farmer.name,
      code: farmer.farmer_code,
      lifetimeMilk: Math.round(lifetimeLitres),
      lifetimeEarnings: Math.round(ledger.milkCredits || 0),
      lifetimeFeedPurchased: Math.round(ledger.feedDebits || 0),
      netValue: Math.round(netValue),
      currentBalance: Math.round(balance),
      valueTier,
      status,
      recentLitres: Math.round(recent),
    });
  }

  return result.sort((a, b) => b.netValue - a.netValue);
};

const computeFarmerRisks = (context) => {
  const { farmerBalances, milkTransactions, farmerMap, now, thirtyDaysAgo, sixtyDaysAgo } = context;

  const farmerStats = {};
  for (const t of milkTransactions) {
    const id = t.farmer_id.toString();
    if (!farmerStats[id]) {
      farmerStats[id] = { lastDelivery: null, litres30: 0, litres60: 0, totalLitres: 0, transactions: 0, recentTx: 0 };
    }
    const stats = farmerStats[id];
    const ts = t.timestamp_server;
    stats.totalLitres += t.litres || 0;
    stats.transactions++;
    if (!stats.lastDelivery || ts > stats.lastDelivery) stats.lastDelivery = ts;
    if (ts >= thirtyDaysAgo) {
      stats.litres30 += t.litres || 0;
      stats.recentTx++;
    } else if (ts >= sixtyDaysAgo) {
      stats.litres60 += t.litres || 0;
    }
  }

  const risks = [];
  for (const [id, farmer] of farmerMap) {
    const stats = farmerStats[id] || { lastDelivery: null, litres30: 0, litres60: 0, totalLitres: 0, transactions: 0 };
    const balance = farmerBalances.get(id) || 0;

    const daysSinceLast = stats.lastDelivery ? (Date.now() - new Date(stats.lastDelivery)) / 86400000 : null;
    let riskScore = 0;
    const reasons = [];

    // Inactivity
    if (daysSinceLast !== null) {
      if (daysSinceLast > 30) { riskScore += 4; reasons.push(`Inactive ${Math.floor(daysSinceLast)} days`); }
      else if (daysSinceLast > 14) { riskScore += 2; reasons.push(`Inactive ${Math.floor(daysSinceLast)} days`); }
      else if (daysSinceLast > 7) { riskScore += 1; reasons.push(`Inactive ${Math.floor(daysSinceLast)} days`); }
    } else {
      riskScore += 4;
      reasons.push('Never delivered');
    }

    // Production drop
    const avg30 = stats.litres30 / Math.max(1, stats.recentTx);
    const avg60 = stats.litres60 / Math.max(1, stats.transactions - stats.recentTx);
    if (avg60 > 0 && avg30 < avg60 * 0.5) { riskScore += 4; reasons.push('>50% drop in production'); }
    else if (avg60 > 0 && avg30 < avg60 * 0.8) { riskScore += 2; reasons.push('>20% drop in production'); }

    // Debt
    const debt = balance < 0 ? Math.abs(balance) : 0;
    if (debt > 10000) { riskScore += 4; reasons.push(`Debt: KES ${debt.toFixed(0)}`); }
    else if (debt > 5000) { riskScore += 2; reasons.push(`Debt: KES ${debt.toFixed(0)}`); }
    else if (debt > 1000) { riskScore += 1; reasons.push(`Debt: KES ${debt.toFixed(0)}`); }

    // Low frequency
    if (stats.transactions < 5) { riskScore += 3; reasons.push('Low delivery frequency'); }

    let riskLevel = 'LOW';
    if (riskScore >= 9) riskLevel = 'CRITICAL';
    else if (riskScore >= 6) riskLevel = 'HIGH';
    else if (riskScore >= 3) riskLevel = 'MEDIUM';

    // Categories for farmer intelligence
    const isHighValue = stats.totalLitres > 10000;
    const isLoyal = stats.transactions > 100;
    const isDeclining = avg60 > 0 && avg30 < avg60 * 0.7;
    const isImproved = avg60 > 0 && avg30 > avg60 * 1.3;
    const isDebtor = balance < -5000;
    const highFeedDependency = (balance < -5000 && stats.totalLitres > 0); // placeholder

    risks.push({
      farmer: farmer.name,
      farmerCode: farmer.farmer_code,
      lastDelivery: daysSinceLast !== null ? `${Math.floor(daysSinceLast)} days ago` : 'Never',
      totalLitres: Math.round(stats.totalLitres),
      currentBalance: Math.round(balance),
      overallRisk: riskLevel,
      overallScore: riskScore,
      reasons: reasons.slice(0, 3),
      churnProbability: Math.min(100, riskScore * 8 + 10),
      recommendedAction: riskLevel === 'CRITICAL' ? 'Visit farmer within 48 hours' :
                         riskLevel === 'HIGH' ? 'Contact within 7 days' :
                         'Monitor regularly',
      // Categories
      isHighValue,
      isLoyal,
      isDeclining,
      isImproved,
      isDebtor,
      highFeedDependency,
    });
  }

  return risks.sort((a, b) => b.overallScore - a.overallScore);
};


// analytics/engines/farmerEngine.js – add at bottom
const computeFarmerRetention = (context) => {
  const { farmers, milkTransactions, now, thirtyDaysAgo, sixtyDaysAgo } = context;

  const activeFarmers = farmers.filter(f => f.isActive !== false);
  const allActiveIds = new Set(activeFarmers.map(f => f._id.toString()));

  const recentTx = milkTransactions.filter(t => t.timestamp_server >= thirtyDaysAgo);
  const recentFarmerIds = new Set(recentTx.map(t => t.farmer_id.toString()));

  const previousTx = milkTransactions.filter(t => t.timestamp_server >= sixtyDaysAgo && t.timestamp_server < thirtyDaysAgo);
  const previousFarmerIds = new Set(previousTx.map(t => t.farmer_id.toString()));

  const retained = new Set([...recentFarmerIds].filter(id => previousFarmerIds.has(id)));
  const lost = new Set([...previousFarmerIds].filter(id => !recentFarmerIds.has(id)));
  const reactivated = new Set([...recentFarmerIds].filter(id => previousFarmerIds.has(id) === false && allActiveIds.has(id)));
  const inactive = new Set([...allActiveIds].filter(id => !recentFarmerIds.has(id)));

  return {
    activeFarmers: allActiveIds.size,
    inactiveFarmers: inactive.size,
    deliveredLast30: recentFarmerIds.size,
    deliveredPrevious30: previousFarmerIds.size,
    retained: retained.size,
    lost: lost.size,
    reactivated: reactivated.size,
    retentionRate: previousFarmerIds.size > 0 ? (retained.size / previousFarmerIds.size) * 100 : 0,
  };
};

module.exports = { computeFarmerValue, computeFarmerRisks, computeFarmerRetention };