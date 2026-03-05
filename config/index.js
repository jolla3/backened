require('dotenv').config();
module.exports = {
  DB_URL: process.env.DB_URL,
  REDIS_URL: process.env.REDIS_URL,
  JWT_SECRET: process.env.JWT_SECRET,
  HMAC_SECRET: process.env.HMAC_SECRET,
  SMS_API_KEY: process.env.SMS_API_KEY,
  SMS_FROM_NUMBER: process.env.SMS_FROM_NUMBER,
  PORT: process.env.PORT || 3000,
  NODE_ENV: process.env.NODE_ENV || 'development'
};