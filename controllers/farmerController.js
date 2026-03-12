const farmerService = require('../services/farmerService');
const logger = require('../utils/logger');

// Create Farmer with Cooperative Scoping
const createFarmer = async (req, res) => {
  try {
    const { cooperativeId, ...farmerData } = req.body;
    const adminId = req.user.id;

    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID required' });
    }

    const farmer = await farmerService.createFarmer({ ...farmerData, cooperativeId }, adminId);
    
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

// Get Farmer by ID with Cooperative Scoping
const getFarmer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const farmer = await farmerService.getFarmer(req.params.id, adminId);
    
    res.json(farmer);
  } catch (error) {
    logger.error('Get farmer failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Get Farmer by Code with Cooperative Scoping
const getFarmerByCode = async (req, res) => {
  try {
    const adminId = req.user.id;
    const farmer = await farmerService.getFarmerByCode(req.params.code, adminId);
    
    res.json(farmer);
  } catch (error) {
    logger.error('Get farmer by code failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Get All Farmers for Admin's Cooperative
const getAllFarmers = async (req, res) => {
  try {
    const adminId = req.user.id;
    const farmers = await farmerService.getAllFarmers(adminId);
    
    res.json({ success: true, farmers });
  } catch (error) {
    logger.error('Get all farmers failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Update Farmer with Cooperative Scoping
const updateFarmer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const farmer = await farmerService.updateFarmer(req.params.id, req.body, adminId);
    
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

// Delete Farmer with Cooperative Scoping
const deleteFarmer = async (req, res) => {
  try {
    const adminId = req.user.id;
    const result = await farmerService.deleteFarmer(req.params.id, adminId);
    
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

// Get Farmer Balance with Cooperative Scoping
const getBalance = async (req, res) => {
  try {
    const adminId = req.user.id;
    const farmer = await farmerService.getBalance(req.params.id, adminId);
    
    res.json(farmer);
  } catch (error) {
    logger.error('Get balance failed', { 
      error: error.message,
      correlationId: req.correlationId || 'unknown' 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Update Farmer Balance with Cooperative Scoping
const updateBalance = async (req, res) => {
  try {
    const { amount } = req.body;
    const adminId = req.user.id;
    const farmer = await farmerService.updateBalance(req.params.id, amount, adminId);
    
    logger.info('Balance updated', { 
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

// Get Farmer History with Cooperative Scoping
const getFarmerHistory = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { limit = 50 } = req.query;
    const result = await farmerService.getFarmerHistory(req.params.id, adminId, parseInt(limit));
    
    res.json(result);
  } catch (error) {
    logger.error('Get farmer history failed', { 
      error: error.message,
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
  getFarmerHistory
};