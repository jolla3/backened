const deviceService = require('../services/deviceService');
const logger = require('../utils/logger');

const register = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const adminId = req.user.id;
    const {
      deviceId,      // from frontend (uuid)
      deviceName,
      osBuildId,
      platform,
      hardware_id
    } = req.body;

    const device = await deviceService.registerDevice({
      deviceId,
      deviceName,
      osBuildId,
      platform,
      hardware_id,
      adminId,
      cooperativeId
    });

    res.status(201).json(device);
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({ error: 'Device already registered' });
    }
    logger.error('Device registration failed', { error: error.message, stack: error.stack });
    res.status(400).json({ error: error.message });
  }
};

const approve = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const device = await deviceService.approveDevice(req.params.id, cooperativeId);
    res.json(device);
  } catch (error) {
    logger.error('Device approval failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

const revoke = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const device = await deviceService.revokeDevice(req.params.id, cooperativeId);
    res.json(device);
  } catch (error) {
    logger.error('Device revoke failed', { error: error.message, coopId: req.user?.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { register, approve, revoke };