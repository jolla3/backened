const Cooperative = require('../models/Cooperative');
const logger = require('../utils/logger');

/**
 * Map flat frontend fields to nested schema fields.
 */
const mapCooperativeUpdate = (data) => {
  const update = {};
  if (data.name) update.name = data.name;
  if (data.registrationNumber) update.registrationNumber = data.registrationNumber;
  if (data.county) update.county = data.county; // top-level county
  if (data.town) update['location.address'] = data.town; // map town to location.address
  if (data.phone) update['contact.phone'] = data.phone;
  if (data.email) update['contact.email'] = data.email;
  if (data.website) update.website = data.website; // new field
  return update;
};

/**
 * Get cooperative profile.
 */
const getProfile = async (cooperativeId) => {
  const coop = await Cooperative.findById(cooperativeId);
  if (!coop) throw new Error('Cooperative not found');
  return coop;
};

/**
 * Update cooperative profile with proper field mapping.
 */
const updateProfile = async (cooperativeId, data) => {
  const updates = mapCooperativeUpdate(data);
  if (Object.keys(updates).length === 0) {
    throw new Error('No valid fields to update');
  }

  const coop = await Cooperative.findByIdAndUpdate(
    cooperativeId,
    { $set: updates },
    { new: true, runValidators: true }
  );
  if (!coop) throw new Error('Cooperative not found');
  logger.info('Cooperative profile updated', { cooperativeId, updates });
  return coop;
};

module.exports = {
  getProfile,
  updateProfile,
};