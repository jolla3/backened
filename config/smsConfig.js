module.exports = {
  username: process.env.AT_USERNAME ,  // ✅ Fallback
  apiKey: process.env.AT_API_KEY,
  baseUrl: 'https://api.africastalking.com/version1',
  defaultSender: process.env.AT_DEFAULT_SENDER || 'AgriWallet',
  timeout: 10000
};