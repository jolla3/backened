const Porter = require('../models/porter');
const User = require('../models/user');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

const createPorter = async (data) => {
  return await Porter.create(data);
};

const getPorter = async (porterId) => {
  const porter = await Porter.findById(porterId);
  if (!porter) throw new Error('Porter not found');
  return porter;
};

const updatePorter = async (porterId, data) => {
  const porter = await Porter.findByIdAndUpdate(
    porterId,
    { $set: data },
    { new: true, runValidators: true }
  );
  if (!porter) throw new Error('Porter not found');
  return porter;
};

const deletePorter = async (porterId) => {
  const porter = await Porter.findByIdAndDelete(porterId);
  if (!porter) throw new Error('Porter not found');
  return { message: 'Porter deleted successfully' };
};

const getPerformance = async (porterId) => {
  const porter = await Porter.findById(porterId);
  if (!porter) return null;

  const stats = await Transaction.aggregate([
    { $match: { device_id: porterId } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' }
    }}
  ]);

  return {
    ...porter.toObject(),
    performance: stats[0] || { totalLitres: 0, totalPayout: 0 }
  };
};

module.exports = {
  createPorter,
  getPorter,
  updatePorter,
  deletePorter,
  getPerformance
};