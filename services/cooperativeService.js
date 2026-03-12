const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// Get cooperative details
const getCooperative = async () => {
  const coops = await Cooperative.find();
  return coops;
};

// Setup cooperative details (NO CHECK - Allows Multiple Cooperatives)
const setupCooperative = async (data) => {
  // FIX: Removed the check that prevents multiple cooperatives
  
  const coop = await Cooperative.create(data);
  
  logger.info('Cooperative created', { 
    name: coop.name,
    id: coop._id
  });

  return coop;
};

// Update cooperative details
const updateCooperative = async (coopId, data) => {
  const coop = await Cooperative.findByIdAndUpdate(
    coopId,
    { $set: data },
    { new: true, runValidators: true }
  );
  
  if (!coop) {
    throw new Error('Cooperative not found');
  }

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