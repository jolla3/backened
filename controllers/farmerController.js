// controllers/farmerController.js
const farmerService = require('../services/farmerService');
const logger = require('../utils/logger');

// Create Farmer
const createFarmer = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }

    const farmer = await farmerService.createFarmer(req.body, cooperativeId);
    logger.info('Farmer created', { 
      farmerId: farmer._id, 
      cooperativeId,
      correlationId: req.correlationId || 'unknown' 
    });

    res.status(201).json(farmer);
  } catch (error) {
    logger.error('Create farmer failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Get Farmer by ID
const getFarmer = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const farmer = await farmerService.getFarmer(req.params.id, cooperativeId);
    res.json(farmer);
  } catch (error) {
    logger.error('Get farmer failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Get Farmer by Code
const getFarmerByCode = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const farmer = await farmerService.getFarmerByCode(req.params.code, cooperativeId);
    res.json(farmer);
  } catch (error) {
    logger.error('Get farmer by code failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Get All Farmers for Cooperative
const getAllFarmers = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const farmers = await farmerService.getAllFarmers(cooperativeId);
    res.json({ success: true, farmers });
  } catch (error) {
    logger.error('Get all farmers failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Update Farmer
const updateFarmer = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const farmer = await farmerService.updateFarmer(req.params.id, req.body, cooperativeId);
    
    logger.info('Farmer updated', { 
      farmerId: farmer._id,
      correlationId: req.correlationId || 'unknown' 
    });

    res.json(farmer);
  } catch (error) {
    logger.error('Update farmer failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Delete Farmer
const deleteFarmer = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const result = await farmerService.deleteFarmer(req.params.id, cooperativeId);
    
    logger.info('Farmer deleted', { 
      farmerId: req.params.id,
      correlationId: req.correlationId || 'unknown' 
    });

    res.json(result);
  } catch (error) {
    logger.error('Delete farmer failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Update Farmer Balance (deprecated – keep for compatibility but warn)
const updateBalance = async (req, res) => {
  try {
    const { amount } = req.body;
    const cooperativeId = req.user.cooperativeId;
    const farmer = await farmerService.updateBalance(req.params.id, amount, cooperativeId);
    
    logger.warn('Balance updated directly – use Ledger instead', { 
      farmerId: req.params.id,
      amount,
      correlationId: req.correlationId || 'unknown' 
    });

    res.json(farmer);
  } catch (error) {
    logger.error('Update balance failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    res.status(400).json({ error: error.message });
  }
};

// Get Balance
const getBalance = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const farmerId = req.params.id || req.params.farmerId;

    if (!farmerId || farmerId === 'undefined' || farmerId === 'null') {
      return res.status(400).json({ error: 'Valid farmer ID is required' });
    }

    const balance = await farmerService.getBalance(farmerId, cooperativeId);
    res.json(balance);
  } catch (error) {
    logger.error('Get balance failed', {
      error: error.message,
      farmerId: req.params.id || req.params.farmerId,
      correlationId: req.correlationId || 'unknown'
    });
    res.status(400).json({ error: error.message });
  }
};

// Get Farmer History
const getFarmerHistory = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const farmerId = req.params.id || req.params.farmerId;

    // ✅ Strict validation
    if (!farmerId || farmerId === 'undefined' || farmerId === 'null' || farmerId === '') {
      return res.status(400).json({ error: 'Valid farmer ID is required' });
    }

    const { limit = 50 } = req.query;
    const result = await farmerService.getFarmerHistory(farmerId, cooperativeId, parseInt(limit));
    res.json(result);
  } catch (error) {
    logger.error('Get farmer history failed', {
      error: error.message,
      farmerId: req.params.id || req.params.farmerId,
      correlationId: req.correlationId || 'unknown'
    });
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createFarmer,
  getFarmer,
  getFarmerByCode,
  getAllFarmers,
  updateFarmer,
  deleteFarmer,
  getBalance,
  updateBalance,
  getFarmerHistory,
};