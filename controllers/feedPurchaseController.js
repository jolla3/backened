const mongoose = require('mongoose');
const feedPurchaseService = require('../services/feedPurchaseService');
const logger = require('../utils/logger');

// ✅ Search farmers for feed purchase (code, phone, name)
const getFeedPurchaseFarmers = async (req, res) => {
  try {
    const { q = '', limit = 10, cooperativeId } = req.query;
    const adminId = req.user.id;

    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    const farmers = await feedPurchaseService.getFeedPurchaseFarmer(q, cooperativeId || req.user.cooperativeId);
    
    res.json({
      farmers: [farmers], // Return as array for consistency
      count: 1
    });
  } catch (error) {
    logger.error('Get feed purchase farmers failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ✅ Record feed purchase
const purchaseFeed = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { farmerId, products } = req.body; // farmerId from frontend search
    
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      const result = await feedPurchaseService.purchaseFeed(
        farmerId,
        products,
        adminId,
        session
      );
      
      await session.commitTransaction();
      res.json(result);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logger.error('Feed purchase failed', { 
      error: error.message, 
      adminId: req.user.id,
      body: req.body 
    });
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getFeedPurchaseFarmers,
  purchaseFeed
};