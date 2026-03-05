// backend/src/config/redis.js
const Redis = require('ioredis');
const config = require('./index');

let redis;

try {
  redis = new Redis(config.REDIS_URL);
  redis.on('error', (err) => console.error('Redis Error', err));
  redis.on('connect', () => console.log('Redis Connected'));
} catch (error) {
  console.warn('⚠️ Redis not available, SMS queue will be disabled');
  redis = null;
}

module.exports = redis;