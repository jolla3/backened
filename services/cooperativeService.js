const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// Get cooperative details
const getCooperative = async () => {
  const coops = await Cooperative.find();
  return coops;
};

// Setup cooperative details (NO adminId required - First Time Setup)
const setupCooperative = async (data) => {
  // Check if cooperative already exists
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

// Get cooperative by ID
const getCooperativeById = async (coopId) => {
  const coop = await Cooperative.findById(coopId);
  return coop;
};

module.exports = {
  getCooperative,
  setupCooperative,
  updateCooperative,
  getCooperativeById
};