// Placeholder for queueing logic if BullMQ is down
// Preferably handled in service layer
const offlineQueueMiddleware = (req, res, next) => {
  next();
};

module.exports = offlineQueueMiddleware;