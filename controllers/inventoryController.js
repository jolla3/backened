const inventoryService = require('../services/inventoryService');
const logger = require('../utils/logger');

const getInventory = async (req, res) => {
  try {
    const { cooperativeId } = req.user;
    
    // ✅ SINGLE SERVICE CALL - returns BOTH arrays
    const result = await inventoryService.getInventory(cooperativeId);
    
    res.json({
      inventory: result.inventory,    // All 6 items
      lowStock: result.lowStock,      // Only low stock items (maclick plus, maclick super)
      alerts: result.lowStock         // Legacy support
    });
  } catch (error) {
    logger.error('Get inventory failed', { error: error.message });
    res.status(500).json({ error: error.message });
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