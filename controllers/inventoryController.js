const inventoryService = require('../services/inventoryService');

const getAlerts = async (req, res) => {
  try {
    const alerts = await inventoryService.getAlerts();
    res.json(alerts);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const createProduct = async (req, res) => {
  try {
    const product = await inventoryService.createProduct(req.body);
    res.status(201).json(product);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const deductStock = async (req, res) => {
  try {
    const { quantity } = req.body;
    const session = await require('mongoose').startSession();
    session.startTransaction();
    
    try {
      const product = await inventoryService.deductStock(req.params.id, quantity, session);
      await session.commitTransaction();
      res.json(product);
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

module.exports = { getAlerts, createProduct, deductStock };