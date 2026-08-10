const milkService = require('../services/milkService');
const logger = require('../utils/logger');

// ─── Existing controllers ──────────────────────────────────

const getDailyTotal = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const total = await milkService.getDailyTotal(cooperativeId);
    res.json(total);
  } catch (error) {
    logger.error('Daily total failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const summary = await milkService.getMonthlySummary(
      parseInt(req.query.year),
      parseInt(req.query.month),
      cooperativeId
    );
    res.json(summary);
  } catch (error) {
    logger.error('Monthly summary failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

// ─── Manual milk entry ──────────────────────────────────────

const addManualMilkEntry = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const createdBy = req.user.id;   // ✅ Correct – from JWT, never from body

    const {
      farmerId,
      porterId,
      litres,
      collectionDate,
      collectionShift,
      zoneId,
      zone
    } = req.body;

    const result = await milkService.addManualMilkEntry({
      cooperativeId,
      farmerId,
      porterId,
      litres,
      collectionDate,
      collectionShift,
      zoneId,
      zone,
      createdBy
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Manual milk entry failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getDailyTotal,
  getMonthlySummary,
  addManualMilkEntry
};