const RateVersion = require('../models/rateVersion');
const logger = require('../utils/logger');

const updateRate = async (type, rate, effectiveDate, adminId) => {
  const newVersion = await RateVersion.create({
    type,
    rate,
    effective_date: effectiveDate || new Date(),
    admin_id: adminId
  });
  logger.info('Rate updated', { type, rate, adminId });
  return newVersion;
};

const getHistory = async (type) => {
  return await RateVersion.find({ type }).sort({ effective_date: -1 });
};

const getCurrentRate = async (type) => {
  return await RateVersion.findOne({ type }).sort({ effective_date: -1 });
};

module.exports = { updateRate, getHistory, getCurrentRate };