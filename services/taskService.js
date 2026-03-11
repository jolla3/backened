const Task = require('../models/task');
const logger = require('../utils/logger');

const generateTasks = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  const tasks = [];

  // Device Inactivity Tasks
  const devices = await Device.find({ approved: true, revoked: false, cooperativeId: cooperative._id });
  for (const device of devices) {
    const lastTx = await Transaction.findOne({ device_id: device.uuid }).sort({ timestamp_server: -1 });
    if (lastTx) {
      const hours = (Date.now() - new Date(lastTx.timestamp_server)) / 36e5;
      if (hours > 24) {
        tasks.push({
          title: `Device ${device.uuid} inactive for ${hours.toFixed(0)} hours`,
          description: `Last sync was ${hours.toFixed(0)} hours ago.`,
          assignedToType: 'admin',
          priority: hours > 48 ? 'critical' : 'high',
          status: 'pending',
          category: 'device',
          dueDate: new Date(Date.now() + 24 * 36e5),
          cooperativeId: cooperative._id,
          created_by: adminId
        });
      }
    }
  }

  return tasks.sort((a, b) => {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
};

const getTasks = async (status, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  return await Task.find({ status, cooperativeId: cooperative._id }).sort({ priority: -1, createdAt: -1 });
};

const completeTask = async (taskId, adminId) => {
  const task = await Task.findById(taskId);
  if (!task) throw new Error('Task not found');
  
  const cooperative = await Cooperative.findById(adminId);
  if (task.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot complete task from another cooperative');
  }

  return await Task.findByIdAndUpdate(taskId, { status: 'completed', updatedAt: new Date() });
};

const escalateTask = async (taskId, adminId) => {
  const task = await Task.findById(taskId);
  if (!task) throw new Error('Task not found');
  
  const cooperative = await Cooperative.findById(adminId);
  if (task.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot escalate task from another cooperative');
  }

  task.escalationCount += 1;
  task.status = 'escalated';
  task.escalated = true;
  task.updatedAt = new Date();
  await task.save();
  return task;
};

module.exports = { generateTasks, getTasks, completeTask, escalateTask };