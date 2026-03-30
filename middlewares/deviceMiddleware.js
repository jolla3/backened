const Device = require('../models/device');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

module.exports = async (req, res, next) => {
  const deviceId = req.headers['x-device-id'];
  const authHeader = req.headers.authorization;

  if (!deviceId) {
    return res.status(401).json({ error: 'Device ID required' });
  }
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authorization required' });
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // contains cooperativeId

    const device = await Device.findOne({ uuid: deviceId });
    if (!device) return res.status(404).json({ error: 'Device not registered' });
    if (device.revoked) return res.status(403).json({ error: 'Device revoked' });
    if (!device.approved) return res.status(403).json({ error: 'Device not approved' });

    req.device = device;
    req.branch_id = device.branch;
    next();
  } catch (err) {
    if (err.name === 'JsonWebTokenError') return res.status(401).json({ error: 'Invalid token' });
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    logger.error('Device middleware error', err);
    res.status(500).json({ error: 'Server error' });
  }
};