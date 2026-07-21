// services/farmerService.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const logger = require('../utils/logger');
const transactionService = require('./transactionService');

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Convert a farmer document to a clean profile object (no Mongo IDs)
 */
const toProfile = (farmer) => ({
  farmerCode: farmer.farmer_code,
  name: farmer.name,
  phone: farmer.phone,
  location: farmer.location || '',
  active: farmer.isActive !== false,
  createdAt: farmer.createdAt,
});

/**
 * Get all farmer balances in one aggregation (no N+1)
 */
const getAllBalances = async (cooperativeId) => {
  const result = await Ledger.aggregate([
    { $match: { cooperativeId: new mongoose.Types.ObjectId(cooperativeId) } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$farmerId', balance: { $first: '$runningBalance' } } },
  ]);
  const map = new Map();
  for (const r of result) {
    map.set(r._id.toString(), r.balance);
  }
  return map;
};

/**
 * Get a single farmer's current balance from Ledger (fastest)
 */
const getBalanceForFarmer = async (farmerId, cooperativeId) => {
  const result = await Ledger.findOne({
    cooperativeId,
    farmerId,
  })
    .sort({ timestamp: -1 })
    .lean();
  return result ? result.runningBalance : 0;
};

// ─── CRUD Operations ─────────────────────────────────────────────

const createFarmer = async (data, cooperativeId) => {
  const { cooperativeId: _, ...farmerData } = data;
  const farmer = await Farmer.create({
    ...farmerData,
    cooperativeId,
  });
  logger.info('Farmer created', { farmerCode: farmer.farmer_code, cooperativeId });
  return toProfile(farmer);
};

const getFarmer = async (farmerId, cooperativeId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }
  return toProfile(farmer);
};

const getFarmerByCode = async (farmerCode, cooperativeId) => {
  const farmer = await Farmer.findOne({ farmer_code: farmerCode });
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }
  return toProfile(farmer);
};

const updateFarmer = async (farmerId, data, cooperativeId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }

  const updated = await Farmer.findByIdAndUpdate(
    farmerId,
    { $set: data },
    { new: true, runValidators: true }
  );
  logger.info('Farmer updated', { farmerCode: updated.farmer_code, cooperativeId });
  return toProfile(updated);
};

const deleteFarmer = async (farmerId, cooperativeId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }
  await Farmer.findByIdAndDelete(farmerId);
  logger.info('Farmer deleted', { farmerId, cooperativeId });
  return { message: 'Farmer deleted successfully' };
};

// ─── List farmers with balances (ONE aggregation) ──────────────

const getAllFarmers = async (cooperativeId) => {
  const farmers = await Farmer.find({ cooperativeId })
    .sort({ createdAt: -1 })
    .lean();

  const balanceMap = await getAllBalances(cooperativeId);

  return farmers.map(f => {
    const balance = balanceMap.get(f._id.toString()) || 0;
    let status = 'SETTLED';
    if (balance > 0) status = 'PAYABLE';
    else if (balance < 0) status = 'OWES_COOPERATIVE';

    return {
      id: f._id, // ✅ Include ID for frontend
      farmerCode: f.farmer_code,
      name: f.name,
      phone: f.phone,
      location: f.location || '',
      active: f.isActive !== false,
      currentBalance: balance,
      status,
    };
  });
};

// ─── Get single farmer's balance ────────────────────────────────

const getBalance = async (farmerId, cooperativeId) => {
  if (!farmerId) throw new Error('Farmer ID is required');

  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }

  const balance = await getBalanceForFarmer(farmerId, cooperativeId);
  let status = 'SETTLED';
  if (balance > 0) status = 'PAYABLE';
  else if (balance < 0) status = 'OWES_COOPERATIVE';

  // Get lifetime metrics (from transactionService)
  const history = await transactionService.getFarmerHistory(
    farmer.farmer_code,
    1,
    cooperativeId
  );

  const summary = history.summary || {};

  return {
    farmerCode: farmer.farmer_code,
    farmerName: farmer.name,
    currentBalance: balance,
    status,
    milkIncome: summary.milkIncome || 0,
    feedCost: summary.feedCost || 0,
    lifetimeLitres: summary.lifetimeLitres || 0,
    netEarnings: summary.netEarnings || 0,
    deliveries: summary.deliveries || 0,
  };
};

// ─── Get farmer history ──────────────────────────────────────────

const getFarmerHistory = async (farmerId, cooperativeId, limit = 50) => {
  if (!farmerId) throw new Error('Farmer ID is required');

  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }

  // Use transactionService to get the full history
  const raw = await transactionService.getFarmerHistory(
    farmer.farmer_code,
    limit,
    cooperativeId
  );
  if (raw.error) throw new Error(raw.error);

  const summary = raw.summary || {};
  const transactions = raw.transactions || [];
  const ledgerHistory = raw.ledgerHistory || [];

  const profile = {
    farmerCode: farmer.farmer_code,
    name: farmer.name,
    phone: farmer.phone,
    location: farmer.location || '',
    active: farmer.isActive !== false,
  };

  const financial = {
    currentBalance: summary.currentBalance || 0,
    status: summary.status || 'SETTLED',
    lifetimeMilkIncome: summary.milkIncome || 0,
    totalFeedPurchases: summary.feedCost || 0,
    totalSettlements: summary.settlementDeductions || 0,
    netEarnings: summary.netEarnings || 0,
  };

  const production = {
    lifetimeLitres: summary.lifetimeLitres || 0,
    deliveries: summary.deliveries || 0,
    averageLitresPerDelivery: summary.averageLitresPerDelivery || 0,
    firstDelivery: summary.firstDelivery,
    lastDelivery: summary.lastDelivery,
  };

  const statement = ledgerHistory.map(entry => ({
    date: entry.date,
    type: entry.type,
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    description: entry.description || entry.reference || '',
  }));

  const cleanTransactions = transactions.map(t => ({
    receipt: t.receipt || '',
    date: t.date || t.timestamp_server,
    event: t.event || (t.type === 'milk' ? 'Milk Delivery' : 'Feed Purchase'),
    litres: t.litres || 0,
    quantity: t.quantity || 0,
    amount: t.amount || t.payout || t.cost || 0,
    paymentMethod: t.paymentMethod || 'balance',
    zone: t.zone || '',
    porter: t.porter || '',
  }));

  return {
    profile,
    financial,
    production,
    statement: statement.slice(0, limit),
    transactions: cleanTransactions.slice(0, limit),
  };
};

module.exports = {
  createFarmer,
  getFarmer,
  getFarmerByCode,
  updateFarmer,
  deleteFarmer,
  getAllFarmers,
  getBalance,
  getFarmerHistory,
};