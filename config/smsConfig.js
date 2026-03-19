module.exports = {
  username: process.env.AT_USERNAME,
  apiKey: process.env.AT_API_KEY,
  baseUrl: 'https://api.africastalking.com/version1',  // ✅ FIXED: version1
  defaultSender: 'AgriWallet',
  timeout: 10000
};