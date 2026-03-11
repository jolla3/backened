// middlewares/authMiddleware.js
const jwt = require('jsonwebtoken');
const config = require('../config');
const logger = require('../utils/logger');

const authMiddleware = async (req, res, next) => {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'No token provided' });
  }

  const token = authHeader.split(' ')[1];

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET);
    
    // Attach user info including cooperativeId
    req.user = {
      id: decoded.id,
      role: decoded.role,
      cooperativeId: decoded.cooperativeId
    };
    
    next();
  } catch (error) {
    logger.error('Auth failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    return res.status(401).json({ error: 'Invalid token' });
  }
};

const roleCheck = (...roles) => {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      logger.warn('Forbidden access', { 
        userId: req.user.id,
        requestedRole: req.user.role,
        requiredRoles: roles,
        correlationId: req.correlationId 
      });
      return res.status(403).json({ error: 'Forbidden: Insufficient permissions' });
    }

    next();
  };
};

module.exports = { authMiddleware, roleCheck };