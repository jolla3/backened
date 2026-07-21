// services/monitoring/alerts.js
const mongoose = require('mongoose');
const Transaction = require('../../models/transaction');
const Farmer = require('../../models/farmer');
const Porter = require('../../models/porter');

const getAlerts = async (cooperativeId) => {
  const alerts = [];
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  // 1. Zone production drop
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  const [todayZones, yesterdayZones] = await Promise.all([
    Transaction.aggregate([
      {
        $match: {
          cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
          type: 'milk',
          timestamp_server: { $gte: today },
        },
      },
      {
        $group: {
          _id: '$zone',
          litres: { $sum: '$litres' },
        },
      },
    ]),
    Transaction.aggregate([
      {
        $match: {
          cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
          type: 'milk',
          timestamp_server: { $gte: yesterday, $lt: today },
        },
      },
      {
        $group: {
          _id: '$zone',
          litres: { $sum: '$litres' },
        },
      },
    ]),
  ]);

  const zoneMap = {};
  yesterdayZones.forEach(z => { zoneMap[z._id] = z.litres; });
  todayZones.forEach(z => {
    const yesterdayVal = zoneMap[z._id] || 0;
    if (yesterdayVal > 0) {
      const drop = ((yesterdayVal - z.litres) / yesterdayVal) * 100;
      if (drop > 30) {
        alerts.push({
          type: 'zone_drop',
          severity: 'warning',
          message: `Zone ${z._id || 'Unassigned'} production dropped ${Math.round(drop)}% compared to yesterday`,
          zone: z._id,
          dropPercent: Math.round(drop),
          timestamp: new Date(),
        });
      }
    }
  });

  // 2. Farmer inactivity (5 days)
  const fiveDaysAgo = new Date(today);
  fiveDaysAgo.setDate(fiveDaysAgo.getDate() - 5);

  const activeFarmers = await Transaction.distinct('farmer_id', {
    cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
    type: 'milk',
    timestamp_server: { $gte: fiveDaysAgo },
  });

  const allFarmers = await Farmer.find({ cooperativeId, isActive: true }).select('_id name');
  allFarmers.forEach(f => {
    if (!activeFarmers.includes(f._id)) {
      alerts.push({
        type: 'farmer_inactive',
        severity: 'medium',
        message: `Farmer ${f.name} has not delivered in 5 days`,
        farmerId: f._id,
        farmerName: f.name,
        timestamp: new Date(),
      });
    }
  });

  // 3. Porter low collection
  const porters = await Porter.find({ cooperativeId, isActive: true });
  const porterStats = await Transaction.aggregate([
    {
      $match: {
        cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
        type: 'milk',
        timestamp_server: { $gte: today },
      },
    },
    {
      $group: {
        _id: '$porter_id',
        litres: { $sum: '$litres' },
        transactions: { $sum: 1 },
      },
    },
  ]);

  const porterMap = {};
  porterStats.forEach(p => { porterMap[p._id.toString()] = p.litres; });

  const totalLitres = porterStats.reduce((s, p) => s + p.litres, 0);
  const avgPorterLitres = porters.length > 0 ? totalLitres / porters.length : 0;

  porters.forEach(p => {
    const litres = porterMap[p._id.toString()] || 0;
    if (litres < avgPorterLitres * 0.5 && avgPorterLitres > 0) {
      alerts.push({
        type: 'porter_low',
        severity: 'medium',
        message: `Porter ${p.name} collected ${Math.round(litres)}L today, below average (${Math.round(avgPorterLitres)}L)`,
        porterId: p._id,
        porterName: p.name,
        timestamp: new Date(),
      });
    }
  });

  // 4. Session imbalance
  const [morning, afternoon] = await Promise.all([
    Transaction.aggregate([
      {
        $match: {
          cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
          type: 'milk',
          timestamp_server: { $gte: today },
          $expr: { $lt: [{ $hour: '$timestamp_server' }, 12] },
        },
      },
      { $group: { _id: null, litres: { $sum: '$litres' } } },
    ]),
    Transaction.aggregate([
      {
        $match: {
          cooperativeId: new mongoose.Types.ObjectId(cooperativeId),
          type: 'milk',
          timestamp_server: { $gte: today },
          $expr: { $gte: [{ $hour: '$timestamp_server' }, 12] },
        },
      },
      { $group: { _id: null, litres: { $sum: '$litres' } } },
    ]),
  ]);

  const morningLitres = morning[0]?.litres || 0;
  const afternoonLitres = afternoon[0]?.litres || 0;
  const total = morningLitres + afternoonLitres;

  if (total > 0) {
    const morningPct = (morningLitres / total) * 100;
    const afternoonPct = (afternoonLitres / total) * 100;
    if (Math.abs(morningPct - afternoonPct) > 30) {
      alerts.push({
        type: 'session_imbalance',
        severity: 'info',
        message: `Morning (${Math.round(morningPct)}%) vs Afternoon (${Math.round(afternoonPct)}%) imbalance`,
        timestamp: new Date(),
      });
    }
  }

  // Sort by severity
  const severityOrder = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
};

module.exports = { getAlerts };