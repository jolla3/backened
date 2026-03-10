const taskService = require('../../services/taskService');
const logger = require('../../utils/logger');

const getTasks = async () => {
  try {
    const tasks = await taskService.getTasks('pending');
    return tasks;
  } catch (error) {
    logger.warn('Task retrieval failed', { error: error.message });
    return [];
  }
};

module.exports = { getTasks };