const milkService = require('../services/milkService');
const logger = require('../utils/logger');
const { isValidDateString } = require('../utils/dateUtils');

const getDailyTotal = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { date } = req.query;

    if (date && !isValidDateString(date)) {
      return res.status(400).json({
        error: 'Invalid date. Expected YYYY-MM-DD with a real date.'
      });
    }

    const total = await milkService.getDailyTotal(cooperativeId, date);
    res.json(total);
  } catch (error) {
    logger.error('Daily total failed', { error: error.message, coopId: req.user.cooperativeId });
    // If error is about cooperative not found, return 404
    if (error.message === 'Cooperative not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
};

const getMonthlySummary = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const year = parseInt(req.query.year);
    const month = parseInt(req.query.month);

    if (isNaN(year) || isNaN(month) || month < 1 || month > 12) {
      return res.status(400).json({ error: 'Invalid year or month' });
    }

    const summary = await milkService.getMonthlySummary(year, month, cooperativeId);
    res.json(summary);
  } catch (error) {
    logger.error('Monthly summary failed', { error: error.message, coopId: req.user.cooperativeId });
    if (error.message === 'Cooperative not found') {
      return res.status(404).json({ error: error.message });
    }
    res.status(400).json({ error: error.message });
  }
};

const addManualMilkEntry = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const createdBy = req.user.id;

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
    // Handle duplicate specifically
    if (error.code === 'DUPLICATE_MILK_ENTRY') {
      return res.status(error.statusCode || 409).json({
        success: false,
        code: error.code,
        error: error.message
      });
    }

    // Cooperative not found
    if (error.message === 'Cooperative not found') {
      return res.status(404).json({ error: error.message });
    }

    // Farmer not found
    if (error.message.includes('Farmer not found')) {
      return res.status(404).json({ error: error.message });
    }

    // Porter not found
    if (error.message.includes('Porter not found')) {
      return res.status(404).json({ error: error.message });
    }

    // Invalid input (validation errors)
    if (
      error.message.includes('required') ||
      error.message.includes('Invalid') ||
      error.message.includes('must be')
    ) {
      return res.status(400).json({ error: error.message });
    }

    // Unexpected errors
    logger.error('Manual milk entry failed', {
      error: error.message,
      coopId: req.user?.cooperativeId
    });
    res.status(500).json({ error: 'Internal server error' });
  }
};

module.exports = {
  getDailyTotal,
  getMonthlySummary,
  addManualMilkEntry
};