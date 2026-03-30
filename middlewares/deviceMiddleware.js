const Device = require('../models/device');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const deviceMiddleware = async (req, res, next) => {
  const deviceId = req.headers['x-device-id'];
  const authHeader = req.headers.authorization;

  // 1. Check for device ID
  if (!deviceId) {
    return res.status(401).json({
      error: 'Device ID required',
      message: 'Please include X-Device-ID header'
    });
  }

  // 2. Check for JWT token
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'Authorization required',
      message: 'Please include Bearer token'
    });
  }

  const token = authHeader.split(' ')[1];

  try {
    // 3. Verify JWT and attach user to request
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // now contains cooperativeId, id, role, etc.

    // 4. Find and validate device
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
    req.branch_id = device.branch;
    next();
  } catch (error) {
    if (error.name === 'JsonWebTokenError') {
      return res.status(401).json({ error: 'Invalid token' });
    }
    if (error.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
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