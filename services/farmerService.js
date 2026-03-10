const Farmer = require('../models/farmer');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

const createFarmer = async (data) => {
  return await Farmer.create(data);
};

const getBalance = async (farmerId) => {
  const farmer = await Farmer.findById(farmerId);
  if (!farmer) throw new Error('Farmer not found');
  return { id: farmer._id, name: farmer.name, balance: farmer.balance };
};

const updateBalance = async (farmerId, amount) => {
  const session = await Farmer.startSession();
  session.startTransaction();
  try {
    const farmer = await Farmer.findById(farmerId).session(session);
    if (!farmer) throw new Error('Farmer not found');
    
    farmer.balance += amount;
    await farmer.save({ session });
    
    await session.commitTransaction();
    logger.info('Balance updated', { farmerId, amount });
    return farmer;
  } catch (error) {
    await session.abortTransaction();
    throw error;
  } finally {
    session.endSession();
  }
};

const getBalanceHistory = async (farmerId) => {
  return await Transaction.find({ farmer_id: farmerId }).sort({ timestamp_server: -1 });
};

module.exports = { createFarmer, getBalance, updateBalance, getBalanceHistory };