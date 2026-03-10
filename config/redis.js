// Keep this file but make it optional
const Redis = require('ioredis');
const logger = require('../utils/logger');

let redisClient = null;

try {
  redisClient = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy: (times) => Math.min(times * 50, 2000)
  });

  redisClient.on('error', (err) => logger.error(`Redis Client Error: ${err}`));
  redisClient.on('connect', () => logger.info('Redis Connected'));
} catch (error) {
  logger.warn('Redis connection failed, continuing without Redis');
  redisClient = null;
}

module.exports = redisClient;