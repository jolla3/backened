const axios = require('axios');
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

const sendSMS = async ({ to, message, from }) => {
  try {
    // ✅ FIXED: Africa's Talking SMS endpoint
    const response = await axios.post(
      `${smsConfig.baseUrl}/messaging`,  // ✅ FIXED: /messaging not /sms
      {
        to,
        message,
        from: from || smsConfig.defaultSender
      },
      {
        headers: {
          'apiKey': smsConfig.apiKey,     // ✅ FIXED: apiKey (lowercase)
          'Content-Type': 'application/json'
        },
        timeout: smsConfig.timeout
      }
    );

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    logger.error('SMS API call failed', {
      error: error.message,
      code: error.code,
      status: error.response?.status,
      endpoint: `${smsConfig.baseUrl}/messaging`
    });

    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  sendSMS
};