const cooperativeService = require('../services/cooperativeService');
const logger = require('../utils/logger');

const getCooperative = async (req, res) => {
  try {
    const coops = await cooperativeService.getCooperative();
    
    if (!coops || coops.length === 0) {
      return res.status(404).json({ error: 'No cooperatives found' });
    }

    res.json({ success: true, cooperatives: coops });
  } catch (error) {
    logger.error('Get cooperatives failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const setupCooperative = async (req, res) => {
  try {
    // FIX: adminId is NOT required during initial setup
    const { name, registrationNumber, location, contact } = req.body;

    // Validate required fields (no adminId)
    if (!name || !registrationNumber) {
      return res.status(400).json({ error: 'Name and registration number are required' });
    }

    const coop = await cooperativeService.setupCooperative({
      name,
      registrationNumber,
      location,
      contact
    });

    res.status(201).json({ success: true, cooperative: coop });
  } catch (error) {
    logger.error('Setup cooperative failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const updateCooperative = async (req, res) => {
  try {
    const coopId = req.params.id || req.body.id;
    const { name, registrationNumber, location, contact } = req.body;

    if (!coopId) {
      return res.status(400).json({ error: 'Cooperative ID is required' });
    }

    const coop = await cooperativeService.updateCooperative(coopId, {
      name,
      registrationNumber,
      location,
      contact
    });

    res.json({ success: true, cooperative: coop });
  } catch (error) {
    logger.error('Update cooperative failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

module.exports = {
  getCooperative,
  setupCooperative,
  updateCooperative
};