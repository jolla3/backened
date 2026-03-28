const Farmer = require('../models/farmer');
const Cooperative = require('../models/cooperative');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');
const transactionService = require('./transactionService'); // ✅ ADD THIS

// Create Farmer with Cooperative Scoping
const createFarmer = async (data, adminId) => {
  const { cooperativeId, ...farmerData } = data;

  // Validate cooperative exists
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  // Verify admin belongs to the cooperative
  if (cooperative.adminId.toString() !== adminId) {
    throw new Error('Unauthorized: Admin does not belong to this cooperative');
  }

  const farmer = await Farmer.create({
    ...farmerData,
    cooperativeId
  });

  logger.info('Farmer created', { farmerId: farmer._id, cooperativeId });
  return farmer;
};

// Get Farmer by ID (with Cooperative Scoping)
const getFarmer = async (farmerId, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // Verify farmer belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Farmer does not belong to your cooperative');
  }

  return farmer;
};

// Get Farmer by Code (with Cooperative Scoping)
const getFarmerByCode = async (farmerCode, adminId) => {
  const farmer = await Farmer.findOne({ farmer_code: farmerCode });
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // Verify farmer belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Farmer does not belong to your cooperative');
  }

  return farmer;
};

// Update Farmer (with Cooperative Scoping)
const updateFarmer = async (farmerId, data, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // Verify farmer belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot modify farmers from other cooperatives');
  }

  const updatedFarmer = await Farmer.findByIdAndUpdate(
    farmerId,
    { $set: data },
    { new: true, runValidators: true }
  );

  logger.info('Farmer updated', { farmerId, adminId });
  return updatedFarmer;
};

// Delete Farmer (with Cooperative Scoping)
const deleteFarmer = async (farmerId, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // Verify farmer belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot delete farmers from other cooperatives');
  }

  await Farmer.findByIdAndDelete(farmerId);

  logger.info('Farmer deleted', { farmerId, adminId });
  return { message: 'Farmer deleted successfully' };
};

const getAllFarmers = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId });
  if (!cooperative) throw new Error('Cooperative not found for this admin');

  const farmers = await Farmer.find({ cooperativeId: cooperative._id }).sort({ createdAt: -1 }).lean();
  const farmersWithBalance = await Promise.all(
    farmers.map(async (farmer) => {
      try {
        const balanceData = await getBalance(farmer._id, adminId);
        return { ...farmer, ...balanceData };
      } catch (error) {
        logger.error(`Failed to fetch balance for farmer ${farmer.farmer_code || farmer._id}: ${error.message}`);
        return { ...farmer, balance: 0, milkIncome: 0, feedCost: 0 };
      }
    })
  );
  return farmersWithBalance;
};

const getBalance = async (farmerId, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');

  const cooperative = await Cooperative.findOne({ adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized');
  }

  // Ensure farmer_code exists; if not, return zero
  if (!farmer.farmer_code) {
    logger.warn(`Farmer ${farmerId} has no farmer_code`);
    return {
      id: farmer._id,
      name: farmer.name,
      farmerCode: null,
      balance: 0,
      milkIncome: 0,
      feedCost: 0,
      totalLitres: 0,
      totalTransactions: 0
    };
  }

  const result = await transactionService.getFarmerHistory(farmer.farmer_code, 1000, farmer.cooperativeId);
  if (result.error) throw new Error(result.error);
  return {
    id: farmer._id,
    name: farmer.name,
    farmerCode: farmer.farmer_code,
    balance: result.farmer.balance,
    milkIncome: result.farmer.milkIncome,
    feedCost: result.farmer.feedCost,
    totalLitres: result.farmer.totalLitres,
    totalTransactions: result.farmer.totalTransactions
  };
};

const updateBalance = async (farmerId, amount, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  const cooperative = await Cooperative.findOne({ adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized');
  }

  const numericAmount = Number(amount);
  const session = await Farmer.startSession();
  session.startTransaction();
  try {
    farmer.balance += numericAmount;
    await farmer.save({ session });
    await session.commitTransaction();
    return farmer;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getFarmerHistory = async (farmerId, adminId, limit = 50) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');

  const cooperative = await Cooperative.findOne({ adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Farmer does not belong to your cooperative');
  }

  // Ensure farmer_code exists; if not, return empty history
  if (!farmer.farmer_code) {
    return {
      farmer: { id: farmer._id, name: farmer.name, code: null, phone: farmer.phone, balance: farmer.balance, milkIncome: 0, feedCost: 0, totalLitres: 0, totalTransactions: 0, netProfit: 0 },
      transactions: [],
      stats: { milkTransactions: 0, feedTransactions: 0, period: 'All Time' }
    };
  }

  const result = await transactionService.getFarmerHistory(farmer.farmer_code, limit, farmer.cooperativeId);
  if (result.error) throw new Error(result.error);
  return result;
};


module.exports = {
  createFarmer,
  getFarmer,
  getFarmerByCode,
  updateFarmer,
  deleteFarmer,
  getAllFarmers,
  getBalance,
  updateBalance,
  getFarmerHistory
};