const deviceService = require('../services/deviceService');
const logger = require('../utils/logger');

const register = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const adminId = req.user.id;  // ✅ FIXED: Get from JWT (69a9b8041906e5cc2b40db84)
    
    const { deviceId, name, location, type, uuid, hardware_id } = req.body;
    
    const device = await deviceService.registerDevice({
      deviceId,           // → uuid: deviceId
      name, 
      location, 
      type, 
      adminId,            // ✅ JWT user ID: "69a9b8041906e5cc2b40db84"
      cooperativeId,      // ✅ JWT coop ID: "69b31bedf575f028cbd92a63"
      uuid, 
      hardware_id
    });
    
    res.json(device);
  } catch (error) {
    logger.error('Device registration failed', { 
      error: error.message, 
      coopId: req.user?.cooperativeId,
      adminId: req.user?.id,
      body: req.body 
    });
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