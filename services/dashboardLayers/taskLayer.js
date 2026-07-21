// dashboardLayers/taskLayer.js
const mongoose = require('mongoose');

const getTasks = async (cooperativeId) => {
  try {
    // ✅ Import models inside the function to avoid circular dependencies
    const Cooperative = require('../../models/cooperative');
    const taskService = require('../../services/taskService');
    const logger = require('../../utils/logger');

    // Convert cooperativeId to ObjectId
    const coopId = new mongoose.Types.ObjectId(cooperativeId);

    // Verify the cooperative exists
    const cooperative = await Cooperative.findById(coopId);
    if (!cooperative) {
      throw new Error('Cooperative not found');
    }

    // Get pending tasks
    const tasks = await taskService.getTasks('pending', coopId);
    return tasks || [];
  } catch (error) {
    // Fallback: return an empty array
    const logger = require('../../utils/logger');
    logger.warn('Task retrieval failed', { error: error.message, coopId: cooperativeId });
    return [];
  }
};

module.exports = { getTasks };