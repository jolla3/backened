const inventoryService = require('../services/inventoryService');
const logger = require('../utils/logger');

const getInventory = async (req, res) => {
  try {
    const { adminId } = req.user;
    const cooperativeId = req.user.cooperativeId;
    
    const inventory = await inventoryService.getInventory(cooperativeId);
    res.json(inventory);
  } catch (error) {
    logger.error('Get inventory failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const getAlerts = async (req, res) => {
  try {
    const { id: adminId } = req.user;
    const alerts = await inventoryService.getAlerts(adminId);
    res.json(alerts);
  } catch (error) {
    logger.error('Inventory alerts failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ... other functions remain same
const createProduct = async (req, res) => {
  // ... (keep your existing createProduct)
};

module.exports = { getInventory, getAlerts, createProduct, deductStock };