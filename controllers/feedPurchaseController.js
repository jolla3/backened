const mongoose = require('mongoose');
const feedPurchaseService = require('../services/feedPurchaseService');
const logger = require('../utils/logger');

// ✅ Search farmers for feed purchase
const getFeedPurchaseFarmers = async (req, res) => {
  try {
    const { q = '' } = req.query;
    
    if (!q || q.length < 2) {
      return res.status(400).json({ error: 'Search term must be at least 2 characters' });
    }

    // ✅ FIXED: Pass req.user.cooperativeId
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

// ✅ FIXED: Record feed purchase
const purchaseFeed = async (req, res) => {
  const session = await mongoose.startSession();
  
  try {
    session.startTransaction();
    
    const { farmerId, products } = req.body;
    const adminId = req.user.id;
    
    // ✅ FIXED: Pass cooperativeId from JWT
    const result = await feedPurchaseService.purchaseFeed(
      { 
        farmerId, 
        products, 
        adminId,
        cooperativeId: req.user.cooperativeId  // ✅ CRITICAL FIX
      },
      session
    );
    
    await session.commitTransaction();
    res.json(result);
  } catch (error) {
    await session.abortTransaction();
    logger.error('Feed purchase failed', { 
      error: error.message, 
      adminId: req.user.id,
      farmerId: req.body.farmerId
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