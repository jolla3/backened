const inventoryService = require('../services/inventoryService');
const logger = require('../utils/logger');

const getAlerts = async (req, res) => {
  try {
    const adminId = req.user.id;
    const alerts = await inventoryService.getAlerts(adminId);
    res.json(alerts);
  } catch (error) {
    logger.error('Inventory alerts failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const adminId = req.user.id;
    const product = await inventoryService.createProduct(req.body, adminId);
    res.status(201).json(product);
  } catch (error) {
    logger.error('Create product failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

const deductStock = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { quantity } = req.body;
    const product = await inventoryService.deductStock(req.params.id, quantity, adminId);
    res.json(product);
  } catch (error) {
    logger.error('Deduct stock failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getAlerts, createProduct, deductStock };