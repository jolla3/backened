const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// Get cooperative details
const getCooperative = async () => {
  const coop = await Cooperative.findOne();
  return coop;
};

// Setup cooperative details (first time setup)
const setupCooperative = async (data) => {
  const existing = await Cooperative.findOne();
  
  if (existing) {
    throw new Error('Cooperative already setup');
  }

  const coop = await Cooperative.create(data);
  
  logger.info('Cooperative setup', { 
    name: coop.name,
    id: coop._id
  });

  return coop;
};

// Update cooperative details
const updateCooperative = async (data) => {
  const coop = await Cooperative.findOneAndUpdate({}, data, { new: true });
  
  logger.info('Cooperative updated', { 
    name: coop.name,
    id: coop._id
  });

  return coop;
};

module.exports = {
  getCooperative,
  setupCooperative,
  updateCooperative
};