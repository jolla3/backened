const farmerService = require('../services/farmerService');

const createFarmer = async (req, res) => {
  try {
    const farmer = await farmerService.createFarmer(req.body);
    res.status(201).json(farmer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getFarmer = async (req, res) => {
  try {
    const farmer = await farmerService.getFarmer(req.params.id);
    res.json(farmer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getBalance = async (req, res) => {
  try {
    const farmer = await farmerService.getBalance(req.params.id);
    res.json(farmer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateFarmer = async (req, res) => {
  try {
    const farmer = await farmerService.updateFarmer(req.params.id, req.body);
    res.json(farmer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const deleteFarmer = async (req, res) => {
  try {
    const result = await farmerService.deleteFarmer(req.params.id);
    res.json(result);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const updateBalance = async (req, res) => {
  try {
    const { amount } = req.body;
    const farmer = await farmerService.updateBalance(req.params.id, amount);
    res.json(farmer);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const getBalanceHistory = async (req, res) => {
  try {
    const history = await farmerService.getBalanceHistory(req.params.id);
    res.json(history);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  createFarmer,
  getFarmer,
  getBalance,
  updateFarmer,
  deleteFarmer,
  updateBalance,
  getBalanceHistory
};