const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

// Create Porter with Cooperative Scoping
const createPorter = async (data, cooperativeId) => {
  const { cooperativeId: providedCoopId, ...porterData } = data;

  // Use provided cooperativeId or the one from the token
  const targetCooperativeId = providedCoopId || cooperativeId;

  // Validate cooperative exists
  const cooperative = await Cooperative.findById(targetCooperativeId);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  const porter = await Porter.create({
    ...porterData,
    cooperativeId: targetCooperativeId
  });

  logger.info('Porter created', { porterId: porter._id, cooperativeId: targetCooperativeId });
  return porter;
};

// Get Porter by ID (with Cooperative Scoping)
const getPorter = async (porterId, cooperativeId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to the cooperative using cooperativeId directly
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Porter does not belong to your cooperative');
  }

  return porter;
};

// Get All Porters for Cooperative
const getAllPorters = async (cooperativeId) => {
  // Use cooperativeId directly - no need to find cooperative by adminId
  const porters = await Porter.find({ cooperativeId })
    .sort({ createdAt: -1 });

  logger.info('Porters retrieved', { count: porters.length, cooperativeId });
  return porters;
};

// Update Porter (with Cooperative Scoping)
const updatePorter = async (porterId, data, cooperativeId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to the cooperative using cooperativeId directly
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Cannot modify porters from other cooperatives');
  }

  const updatedPorter = await Porter.findByIdAndUpdate(
    porterId,
    { $set: data },
    { 
      new: true,
      runValidators: true 
    }
  );

  logger.info('Porter updated', { porterId, cooperativeId });
  return updatedPorter;
};

// Delete Porter (with Cooperative Scoping)
const deletePorter = async (porterId, cooperativeId) => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to the cooperative using cooperativeId directly
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Cannot delete porters from other cooperatives');
  }

  await Porter.findByIdAndDelete(porterId);

  logger.info('Porter deleted', { porterId, cooperativeId });
  return { message: 'Porter deleted successfully' };
};

// Get Porter Performance (with Cooperative Scoping)
const getPerformance = async (porterId, cooperativeId, period = 'monthly') => {
  const porter = await Porter.findById(porterId);
  
  if (!porter) {
    throw new Error('Porter not found');
  }

  // Verify porter belongs to the cooperative using cooperativeId directly
  if (porter.cooperativeId.toString() !== cooperativeId) {
    throw new Error('Unauthorized: Cannot access performance data for porters from other cooperatives');
  }

  // Calculate performance metrics
  const now = new Date();
  let startDate;
  
  if (period === 'daily') {
    startDate = new Date(now);
    startDate.setHours(0, 0, 0, 0);
  } else if (period === 'weekly') {
    startDate = new Date(now);
    startDate.setDate(startDate.getDate() - 7);
  } else if (period === 'monthly') {
    startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 1);
  } else {
    // Default to monthly
    startDate = new Date(now);
    startDate.setMonth(startDate.getMonth() - 1);
  }

  const performance = await Transaction.aggregate([
    { $match: { 
      device_id: porter.assigned_device_id,
      cooperativeId: cooperativeId,
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