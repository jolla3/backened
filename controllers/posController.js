const Joi = require('joi');
const mongoose = require('mongoose');
const Transaction = require('../models/transaction');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const {
  recordMilkTransaction: recordMilkTxService,
  getFarmerHistory: getFarmerHistoryService,
  syncOfflineTransactions: syncOfflineTxService,
  verifyTransaction: verifyTxService,
  findFarmerByCode: findFarmerService,
  getPorterPerformance: getPorterPerformanceService,
  getDailySummary: getDailySummaryService,
  getFarmersCollectedByPorter: getFarmersCollectedByPorterService,
  getPerformanceChartData: getPerformanceChartDataService,
  getTopFarmers: getTopFarmersService,
  getZonePerformance: getZonePerformanceService,
  getPorterRanking: getPorterRankingService,
} = require('../services/posService');
const { milkTransactionSchema, farmerCodeSchema } = require('../validators/posValidator');
const logger = require('../utils/logger');

// ── Validation schemas ──────────────────────────────────

const periodSchema = Joi.string().valid('today', 'yesterday', 'week', 'month', 'last7days', 'last30days').default('today');
const dateSchema = Joi.string().isoDate();
const limitSchema = Joi.number().integer().min(0).max(500).default(50);
const offsetSchema = Joi.number().integer().min(0).default(0);
const entitySchema = Joi.string().valid('porter', 'farmer', 'overall').required();
const metricSchema = Joi.string().valid('litres', 'transactions', 'payout').default('litres');
const periodGroupSchema = Joi.string().valid('hour', 'day', 'week', 'month').default('day');
const sortBySchema = Joi.string().valid('litres', 'payout').default('litres');

// ── Helper: get cooperativeId from token ──────────────

const getCooperativeId = (req) => req.user?.cooperativeId || null;

// ── Helper: compare ObjectId safely ─────────────────────

const compareObjectId = (id1, id2) => {
  if (!id1 || !id2) return false;
  return id1.toString() === id2.toString();
};

// ── 1. Find Farmer ──────────────────────────────────────

// ── 1. Find Farmer ──────────────────────────────────────

const findFarmerByCode = async (req, res) => {
  try {
    const { error } = farmerCodeSchema.validate(req.params);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const result = await findFarmerService(req.params.farmer_code);
    if (result.error) return res.status(404).json({ error: result.error });

    const coopId = getCooperativeId(req); // from token or null
    const farmerCoop = result.farmer?.cooperativeId;

    // Log for debugging – you can remove after confirming
    logger.debug('Cooperative check', {
      tokenCoop: coopId,
      farmerCoop: farmerCoop,
      farmerCoopType: typeof farmerCoop,
      tokenCoopType: typeof coopId,
    });

    if (coopId && farmerCoop) {
      const tokenCoopStr = String(coopId);
      const farmerCoopStr = String(farmerCoop);
      if (tokenCoopStr !== farmerCoopStr) {
        logger.warn('Cooperative mismatch', { token: tokenCoopStr, farmer: farmerCoopStr });
        return res.status(403).json({ error: 'Farmer does not belong to your cooperative' });
      }
    } else if (coopId && !farmerCoop) {
      // Farmer has no cooperative – deny access
      return res.status(403).json({ error: 'Farmer has no cooperative assigned' });
    }
    // If no coopId in token, we skip the check (shouldn't happen for authenticated porter)

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Find farmer failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};


// ── 2. Record Milk Transaction ──────────────────────────

const recordMilkTransaction = async (req, res) => {
  try {
    const { error, value } = milkTransactionSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const {
      farmer_code,
      litres,
      porter_id,
      zone,
      device_seq_num,
      timestamp_local,
      cooperativeId
    } = value;

    const tokenCoop = getCooperativeId(req);
    if (tokenCoop && !compareObjectId(cooperativeId, tokenCoop)) {
      return res.status(403).json({ error: 'Cooperative mismatch' });
    }

    // ── 1. Verify device ────────────────────────────────────
    const device = req.device;
    const branch_id = req.branch_id;

    if (device.revoked || !device.approved) {
      return res.status(403).json({ error: 'Device not authorized' });
    }
    if (device.branch && device.branch !== branch_id) {
      return res.status(403).json({ error: 'Device branch mismatch' });
    }

    // ── 2. Find the farmer ──────────────────────────────────
    const farmer = await Farmer.findOne({
      farmer_code,
      cooperativeId: cooperativeId
    }).select('_id name').lean();

    if (!farmer) {
      return res.status(404).json({ error: 'Farmer not found in this cooperative' });
    }

    // ── 3. Get userId from token ─────────────────────────────
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'User not authenticated' });
    }

    // ── 4. Call service with farmer_id and userId ────────────
    const result = await recordMilkTxService({
      farmer_code,
      farmer_id: farmer._id,
      litres,
      porter_id,
      zone,
      device_id: device.uuid,
      branch_id,
      device_seq_num,
      timestamp_local: timestamp_local ? new Date(timestamp_local) : new Date(),
      cooperativeId,
      userId, // ✅ now passed
    });

    res.json({
      success: true,
      transaction: {
        id: result.transaction._id,
        receiptNum: result.receiptNum,
        serverSeqNum: result.serverSeqNum,
        qrUrl: result.qrUrl,
        status: 'completed',
      },
      farmer: {
        code: result.farmer_code,
        name: result.farmer_name,
        newBalance: result.newBalance,
      },
      receipt: {
        thermalData: result.thermalReceipt?.thermalReceipt || null,
        qrImage: result.qrImage || null,
        preview: result.receiptPreview || null,
        receiptNum: result.receiptNum,
      },
    });
  } catch (error) {
    logger.error('Record milk failed', { error: error.message });
    const status = error.message.includes('limit') || error.message.includes('rate') ? 400 : 500;
    res.status(status).json({ error: error.message });
  }
};

