const feedPurchaseService = require('../services/feedPurchaseService');
const logger = require('../utils/logger');

const purchaseFeed = async (req, res) => {
  try {
    const adminId = req.user.id;
    const session = await require('mongoose').startSession();
    session.startTransaction();
    
    try {
      const purchase = await feedPurchaseService.purchaseFeed(
        req.body.farmer_id,
        req.body.product_id,
        req.body.quantity,
        req.body.rate,
        adminId,
        session
      );
      
      await session.commitTransaction();
      res.json(purchase);
    } catch (error) {
      await session.abortTransaction();
      throw error;
    } finally {
      session.endSession();
    }
  } catch (error) {
    logger.error('Feed purchase failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { purchaseFeed };