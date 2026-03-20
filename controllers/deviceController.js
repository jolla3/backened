const deviceService = require('../services/deviceService');
const logger = require('../utils/logger');

const register = async (req, res) => {
  try {
    // ✅ FIXED: Get cooperativeId from JWT (like reports controller)
    const cooperativeId = req.user.cooperativeId;
    
    const { deviceId, name, location, type, adminId, uuid, hardware_id } = req.body;
    
    // ✅ Pass cooperativeId to service
    const device = await deviceService.registerDevice({
      deviceId, 
      name, 
      location, 
      type, 
      adminId, 
      cooperativeId,  // ✅ This was missing!
      uuid, 
      hardware_id
    });
    
    res.json(device);
  } catch (error) {
    logger.error('Device registration failed', { error: error.message, coopId: req.user?.cooperativeId });
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