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

const getInventory = async (req, res) => {
  try {
    const adminId = req.user.id;
    const cooperativeId = req.user.cooperativeId;
    
    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }

    const inventory = await inventoryService.getInventory(cooperativeId);
    
    logger.info('Inventory retrieved', { 
      cooperativeId,
      adminId,
      count: inventory.length 
    });
    
    res.json(inventory);
  } catch (error) {
    logger.error('Get inventory failed', { 
      error: error.message, 
      adminId: req.user.id,
      correlationId: req.correlationId || 'unknown'
    });
    res.status(400).json({ error: error.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const adminId = req.user.id;
    
    // ✅ EXTRACT FROM TOKEN (lowercase)
    const cooperativeId = req.user.cooperativeId;
    
    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }

    const product = await inventoryService.createProduct({ 
      ...req.body, 
      cooperativeId  // ✅ Pass lowercase cooperativeId to service
    }, adminId);
    
    logger.info('Product created', { 
      productId: product._id, 
      cooperativeId,
      adminId 
    });
    
    res.status(201).json(product);
  } catch (error) {
    logger.error('Create product failed', { 
      error: error.message, 
      adminId: req.user.id,
      correlationId: req.correlationId || 'unknown'
    });
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

module.exports = { getAlerts, getInventory, createProduct, deductStock };