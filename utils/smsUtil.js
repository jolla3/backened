const axios = require('axios');
const qs = require('qs');
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

const sendSMS = async ({ to, message, from }) => {
  try {
    // ✅ FIXED: username in URL + form data
    const url = `${smsConfig.baseUrl}/messaging?username=${smsConfig.username}`;
    
    const formData = qs.stringify({
      username: smsConfig.username,  // ✅ REQUIRED in form
      to,
      message,
      from: from || smsConfig.defaultSender
    });

    logger.info('SMS Request', {
      url,
      username: smsConfig.username,
      to,
      apiKeyPreview: smsConfig.apiKey?.substring(0, 10)
    });

    const response = await axios.post(
      url,
      formData,
      {
        headers: {
          'apiKey': smsConfig.apiKey,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      }
    );

    logger.info('✅ SMS SUCCESS', response.data);
    return {
      success: true,
      data: response.data
    };
  } catch (error) {
    logger.error('SMS ERROR', {
      status: error.response?.status,
      data: error.response?.data,
      username: smsConfig.username,
      apiKeyPreview: smsConfig.apiKey ? 'OK' : 'MISSING'
    });
    return { success: false, error: error.message };
  }
};

module.exports = { sendSMS };