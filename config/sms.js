// config/smsConfig.js
module.exports = {
  // Africa's Talking Credentials (from environment)
  username: process.env.AT_USERNAME,
  apiKey: process.env.AT_API_KEY,
  baseUrl: 'https://api.africastalking.com/v1',

  // Default sender name fallback
  defaultSender: 'AgriWallet',

  // API timeout in milliseconds
  timeout: 10000
};