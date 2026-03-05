const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');

const correlationMiddleware = (req, res, next) => {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);
  logger.info(`Request started`, { correlationId, method: req.method, url: req.url });
  next();
};

module.exports = correlationMiddleware;