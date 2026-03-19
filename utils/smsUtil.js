const axios = require('axios');
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

const sendSMS = async ({ to, message, from }) => {
  try {
    // ✅ FIXED: Correct Africa's Talking SMS endpoint
    const response = await axios.post(
      `${smsConfig.baseUrl}/messaging`,  // v1/messaging ✅
      {
        to,
        message,
        from: from || smsConfig.defaultSender
      },
      {
        headers: {
          'apiKey': smsConfig.apiKey,  // ✅ lowercase apiKey
          'Content-Type': 'application/json'
        },
        timeout: smsConfig.timeout
      }
    );

    logger.info('SMS sent successfully', { 
      to, 
      smsId: response.data.SMSMessageData?.Message,
      recipients: response.data.SMSMessageData?.Recipients?.length 
    });

    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    logger.error('SMS API call failed', {
      error: error.message,
      code: error.code,
      status: error.response?.status,
      statusText: error.response?.statusText,
      endpoint: `${smsConfig.baseUrl}/messaging`,
      to,
      response: error.response?.data
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