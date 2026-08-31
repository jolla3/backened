const settlementService = require('../services/settlementService');
const logger = require('../utils/logger');

const generateMonthlySettlements = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const { year, month } = req.query;
    const now = new Date();
    // Accounting boundaries are UTC — default off getUTCFullYear/getUTCMonth,
    // not local-timezone getFullYear/getMonth, or the "current period" can
    // silently shift by a day depending on the server/user's timezone.
    const y = parseInt(year, 10) || now.getUTCFullYear();
    const m = parseInt(month, 10) || (now.getUTCMonth() + 1);

    const result = await settlementService.generateSettlements(cooperativeId, y, m, userId, req.ip);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Generate settlements failed', { error: error.message, stack: error.stack });
    const status = error.code === 'PERIOD_LOCKED' ? 409 : 400;
    return res.status(status).json({ error: error.message || 'Generation failed' });
  }
};

const approveBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const result = await settlementService.approveBatch(batchId, userId, cooperativeId, req.ip);
    if (!result) throw new Error('No result returned from service');
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Approve batch failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

const settleBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const result = await settlementService.settleBatch(batchId, userId, cooperativeId, req.ip);
    if (!result) throw new Error('No result returned from service');
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Settle batch failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

// Step 1 of the override flow: flag intent to reconcile a MISMATCH, with a reason.
const requestSettlementOverride = async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { reason } = req.body;
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const result = await settlementService.requestSettlementOverride(
      settlementId, userId, reason, cooperativeId, req.ip
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Request settlement override failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

// Step 2a: a different, authorized user approves — and must explicitly pick
// one of ACCEPT_ACTUAL / KEEP_ORIGINAL / MANUAL_AMOUNT. This is the only
// place money actually moves for a mismatched settlement.
const approveSettlementOverride = async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { resolutionType, manualAmount, notes } = req.body;
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const result = await settlementService.approveSettlementOverride(
      settlementId, userId, resolutionType, manualAmount, notes, cooperativeId, req.ip
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Approve settlement override failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

const rejectSettlementOverride = async (req, res) => {
  try {
    const { settlementId } = req.params;
    const { notes } = req.body;
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const result = await settlementService.rejectSettlementOverride(
      settlementId, userId, notes, cooperativeId, req.ip
    );
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Reject settlement override failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

// Permanently locks a fully-settled period.
const closeBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const result = await settlementService.closeBatch(batchId, userId, cooperativeId, req.ip);
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Close batch failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

const getBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const batch = await settlementService.getBatch(batchId, cooperativeId);
    if (!batch) throw new Error('Batch not found');
    return res.status(200).json({ success: true, batch });
  } catch (error) {
    logger.error('Get batch failed', { error: error.message });
    return res.status(404).json({ error: error.message });
  }
};

const getBatchSettlements = async (req, res) => {
  try {
    const { batchId } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const { page, limit, farmerId, status } = req.query;
    const result = await settlementService.getBatchSettlements(batchId, cooperativeId, { page, limit, farmerId, status });
    if (!result) throw new Error('No result returned from service');
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Get batch settlements failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

// Queue of settlements currently sitting in MISMATCH / OVERRIDE_REQUESTED for review.
const getPendingOverrides = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { page, limit } = req.query;
    const result = await settlementService.getPendingOverrides(cooperativeId, { page, limit });
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Get pending overrides failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

const getFarmerSettlements = async (req, res) => {
  try {
    const { farmerId } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const { limit, status } = req.query;
    const settlements = await settlementService.getFarmerSettlements(
      farmerId, cooperativeId, parseInt(limit) || 12, status
    );
    return res.status(200).json({ success: true, settlements });
  } catch (error) {
    logger.error('Get farmer settlements failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

const getBatches = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { page, limit, status } = req.query;
    const result = await settlementService.getBatches(cooperativeId, { page, limit, status });
    if (!result) throw new Error('No result returned from service');
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Get batches failed', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
};

module.exports = {
  generateMonthlySettlements,
  approveBatch,
  settleBatch,
  requestSettlementOverride,
  approveSettlementOverride,
  rejectSettlementOverride,
  closeBatch,
  getBatch,
  getBatches,
  getBatchSettlements,
  getPendingOverrides,
  getFarmerSettlements,
};