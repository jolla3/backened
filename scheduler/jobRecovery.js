const cron = require('node-cron');
const smsService = require('../services/smsService');
const gatewayService = require('../services/gatewayService');
const smsConfig = require('../config/smsConfig');
const logger = require('../utils/logger');

let isRunning = false;
let isStarted = false;

const runRecovery = async () => {
  if (isRunning) return;
  isRunning = true;
  try {
    // Recover stuck processing jobs
    const result = await smsService.recoverStuckJobs(5);
    if (result && typeof result.modifiedCount === 'number' && result.modifiedCount > 0) {
      logger.info(`Recovered ${result.modifiedCount} stuck jobs`);
    }

    // Mark stale gateways as offline
    const staleMinutes = smsConfig.heartbeatStaleMinutes || 2;
    const cutoff = new Date(Date.now() - staleMinutes * 60 * 1000);
    const gateways = await gatewayService.markOfflineIfStale(cutoff);
    if (gateways && typeof gateways.modifiedCount === 'number' && gateways.modifiedCount > 0) {
      logger.info(`Marked ${gateways.modifiedCount} gateways offline`);
    }
  } catch (error) {
    logger.error('Job recovery failed', { error: error.message });
  } finally {
    isRunning = false;
  }
};

const startJobRecovery = () => {
  if (isStarted) {
    logger.warn('Job recovery scheduler already started, ignoring duplicate call');
    return;
  }

  cron.schedule('* * * * *', runRecovery, { runOnInit: false });
  isStarted = true;
  logger.info('Job recovery scheduler started (cron)');
};

module.exports = { startJobRecovery };