const feedPurchaseService = require('../services/feedPurchaseService');

const purchaseFeed = async (req, res) => {
  try {
    const session = await require('mongoose').startSession();
    session.startTransaction();
    
    try {
      const purchase = await feedPurchaseService.purchaseFeed(
        req.body.farmer_id,
        req.body.product_id,
        req.body.quantity,
        req.body.rate,
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
    res.status(400).json({ error: error.message });
  }
};

module.exports = { purchaseFeed };