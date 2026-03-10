const Device = require('../models/device');
const logger = require('../utils/logger');

const deviceMiddleware = async (req, res, next) => {
  const deviceId = req.headers['x-device-id'];
  
  if (!deviceId) {
    return res.status(401).json({ 
      error: 'Device ID required',
      message: 'Please include X-Device-ID header'
    });
  }

  try {
    const device = await Device.findOne({ uuid: deviceId });
    
    if (!device) {
      return res.status(404).json({ 
        error: 'Device not registered',
        deviceId 
      });
    }
    
    if (device.revoked) {
      return res.status(403).json({ 
        error: 'Device revoked',
        deviceId 
      });
    }
    
    if (!device.approved) {
      return res.status(403).json({ 
        error: 'Device not approved',
        deviceId 
      });
    }
    
    req.device = device;
    next();
  } catch (error) {
    logger.error('Device check failed', { 
      deviceId, 
      error: error.message 
    });
    res.status(500).json({ 
      error: 'Device check failed',
      message: 'Please try again later'
    });
  }
};

module.exports = deviceMiddleware;