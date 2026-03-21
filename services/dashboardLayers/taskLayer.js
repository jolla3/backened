const taskService = require('../../services/taskService');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getTasks = async (cooperativeId) => {  // ✅ FIXED
  try {
    const cooperative = await Cooperative.findById(cooperativeId);
    if (!cooperative) throw new Error('Cooperative not found');

    const tasks = await taskService.getTasks('pending', cooperativeId);
    return tasks;
  } catch (error) {
    logger.warn('Task retrieval failed', { error: error.message, coopId: cooperativeId });
    return [];
  }
};

module.exports = { getTasks };