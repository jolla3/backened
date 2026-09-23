// services/farmerService.js
const mongoose = require('mongoose');
const Farmer = require('../models/farmer');
const Ledger = require('../models/ledger');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');
const transactionService = require('./transactionService');

// ─── Helpers ──────────────────────────────────────────────────────

/**
 * Convert a farmer document to a clean profile object (no Mongo IDs)
 */
const toProfile = (farmer) => ({
  id: farmer._id,
  farmerCode: farmer.farmer_code,
  name: farmer.name,
  phone: farmer.phone,
  location: farmer.location || '',
  active: farmer.isActive !== false,
  createdAt: farmer.createdAt,
  bankName: farmer.bankName || '',
  accountNumber: farmer.accountNumber || '',
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

const ALLOWED_UPDATE_FIELDS = [
  'name',
  'phone',
  'location',
  'branch_id',
  'farmer_code',
  'isActive',
  'zoneId',
  'zoneName',
  'bankName',
  'accountNumber',
];

const updateFarmer = async (farmerId, data, cooperativeId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }

  const safe = {};
  for (const key of ALLOWED_UPDATE_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      safe[key] = data[key];
    }
  }

  // Keep account numbers as strings (preserve leading zeros)
  if (safe.accountNumber != null) {
    safe.accountNumber = String(safe.accountNumber).trim();
  }
  if (safe.bankName != null) {
    safe.bankName = String(safe.bankName).trim();
  }

  const updated = await Farmer.findByIdAndUpdate(
    farmerId,
    { $set: safe },
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
      zoneName: f.zoneName || '',
      branchId: f.branch_id || '',
      active: f.isActive !== false,
      currentBalance: balance,
      status,
      bankName: f.bankName || '',
      accountNumber: f.accountNumber || '',
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
  };
};

/**
 * Farmer history for API — delegates to transactionService (Ledger = money source).
 * Maps result into the shape the Farmers UI expects.
 */
const getFarmerHistory = async (farmerId, cooperativeId, options = {}) => {
  if (!farmerId) throw new Error('Farmer ID is required');

  const {
    startDate = null,
    endDate = null,
    limit = 100,
  } = options;

  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  if (farmer.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized');
  }

  const raw = await transactionService.getFarmerHistory(farmer.farmer_code, {
    limit,
    startDate,
    endDate,
    cooperativeId,
  });

  if (raw.error) throw new Error(raw.error);

  const summary = raw.summary || {};
  const ledgerHistory = (raw.ledgerHistory || []).map((entry) => ({
    id: entry.id,
    date: entry.date,
    type: entry.type,
    label: entry.label || entry.type,
    amount: entry.amount,
    balanceAfter: entry.balanceAfter,
    description: entry.description || '',
    reference: entry.reference || '',
    isCredit: entry.amount > 0,
  }));

  return {
    profile: {
      farmerCode: farmer.farmer_code,
      name: farmer.name,
      phone: farmer.phone,
      location: farmer.location || '',
      active: farmer.isActive !== false,
    },
    financial: {
      currentBalance: summary.currentBalance || 0,
      status: summary.status || 'SETTLED',
      lifetimeMilkIncome: summary.milkIncome || 0,
      lifetimeFeedCost: summary.feedCost || 0,
      lifetimeDeductions: summary.lifetimeDeductions || 0,
      lifetimeBonuses: summary.bonuses || 0,
      lifetimeNet: summary.netEarnings || 0,
      monthMilkIncome: summary.monthMilkIncome || 0,
      monthFeedCost: summary.monthFeedCost || 0,
      monthDeductions: summary.monthDeductions || 0,
      monthBonuses: summary.monthBonuses || 0,
      monthNet: summary.monthNet || 0,
      periodMilkIncome: summary.periodMilkIncome || 0,
      periodCredits: summary.periodCredits || 0,
      periodDebits: summary.periodDebits || 0,
      totalFeedPurchases: summary.feedCost || 0,
      totalSettlements: summary.settlementDeductions || 0,
      netEarnings: summary.netEarnings || 0,
    },
    production: {
      lifetimeLitres: summary.lifetimeLitres || 0,
      lifetimeDeliveries: summary.deliveries || 0,
      deliveries: summary.deliveries || 0,
      averageLitresPerDelivery: summary.averageLitresPerDelivery || 0,
      firstDelivery: summary.firstDelivery,
      lastDelivery: summary.lastDelivery,
      monthLitres: summary.monthLitres || 0,
      monthYear: summary.monthYear,
      monthNumber: summary.monthNumber,
      periodLitres: summary.periodLitres,
    },
    period: raw.period || {
      startDate: startDate || null,
      endDate: endDate || null,
    },
    ledgerHistory,
    statement: ledgerHistory,
    transactions: raw.transactions || [],
  };
};

/**
 * Farmers list for Excel export (same data as getAllFarmers, sorted by code).
 */
const getFarmersForExport = async (cooperativeId) => {
  const farmers = await getAllFarmers(cooperativeId);
  return farmers.sort((a, b) =>
    String(a.farmerCode || '').localeCompare(String(b.farmerCode || ''), undefined, {
      numeric: true,
      sensitivity: 'base',
    })
  );
};

module.exports = {
  createFarmer,
  getFarmer,
  getFarmerByCode,
  updateFarmer,
  deleteFarmer,
  getAllFarmers,
  getFarmersForExport,
  getBalance,
  getFarmerHistory,
};