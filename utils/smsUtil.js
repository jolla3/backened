const axios = require('axios');
const qs = require('qs');  // npm install qs
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

const sendSMS = async ({ to, message, from }) => {
  try {
    // ✅ FIXED: URL-encoded form data (required by Africa's Talking)
    const formData = qs.stringify({
      to,
      message,
      from: from || smsConfig.defaultSender
    });

    const response = await axios.post(
      `${smsConfig.baseUrl}/messaging`,
      formData,
      {
        headers: {
          'apiKey': smsConfig.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'  // ✅ FIXED
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