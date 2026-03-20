const deviceService = require('../services/deviceService');
const logger = require('../utils/logger');

const register = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const adminId = req.user.id;  // ✅ Send JWT user ID as adminId
    
    const { deviceId, name, location, type, uuid, hardware_id } = req.body;
    
    const device = await deviceService.registerDevice({
      deviceId, 
      name, 
      location, 
      type, 
      adminId,           // ✅ Pass JWT user ID
      cooperativeId,
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