const mongoose = require('mongoose');
const feedPurchaseService = require('../services/feedPurchaseService');
const logger = require('../utils/logger');

const getFeedPurchaseFarmers = async (req, res) => {
  try {
    const { q = '' } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    const farmer = await feedPurchaseService.getFeedPurchaseFarmer(q, req.user.cooperativeId);
    
    res.json({
      farmers: [farmer],
      count: 1
    });
  } catch (error) {
    logger.error('Get feed purchase farmers failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const purchaseFeed = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { farmerId, products } = req.body;
    const adminId = req.user.id;
    const cooperativeId = req.user.cooperativeId;
    
    // ✅ VALIDATE INPUT STRUCTURE
    if (!farmerId) {
      throw new Error('Farmer ID is required');
    }
    if (!Array.isArray(products) || products.length === 0) {
      throw new Error('Products array is required and cannot be empty');
    }

    const result = await feedPurchaseService.purchaseFeed(
      { 
        farmerId, 
        products, 
        adminId,
        cooperativeId
      },
      session
    );
    
    await session.commitTransaction();
    res.json(result);
  } catch (error) {
    await session.abortTransaction();
    logger.error('Feed purchase failed', { 
      error: error.message, 
      adminId: req.user?.id,
      farmerId: req.body?.farmerId
    });
    res.status(400).json({ error: error.message });
  } finally {
    session.endSession();
  }
};

module.exports = {
  getFeedPurchaseFarmers,
  purchaseFeed
};