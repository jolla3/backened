const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// Get cooperative details
const getCooperative = async () => {
  const coop = await Cooperative.find(); // Changed from findOne() to find() to get all cooperatives
  return coop;
};

// Setup cooperative details (allows multiple cooperatives)
const setupCooperative = async (data, adminId) => {
  // FIX: Removed the check that prevents multiple cooperatives
  
  const coop = await Cooperative.create({
    ...data,
    adminId // Set adminId from the authenticated user
  });
  
  logger.info('Cooperative created', { 
    name: coop.name,
    id: coop._id,
    adminId
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