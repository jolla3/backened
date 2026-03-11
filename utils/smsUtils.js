// utils/smsUtil.js
const axios = require('axios');
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

/**
 * Low-level SMS API call to Africa's Talking
 * @param {Object} params - SMS parameters
 * @returns {Promise<Object>} API response
 */
const sendSMS = async ({ to, message, from }) => {
  try {
    const response = await axios.post(
      `${smsConfig.baseUrl}/sms`,
      {
        to,
        message,
        from
      },
      {
        headers: {
          'Api-Key': smsConfig.apiKey,
          'Username': smsConfig.username,
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
      code: error.code
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