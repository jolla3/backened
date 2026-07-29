// utils/retry.js
const logger = require('./logger');

const withRetry = async (fn, options, context = 'operation') => {
  const {
    maxRetries = 3,
    initialDelay = 1000,
    maxDelay = 10000,
    backoffFactor = 2,
  } = options;

  let attempt = 0;
  let delay = initialDelay;

  while (attempt < maxRetries) {
    attempt++;
    try {
      return await fn();
    } catch (error) {
      const isRetryable =
        error.code === 'ECONNABORTED' ||
        error.code === 'ECONNRESET' ||
        error.response?.status >= 500 ||
        error.response?.status === 429;

      logger.warn(`${context} attempt ${attempt}/${maxRetries} failed`, {
        error: error.message,
        isRetryable,
      });

      if (!isRetryable || attempt === maxRetries) {
        throw error;
      }

      const jitter = Math.random() * 200;
      const waitTime = Math.min(delay + jitter, maxDelay);
      logger.info(`Retrying ${context} in ${waitTime}ms`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
      delay *= backoffFactor;
    }
  }

  throw new Error(`${context} failed after ${maxRetries} attempts`);
};

module.exports = { withRetry };