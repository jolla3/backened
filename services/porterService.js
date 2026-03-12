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
  // FIX: Use findOne with adminId instead of findById
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Porter does not belong to your cooperative');
  }

  return porter;
};

// Get All Porters for Admin's Cooperative
const getAllPorters = async (adminId) => {
  // FIX: Use findOne with adminId instead of findById
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative) {
    throw new Error('Cooperative not found for this admin');
  }

  const porters = await Porter.find({ cooperativeId: cooperative._id })
    .sort({ createdAt: -1 });

  logger.info('Porters retrieved', { count: porters.length, cooperativeId: cooperative._id });
  return porters;
};

// Update Porter (with Cooperative Scoping)
const updatePorter = async (porterId, data, adminId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
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
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot delete porters from other cooperatives');
  }

  await Porter.findByIdAndDelete(porterId);

  logger.info('Porter deleted', { porterId, adminId });
  return { message: 'Porter deleted successfully' };
};

// Get Porter Performance (with Cooperative Scoping)
const getPerformance = async (porterId, adminId, period = 'monthly') => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || porter.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot access performance data for porters from other cooperatives');
  }

  // Calculate performance metrics
  const now = new Date();
  let startDate;
  
  if (period === 'daily') {
    startDate = new Date(now.setHours(0, 0, 0));
  } else if (period === 'weekly') {
    startDate = new Date(now.setDate(now.getDate() - 7));
  } else if (period === 'monthly') {
    startDate = new Date(now.setMonth(now.getMonth() - 1));
  }

  const performance = await Transaction.aggregate([
    { $match: { 
      device_id: porter.assigned_device_id,
      cooperativeId: cooperative._id,
      timestamp_server: { $gte: startDate }
    }},
    { $group: {
      _id: null,
      totalLitres: { $sum: '$litres' },
      totalPayout: { $sum: '$payout' },
      transactionCount: { $sum: 1 }
    }}
  ]);

  return {
    porterId: porter._id,
    porterName: porter.name,
    zones: porter.zones,
    totalLitres: performance[0]?.totalLitres || 0,
    totalPayout: performance[0]?.totalPayout || 0,
    transactionCount: performance[0]?.transactionCount || 0,
    period
  };
};

module.exports = {
  createPorter,
  getPorter,
  getAllPorters,
  updatePorter,
  deletePorter,
  getPerformance
};