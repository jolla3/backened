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

  // FIX: Use returnDocument instead of new option
  const updatedFarmer = await Farmer.findByIdAndUpdate(
    farmerId,
    { $set: data },
    { 
      new: true, // Keep for backward compatibility, but returnDocument is preferred
      returnDocument: 'after', // NEW: Returns the updated document
      runValidators: true 
    }
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

// Get All Farmers for Admin's Cooperative
// farmerService.js

// Get All Farmers for Admin's Cooperative (with balance)
const getAllFarmers = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative) {
    throw new Error('Cooperative not found for this admin');
  }

  // Get all farmers for the cooperative
  const farmers = await Farmer.find({ cooperativeId: cooperative._id })
    .sort({ createdAt: -1 })
    .lean(); // Use lean() to get plain objects for easier modification

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

// ✅ FIXED: Remove fake balance calls, use transactionService directly
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

  // ✅ USE RICH DATA FROM transactionService
  const result = await transactionService.getFarmerHistory(farmer.farmer_code, limit, adminId);
  
  if (result.error) {
    throw new Error(result.error);
  }
  
  return result;  // ✅ Returns { farmer: {...}, transactions: [...], stats: {...} }
};

// ✅ FIXED: Real balance from transactions
const getBalance = async (farmerId, adminId) => {
  const farmer = await Farmer.findById(farmerId);
  
  if (!farmer) {
    throw new Error('Farmer not found');
  }

  const cooperative = await Cooperative.findOne({ adminId: adminId });
  if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
    throw new Error('Unauthorized');
  }

  // ✅ Get FULL history to calculate balance
  const result = await transactionService.getFarmerHistory(farmer.farmer_code, 1000, adminId);
  
  if (result.error) {
    throw new Error(result.error);
  }

  return {
    id: farmer._id,
    name: farmer.name,
    farmerCode: farmer.farmer_code,
    balance: result.farmer.balance,        // ✅ REAL
    milkIncome: result.farmer.milkIncome,  // ✅ REAL
    feedCost: result.farmer.feedCost,      // ✅ REAL
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

// Get Farmer History (Scoped to Cooperative)
// const getFarmerHistory = async (farmerId, adminId, limit = 50) => {
//   const farmer = await Farmer.findById(farmerId);
  
//   if (!farmer) {
//     throw new Error('Farmer not found');
//   }

//   // Verify farmer belongs to admin's cooperative
//   const cooperative = await Cooperative.findOne({ adminId: adminId });
//   if (!cooperative || farmer.cooperativeId.toString() !== cooperative._id.toString()) {
//     throw new Error('Unauthorized: Farmer does not belong to your cooperative');
//   }

//   const history = await Transaction.find({ 
//     farmer_id: farmer._id,
//     cooperativeId: cooperative._id 
//   })
//   .sort({ timestamp_server: -1 })
//   .limit(limit)
//   .lean();

//   return {
//     farmer: {
//       code: farmer.farmer_code,
//       name: farmer.name,
//       balance: farmer.balance
//     },
//     history
//   };
// };

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