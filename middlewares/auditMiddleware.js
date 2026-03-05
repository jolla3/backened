const AuditLog = require('../models/auditLog');
const logger = require('../utils/logger');

const auditMiddleware = async (req, res, next) => {
  const originalSend = res.send;
  res.send = async (body) => {
    if (req.method !== 'GET' && req.user) {
      await AuditLog.create({
        action: `${req.method} ${req.path}`,
        user_id: req.user.id,
        user_role: req.user.role,
        details: req.body,
        correlation_id: req.correlationId
      });
    }
    return originalSend.call(res, body);
  };
  next();
};

module.exports = auditMiddleware;