// ── 3. Verify Transaction ──────────────────────────────

const verifyTransaction = async (req, res) => {
  try {
    const { receiptNum } = req.params;
    const cooperativeId = req.user?.cooperativeId || null;

    const result = await verifyTxService(receiptNum, cooperativeId);
    if (!result.valid) {
      return res.status(404).json({ error: result.error || 'Transaction not found' });
    }

    res.json({ success: true, verified: true, transaction: result.transaction });
  } catch (error) {
    logger.error('Verify failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 4. Porter Performance ──────────────────────────────

const getPorterPerformance = async (req, res) => {
  try {
    const { porter_id } = req.params;
    const { error, value } = Joi.object({ period: periodSchema }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    const result = await getPorterPerformanceService(porter_id, value.period, coopId);
    if (result.error) return res.status(404).json({ error: result.error });

    if (coopId) {
      const porter = await Porter.findById(porter_id).select('cooperativeId').lean();
      if (porter && !compareObjectId(porter.cooperativeId, coopId)) {
        return res.status(403).json({ error: 'Porter does not belong to your cooperative' });
      }
    }

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Performance failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 5. Daily Summary ────────────────────────────────────

const getDailySummary = async (req, res) => {
  try {
    const { error, value } = Joi.object({
      date: dateSchema.default(new Date().toISOString().split('T')[0]),
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    const result = await getDailySummaryService(value.date, coopId);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Summary failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 6. Farmer History ──────────────────────────────────

const getFarmerHistory = async (req, res) => {
  try {
    const { farmer_code } = req.params;
    const { error, value } = Joi.object({
      limit: limitSchema,
      offset: offsetSchema,
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    if (!coopId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }

    const finalLimit = value.limit === 0 ? 50 : value.limit;

    const result = await getFarmerHistoryService(
      farmer_code,
      finalLimit,
      value.offset,
      coopId
    );
    if (result.error) return res.status(404).json({ error: result.error });

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('History failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 7. Sync Offline ─────────────────────────────────────

const syncOfflineTransactions = async (req, res) => {
  try {
    const { transactions } = req.body;
    const coopId = getCooperativeId(req);
    if (!coopId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }

    if (!Array.isArray(transactions) || transactions.length === 0) {
      return res.status(400).json({ error: 'No transactions to sync' });
    }
    if (transactions.length > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 transactions per sync' });
    }

    const invalid = transactions.some(tx => !compareObjectId(tx.cooperativeId, coopId));
    if (invalid) {
      return res.status(403).json({ error: 'Some transactions do not belong to your cooperative' });
    }

    const result = await syncOfflineTxService(transactions, coopId);
    res.json({ success: true, synced: result.synced, failed: result.failed });
  } catch (error) {
    logger.error('Sync failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 8. Farmers Collected by Porter ─────────────────────

const getFarmersCollectedByPorter = async (req, res) => {
  try {
    const { porter_id } = req.params;
    const { error, value } = Joi.object({
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    const result = await getFarmersCollectedByPorterService(
      porter_id,
      value.startDate,
      value.endDate,
      coopId
    );
    if (result.error) return res.status(404).json({ error: result.error });

    if (coopId) {
      const porter = await Porter.findById(porter_id).select('cooperativeId').lean();
      if (porter && !compareObjectId(porter.cooperativeId, coopId)) {
        return res.status(403).json({ error: 'Porter does not belong to your cooperative' });
      }
    }

    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Get farmers collected by porter failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 9. Chart Data ──────────────────────────────────────

const getPerformanceChartData = async (req, res) => {
  try {
    const { error, value } = Joi.object({
      entity: entitySchema,
      id: Joi.string().optional(),
      period: periodGroupSchema,
      metric: metricSchema,
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    if (coopId) {
      if (value.entity === 'porter' && value.id) {
        const porter = await Porter.findById(value.id).select('cooperativeId').lean();
        if (porter && !compareObjectId(porter.cooperativeId, coopId)) {
          return res.status(403).json({ error: 'Porter does not belong to your cooperative' });
        }
      }
      if (value.entity === 'farmer' && value.id) {
        const farmer = await Farmer.findById(value.id).select('cooperativeId').lean();
        if (farmer && !compareObjectId(farmer.cooperativeId, coopId)) {
          return res.status(403).json({ error: 'Farmer does not belong to your cooperative' });
        }
      }
    }

    const result = await getPerformanceChartDataService(value, coopId);
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Chart data failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 10. New: Top Farmers ──────────────────────────────

const getTopFarmers = async (req, res) => {
  try {
    const { error, value } = Joi.object({
      date: dateSchema.optional(),
      limit: limitSchema.default(10),
      sortBy: sortBySchema,
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    const result = await getTopFarmersService(
      { date: value.date, limit: value.limit, sortBy: value.sortBy },
      coopId
    );
    res.json({ success: true, topFarmers: result });
  } catch (error) {
    logger.error('Top farmers failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 11. New: Zone Performance ──────────────────────────

const getZonePerformance = async (req, res) => {
  try {
    const { error, value } = Joi.object({
      startDate: dateSchema.optional(),
      endDate: dateSchema.optional(),
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    const dateRange = (value.startDate && value.endDate)
      ? { start: new Date(value.startDate), end: new Date(value.endDate) }
      : null;
    const result = await getZonePerformanceService({ dateRange }, coopId);
    res.json({ success: true, zones: result });
  } catch (error) {
    logger.error('Zone performance failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── 12. New: Porter Ranking ────────────────────────────

const getPorterRanking = async (req, res) => {
  try {
    const { error, value } = Joi.object({
      period: periodSchema.default('today'),
      limit: limitSchema.default(5),
    }).validate(req.query);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const coopId = getCooperativeId(req);
    const result = await getPorterRankingService(
      { period: value.period, limit: value.limit },
      coopId
    );
    res.json({ success: true, ...result });
  } catch (error) {
    logger.error('Porter ranking failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ── Exports ─────────────────────────────────────────────

module.exports = {
  findFarmerByCode,
  recordMilkTransaction,
  verifyTransaction,
  getPorterPerformance,
  getDailySummary,
  syncOfflineTransactions,
  getFarmerHistory,
  getFarmersCollectedByPorter,
  getPerformanceChartData,
  getTopFarmers,
  getZonePerformance,
  getPorterRanking,
};