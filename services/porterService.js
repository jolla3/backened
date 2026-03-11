const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// Create Porter with Cooperative Scoping
const createPorter = async (data, adminId) => {
  const { cooperativeId, ...porterData } = data;

  // Validate cooperative exists
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  // Verify admin belongs to the cooperative
  if (cooperative.adminId.toString() !== adminId) {
    throw new Error('Unauthorized: Admin does not belong to this cooperative');
  }

  const porter = await Porter.create({
    ...porterData,
    cooperativeId
  });

  logger.info('Porter created', { porterId: porter._id, cooperativeId });
  return porter;
};

// Get Porter by ID (with Cooperative Scoping)
const getPorter = async (porterId, adminId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to admin's cooperative
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Porter does not belong to your cooperative');
  }

  return porter;
};

// Update Porter (with Cooperative Scoping)
const updatePorter = async (porterId, data, adminId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to admin's cooperative
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot modify porters from other cooperatives');
  }

  const updatedPorter = await Porter.findByIdAndUpdate(
    porterId,
    { $set: data },
    { new: true, runValidators: true }
  );

  logger.info('Porter updated', { porterId, adminId });
  return updatedPorter;
};

// Delete Porter (with Cooperative Scoping)
const deletePorter = async (porterId, adminId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to admin's cooperative
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot delete porters from other cooperatives');
  }

  await Porter.findByIdAndDelete(porterId);

  logger.info('Porter deleted', { porterId, adminId });
  return { message: 'Porter deleted successfully' };
};

// Get All Porters for Admin's Cooperative
const getAllPorters = async (adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative) {
    throw new Error('Cooperative not found for this admin');
  }

  const porters = await Porter.find({ cooperativeId: cooperative._id })
    .select('-pin')
    .sort({ createdAt: -1 });

  logger.info('Porters retrieved', { count: porters.length, cooperativeId: cooperative._id });
  return porters;
};

// Get Porter Performance (Scoped to Cooperative)
const getPerformance = async (porterId, adminId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to admin's cooperative
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Porter does not belong to your cooperative');
  }

  const stats = await Transaction.aggregate([
    { $match: { porter_id: porter._id, cooperativeId: cooperative._id } },
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }}
  ]);

  return {
    ...porter.toObject(),
    performance: stats[0] || { totalLitres: 0, totalPayout: 0, transactionCount: 0 }
  };
};

module.exports = {
  createPorter,
  getPorter,
  updatePorter,
  deletePorter,
  getAllPorters,
  getPerformance
};