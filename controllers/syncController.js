const syncService = require('../services/syncService');
const logger = require('../utils/logger');

const postBatch = async (req, res) => {
  try {
    const adminId = req.user.id;
    const session = await require('mongoose').startSession();
    session.startTransaction();
    
    try {
      const { batch } = req.body;
      const result = await syncService.reconcileDeltas(batch, adminId, session);
      
      await session.commitTransaction();
      res.json(result);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logger.error('Sync batch failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

const postDeltas = async (req, res) => {
  try {
    const adminId = req.user.id;
    const session = await require('mongoose').startSession();
    session.startTransaction();
    
    try {
      const { deltas } = req.body;
      const result = await syncService.reconcileDeltas(deltas, adminId, session);
      
      await session.commitTransaction();
      res.json(result);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logger.error('Sync deltas failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { postBatch, postDeltas };