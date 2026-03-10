const Task = require('../models/task');
const Farmer = require('../models/farmer');
const Porter = require('../models/porter');
const Device = require('../models/device');
const Transaction = require('../models/transaction');
const Inventory = require('../models/inventory');

const generateTasks = async () => {
  const tasks = [];

  // 1. Device Inactivity Tasks
  const devices = await Device.find({ approved: true, revoked: false });
  for (const device of devices) {
    const lastTx = await Transaction.findOne({ device_id: device.uuid }).sort({ timestamp_server: -1 });
    if (lastTx) {
      const hours = (Date.now() - new Date(lastTx.timestamp_server)) / 36e5;
      if (hours > 24) {
        tasks.push({
          title: `Device ${device.uuid} inactive for ${hours.toFixed(0)} hours`,
          description: `Last sync was ${hours.toFixed(0)} hours ago. Investigate immediately.`,
          assignedToType: 'admin',
          priority: hours > 48 ? 'critical' : 'high',
          status: 'pending',
          category: 'device',
          dueDate: new Date(Date.now() + 24 * 36e5)
        });
      }
    }
  }

  // 2. Farmer Inactivity Tasks
  const farmers = await Farmer.find({});
  for (const farmer of farmers) {
    const lastTx = await Transaction.findOne({ farmer_id: farmer._id, type: 'milk' }).sort({ timestamp_server: -1 });
    if (lastTx) {
      const days = (Date.now() - new Date(lastTx.timestamp_server)) / 86400000;
      if (days > 7) {
        tasks.push({
          title: `Farmer ${farmer.name} inactive for ${days.toFixed(0)} days`,
          description: `No milk delivery in ${days.toFixed(0)} days. Contact farmer.`,
          assignedToType: 'porter',
          priority: days > 14 ? 'critical' : 'high',
          status: 'pending',
          category: 'farmer',
          dueDate: new Date(Date.now() + 3 * 86400000)
        });
      }
    }
  }

  // 3. High Debt Tasks
  const highDebtFarmers = await Farmer.find({ balance: { $lt: -10000 } });
  for (const farmer of highDebtFarmers) {
    tasks.push({
      title: `Farmer ${farmer.name} has high debt`,
      description: `Outstanding balance: KES ${Math.abs(farmer.balance).toLocaleString()}. Payment plan required.`,
      assignedToType: 'admin',
      priority: 'high',
      status: 'pending',
      category: 'financial',
      dueDate: new Date(Date.now() + 7 * 86400000)
    });
  }

  // 4. Stockout Risk Tasks
  const lowStock = await Inventory.aggregate([
    { $match: { $expr: { $lte: ['$stock', '$threshold'] } } },
    { $limit: 3 }
  ]);
  for (const product of lowStock) {
    tasks.push({
      title: `Restock ${product.name}`,
      description: `Only ${product.stock} units remaining. Threshold: ${product.threshold}.`,
      assignedToType: 'admin',
      priority: 'high',
      status: 'pending',
      category: 'inventory',
      dueDate: new Date(Date.now() + 3 * 86400000)
    });
  }

  // 5. Porter Zero Activity Tasks
  const porters = await Porter.find({});
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  for (const porter of porters) {
    const porterTx = await Transaction.countDocuments({ device_id: porter._id, timestamp_server: { $gte: today } });
    if (porterTx === 0) {
      tasks.push({
        title: `Porter ${porter.name} has zero activity today`,
        description: `No transactions recorded today. Check device and route.`,
        assignedToType: 'admin',
        priority: 'medium',
        status: 'pending',
        category: 'porter',
        dueDate: new Date(Date.now() + 24 * 36e5)
      });
    }
  }

  return tasks.sort((a, b) => {
    const priorityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
    return priorityOrder[b.priority] - priorityOrder[a.priority];
  });
};

const getTasks = async (status = 'pending') => {
  return await Task.find({ status }).sort({ priority: -1, createdAt: -1 });
};

const completeTask = async (taskId) => {
  return await Task.findByIdAndUpdate(taskId, { status: 'completed', updatedAt: new Date() });
};

const escalateTask = async (taskId) => {
  const task = await Task.findById(taskId);
  if (task) {
    task.escalationCount += 1;
    task.status = 'escalated';
    task.escalated = true;
    task.updatedAt = new Date();
    await task.save();
    return task;
  }
  return null;
};

module.exports = { generateTasks, getTasks, completeTask, escalateTask };