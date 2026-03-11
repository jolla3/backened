const porterService = require('../services/porterService');
const logger = require('../utils/logger');

// Create Porter with Cooperative Scoping
const createPorter = async (req, res) => {
  try {
    const { cooperativeId, ...porterData } = req.body;
    const adminId = req.user.id;

    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID required' });
    }

    const porter = await porterService.createPorter({ ...porterData, cooperativeId }, adminId);
    
    logger.info('Porter created', { 
      porterId: porter._id, 
      cooperativeId,
      correlationId: req.correlationId 
    });

    res.status(201).json(porter);
  } catch (error) {
    logger.error('Create porter failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Get Porter by ID with Cooperative Scoping
const getPorter = async (req, res) => {
  try {
    const adminId = req.user.id;
    const porter = await porterService.getPorter(req.params.id, adminId);
    
    res.json(porter);
  } catch (error) {
    logger.error('Get porter failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Get All Porters for Admin's Cooperative
const getAllPorters = async (req, res) => {
  try {
    const adminId = req.user.id;
    const porters = await porterService.getAllPorters(adminId);
    
    res.json({ success: true, porters });
  } catch (error) {
    logger.error('Get all porters failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Update Porter with Cooperative Scoping
const updatePorter = async (req, res) => {
  try {
    const adminId = req.user.id;
    const porter = await porterService.updatePorter(req.params.id, req.body, adminId);
    
    logger.info('Porter updated', { 
      porterId: porter._id,
      correlationId: req.correlationId 
    });

    res.json(porter);
  } catch (error) {
    logger.error('Update porter failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Delete Porter with Cooperative Scoping
const deletePorter = async (req, res) => {
  try {
    const adminId = req.user.id;
    const result = await porterService.deletePorter(req.params.id, adminId);
    
    logger.info('Porter deleted', { 
      porterId: req.params.id,
      correlationId: req.correlationId 
    });

    res.json(result);
  } catch (error) {
    logger.error('Delete porter failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Get Porter Performance with Cooperative Scoping
const getPerformance = async (req, res) => {
  try {
    const adminId = req.user.id;
    const performance = await porterService.getPerformance(req.params.id, adminId);
    
    res.json(performance);
  } catch (error) {
    logger.error('Get performance failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createPorter,
  getPorter,
  getAllPorters,
  updatePorter,
  deletePorter,
  getPerformance
};