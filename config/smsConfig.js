// module.exports = {
//   username: process.env.AT_USERNAME ,  // ✅ Fallback
//   apiKey: process.env.AT_API_KEY,
//   baseUrl: 'https://api.africastalking.com/version1',
//   defaultSender: process.env.AT_DEFAULT_SENDER || 'AgriWallet',
//   timeout: 10000
// };  


// module.exports = {
//   baseUrl: process.env.SMS_BASE_URL || 'https://api.sandbox.africastalking.com/version1',
//   username: process.env.SMS_USERNAME || 'sandbox',
//   apiKey: process.env.SMS_API_KEY || 'atsk_6e0efd129486f98c7ccded33dd3b278cfe161471a6bac9833815d111404215debb9af58d',
//   defaultSender: process.env.SMS_SENDER || 'AgriWallet',
//   retryConfig: {
//     maxRetries: 3,
//     initialDelay: 1000,  // 1 second
//     maxDelay: 10000,     // 10 seconds
//     backoffFactor: 2,
//   }
// };

// module.exports = {
//   baseUrl: process.env.SMS_BASE_URL || 'https://api.sandbox.africastalking.com/version1',
//   username: process.env.SMS_USERNAME || 'sandbox',
//   apiKey: process.env.SMS_API_KEY || 'atsk_6e0efd129486f98c7ccded33dd3b278cfe161471a6bac9833815d111404215debb9af58d',
//   // ✅ For sandbox, you must use a numeric sender ID or use the default (the phone number of the sender)
//   // You can also use: 'AFRICASTKNG' or your phone number
//   defaultSender: process.env.SMS_SENDER || 'AFRICASTKNG',  // 'AFRICASTKNG' works in sandbox
//   retryConfig: {
//     maxRetries: 3,
//     initialDelay: 1000,
//     maxDelay: 10000,
//     backoffFactor: 2,
//   }
// };

// config/smsConfig.js
module.exports = {
  // Retry delays in seconds
  RETRY_DELAYS: [30, 60, 120, 300],
  MAX_RETRIES: 3,
  PRIORITY: {
    OTP: 100,
    PASSWORD_RESET: 90,
    MILK_RECEIPT: 80,
    FEED_PURCHASE: 70,
    MONTHLY_SUMMARY: 60,
    GENERAL: 50,
  },
  // Gateway polling interval (seconds)
  gatewayPollIntervalSeconds: 3,
  // Minimum gateway app version required
  minGatewayVersion: '1.0.0',
  // Heartbeat stale threshold (minutes)
  heartbeatStaleMinutes: 2,
};


module.exports = {
  MAX_RETRIES: parseInt(process.env.SMS_MAX_RETRIES || '3', 10),
  RETRY_DELAYS: [30, 60, 120, 300], // seconds – index by retryCount-1
  gatewayPollIntervalSeconds: 3,
  minGatewayVersion: '1.0.0',
};