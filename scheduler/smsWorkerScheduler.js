/**
 * SMS Worker Scheduler
 *
 * Starts / stops the single SmsWorker instance.
 * Called from application bootstrap (src/index.js).
 */
const { getInstance } = require('../workers/smsWorker');
const logger = require('../utils/logger');

let started = false;

const startSmsWorker = async () => {
  if (started) {
    logger.warn('SMS worker already started');
    return;
  }
  const worker = getInstance();
  await worker.start();
  started = true;
  logger.info('SMS worker scheduler started');
};

const stopSmsWorker = async () => {
  if (!started) return;
  const worker = getInstance();
  await worker.stop();
  started = false;
  logger.info('SMS worker scheduler stopped');
};

module.exports = {
  startSmsWorker,
  stopSmsWorker,
};