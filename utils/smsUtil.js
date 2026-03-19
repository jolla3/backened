const axios = require('axios');
const qs = require('qs');
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

const sendSMS = async ({ to, message, from }) => {
  try {
    const formData = qs.stringify({
      username: smsConfig.username,     // ✅ FIXED: REQUIRED
      to,
      message,
      from: from || smsConfig.defaultSender
    });

    const response = await axios.post(
      `${smsConfig.baseUrl}/messaging`,
      formData,
      {
        headers: {
          'apiKey': smsConfig.apiKey,           // ✅ apiKey header
          'username': smsConfig.username,       // ✅ username header  
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: smsConfig.timeout
      }
    );

    logger.info('SMS sent successfully', { 
      to, 
      messageId: response.data.SMSMessageData?.Message,
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
      username: smsConfig.username ? 'set' : 'MISSING',
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