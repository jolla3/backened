const Device = require('../models/device');
const logger = require('../utils/logger');

const deviceMiddleware = async (req, res, next) => {
  const deviceId = req.headers['x-device-id'];
  if (!deviceId) {
    return res.status(401).json({ error: 'Device ID required' });
  }

  try {
    const device = await Device.findOne({ uuid: deviceId });
    if (!device) {
      return res.status(404).json({ error: 'Device not registered' });
    }
    if (device.revoked) {
      return res.status(403).json({ error: 'Device revoked' });
    }
    if (!device.approved) {
      return res.status(403).json({ error: 'Device not approved' });
    }
    req.device = device;
    next();
  } catch (error) {
    logger.error('Device check failed', { error: error.message });
    res.status(500).json({ error: 'Device check failed' });
  }
};

module.exports = deviceMiddleware;