const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');

const getFarmerRisks = async () => {
  const farmers = await Farmer.find({});
  const risks = [];

  for (const farmer of farmers) {
    const lastDelivery = await Transaction.findOne({
      farmer_id: farmer._id,
      type: 'milk'
    }).sort({ timestamp_server: -1 });

    const debtLevel = Math.abs(farmer.balance) / 1000;
    const milkTrendDrop = 0; // Can be calculated from historical data

    // ✅ FIXED: Realistic risk score calculation
    const daysSince = lastDelivery 
      ? (Date.now() - new Date(lastDelivery.timestamp_server)) / 86400000 
      : 30;

    const riskScore = (daysSince * 0.5) + (debtLevel * 0.3) + (milkTrendDrop * 0.2);
    
    let risk = 'LOW';
    if (riskScore >= 81) risk = 'CRITICAL';
    else if (riskScore >= 61) risk = 'HIGH';
    else if (riskScore >= 31) risk = 'MEDIUM';

    if (risk !== 'LOW') {
      risks.push({
        farmer: farmer.name,
        lastDelivery: `${daysSince.toFixed(0)} days ago`,
        risk,
        riskScore: riskScore.toFixed(1),
        currentBalance: farmer.balance
      });
    }
  }

  return risks.sort((a, b) => b.riskScore - a.riskScore);
};

module.exports = { getFarmerRisks };