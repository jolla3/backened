const inventoryService = require('../services/inventoryService');
const logger = require('../utils/logger');

const getInventory = async (req, res) => {
  try {
    const { cooperativeId } = req.user;
    const result = await inventoryService.getInventory(cooperativeId);
    
    res.json({
      inventory: result.inventory,
      lowStock: result.lowStock,
      alerts: result.lowStock
    });
  } catch (error) {
    logger.error('Get inventory failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const adminId = req.user.id;
    const cooperativeId = req.user.cooperativeId;
    
    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }

    const product = await inventoryService.createProduct({ 
      ...req.body, 
      cooperativeId 
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
      adminId: req.user.id
    });
    res.status(400).json({ error: error.message });
  }
};

const deductStock = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { quantity } = req.body;
    const productId = req.params.id;

    if (!quantity || isNaN(Number(quantity)) || Number(quantity) <= 0) {
      return res.status(400).json({ error: 'Valid quantity greater than 0 is required' });
    }

    const product = await inventoryService.deductStock(productId, Number(quantity), adminId);
    res.json(product);
  } catch (error) {
    logger.error('Deduct stock failed', { 
      error: error.message, 
      adminId: req.user.id,
      productId: req.params.id
    });
    res.status(400).json({ error: error.message });
  }
};

// ✅ NEW: Delete product controller
const deleteProduct = async (req, res) => {
  try {
    const adminId = req.user.id;
    const productId = req.params.id;

    const result = await inventoryService.deleteProduct(productId, adminId);
    res.json(result);
  } catch (error) {
    logger.error('Delete product failed', { 
      error: error.message, 
      adminId: req.user.id,
      productId: req.params.id
    });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getInventory, createProduct, deductStock, deleteProduct };