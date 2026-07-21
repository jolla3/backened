const settlementService = require('../services/settlementService');
const logger = require('../utils/logger');

const generateMonthlySettlements = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const userId = req.user.id;
    const { year, month } = req.query;
    const now = new Date();
    const y = parseInt(year) || now.getFullYear();
    const m = parseInt(month) || (now.getMonth() + 1);
    const periodStart = new Date(y, m - 1, 1);
    const periodEnd = new Date(y, m, 0, 23, 59, 59, 999);

    const result = await settlementService.generateSettlements(
      cooperativeId, periodStart, periodEnd, userId, req.ip
    );
    // Ensure we always send a JSON object
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Generate settlements failed', { error: error.message, stack: error.stack });
    return res.status(400).json({ error: error.message || 'Generation failed' });
  }
};

const approveBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const userId = req.user.id;
    const result = await settlementService.approveBatch(batchId, userId, req.ip);
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
    const userId = req.user.id;
    const result = await settlementService.settleBatch(batchId, userId, req.ip);
    if (!result) throw new Error('No result returned from service');
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Settle batch failed', { error: error.message });
    return res.status(400).json({ error: error.message });
  }
};

const getBatch = async (req, res) => {
  try {
    const { batchId } = req.params;
    const batch = await settlementService.getBatch(batchId);
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
    const { page, limit, farmerId } = req.query;
    const result = await settlementService.getBatchSettlements(batchId, { page, limit, farmerId });
    if (!result) throw new Error('No result returned from service');
    return res.status(200).json({ success: true, ...result });
  } catch (error) {
    logger.error('Get batch settlements failed', { error: error.message });
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
  getBatch,
  getBatches,
  getBatchSettlements,
  getFarmerSettlements,
};