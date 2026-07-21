const cooperativeService = require('../services/cooperativeService');
const logger = require('../utils/logger');

/**
 * GET /coop
 * Returns the cooperative belonging to the authenticated user.
 * Uses req.user.cooperativeId from JWT.
 */
const getProfile = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }
    const profile = await cooperativeService.getProfile(cooperativeId);
    res.json(profile);
  } catch (error) {
    logger.error('Get cooperative profile failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
};

/**
 * PUT /coop
 * Updates the cooperative belonging to the authenticated user.
 * Only SUPER_ADMIN can update (role check in routes).
 */
const updateProfile = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    if (!cooperativeId) {
      return res.status(400).json({ error: 'Cooperative ID missing from token' });
    }
    const profile = await cooperativeService.updateProfile(cooperativeId, req.body);
    res.json(profile);
  } catch (error) {
    logger.error('Update cooperative profile failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

module.exports = {
  getProfile,
  updateProfile,
};