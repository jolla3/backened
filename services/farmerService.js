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

// Get All Farmers for Admin's Cooperative (with balance)
const getAllFarmers = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative) {
    throw new Error('Cooperative not found for this admin');
  }

  // Get all farmers for the cooperative
  const farmers = await Farmer.find({ cooperativeId: cooperative._id })
    .sort({ createdAt: -1 })
    .lean();

  // Attach balance to each farmer using the getBalance function
  const farmersWithBalance = await Promise.all(
    farmers.map(async (farmer) => {
      try {
        const balanceData = await getBalance(farmer._id, adminId);
        return {
          ...farmer,
          balance: balanceData.balance,
          milkIncome: balanceData.milkIncome,
          feedCost: balanceData.feedCost,
        };
      } catch (error) {
        console.error(`Failed to fetch balance for farmer ${farmer.farmer_code}:`, error.message);
        // Return farmer with zero balance if error occurs (keep the farmer in the list)
        return { ...farmer, balance: 0, milkIncome: 0, feedCost: 0 };
      }
    })
  );

  logger.info('Farmers retrieved with balances', {
    count: farmersWithBalance.length,
    cooperativeId: cooperative._id,
  });

  return farmersWithBalance;
};

// ✅ FIXED: Real balance from transactions (pass cooperativeId)
const getBalance = async (farmerId, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized');
  }

  // ✅ Pass the farmer's cooperativeId, not adminId
  const result = await transactionService.getFarmerHistory(farmer.farmer_code, 1000, farmer.cooperativeId);
  
  if (result.error) {
    throw new Error(result.error);
  }

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

// Update Farmer Balance (with Cooperative Scoping)
const updateBalance = async (farmerId, amount, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // Verify farmer belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Cannot update balance for farmers from other cooperatives');
  }

  // Ensure amount is a number
  const numericAmount = Number(amount);

  const session = await Farmer.startSession();
  session.startTransaction();
  
  try {
    farmer.balance += numericAmount;
    await farmer.save({ session });
    
    await session.commitTransaction();
    logger.info('Balance updated', { farmerId, amount: numericAmount, adminId });
    return farmer;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

// ✅ FIXED: Get Farmer History – passes farmer.cooperativeId to transactionService
const getFarmerHistory = async (farmerId, adminId, limit = 50) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  // Verify farmer belongs to admin's cooperative
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized: Farmer does not belong to your cooperative');
  }

  // ✅ Pass the farmer's cooperativeId, not adminId
  const result = await transactionService.getFarmerHistory(farmer.farmer_code, limit, farmer.cooperativeId);
  
  if (result.error) {
    throw new Error(result.error);
  }
  
  return result;  // ✅ Returns { farmer: {...}, transactions: [...], stats: {...} }
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