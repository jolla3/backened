const farmerService = require('../services/farmerService');

const createFarmer = async (req, res) => {
  try {
    const farmer = await farmerService.createFarmer(req.body);
    res.status(201).json(farmer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getBalance = async (req, res) => {
  try {
    const history = await farmerService.getBalanceHistory(req.params.id);
    res.json(history);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateBalance = async (req, res) => {
  try {
    const { amount } = req.body;
    const session = await require('mongoose').startSession();
    session.startTransaction();
    
    try {
      const farmer = await farmerService.updateBalance(req.params.id, amount, session);
      await session.commitTransaction();
      res.json(farmer);
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

module.exports = { createFarmer, getBalance, updateBalance };