const cooperativeService = require('../services/cooperativeService');
const logger = require('../utils/logger');

const getCooperative = async (req, res) => {
  try {
    const coop = await cooperativeService.getCooperative();
    
    if (!coop) {
      return res.status(404).json({ error: 'Cooperative not setup yet' });
    }

    res.json({ success: true, cooperative: coop });
  } catch (error) {
    logger.error('Get cooperative failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const setupCooperative = async (req, res) => {
  try {
    const { name, registrationNumber, location, contact , adminId} = req.body;

    const coop = await cooperativeService.setupCooperative({
      name,
      registrationNumber,
      location,
      contact,
      adminId

    });

    res.status(201).json({ success: true, cooperative: coop });
  } catch (error) {
    logger.error('Setup cooperative failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const updateCooperative = async (req, res) => {
  try {
    const { name, registrationNumber, location, contact } = req.body;

    const coop = await cooperativeService.updateCooperative({
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