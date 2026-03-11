const taskService = require('../../services/taskService');
const Cooperative = require('../../models/cooperative');
const logger = require('../../utils/logger');

const getTasks = async (adminId) => {
  try {
    const cooperative = await Cooperative.findById(adminId);
    if (!cooperative) throw new Error('Cooperative not found');

    const tasks = await taskService.getTasks('pending', adminId);
    return tasks;
  } catch (error) {
    logger.warn('Task retrieval failed', { error: error.message });
    return [];
  }
};

module.exports = { getTasks };