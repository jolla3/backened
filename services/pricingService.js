const RateVersion = require('../models/rateVersion');
const logger = require('../utils/logger');

const updateRate = async (type, rate, effectiveDate, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  
  const newVersion = await RateVersion.create({
    type,
    rate,
    effective_date: effectiveDate || new Date(),
    admin_id: adminId,
    cooperativeId: cooperative._id
  });
  
  logger.info('Rate updated', { type, rate, adminId });
  return newVersion;
};

const getHistory = async (type, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  return await RateVersion.find({ type, cooperativeId: cooperative._id }).sort({ effective_date: -1 });
};

const getCurrentRate = async (type, adminId) => {
  const cooperative = await Cooperative.findById(adminId);
  return await RateVersion.findOne({ type, cooperativeId: cooperative._id }).sort({ effective_date: -1 });
};

module.exports = { updateRate, getHistory, getCurrentRate };