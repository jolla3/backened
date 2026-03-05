const logger = require('../utils/logger');

const errorMiddleware = (err, req, res, next) => {
  logger.error('Unhandled Error', {
    error: err.message,
    stack: err.stack,
    correlationId: req.correlationId
  });

  const status = err.status || 500;
  const message = err.message || 'Internal Server Error';

  res.status(status).json({
    error: message,
    correlationId: req.correlationId
  });
};

module.exports = errorMiddleware;