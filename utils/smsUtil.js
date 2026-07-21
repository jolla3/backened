const axios = require('axios');
const qs = require('qs');
const smsConfig = require('../config/smsConfig');
const logger = require('./logger');

const sendSMS = async ({ to, message, from }) => {
  const cleanTo = to.replace(/^\+/, '');
  const maxRetries = smsConfig.retryConfig?.maxRetries || 3;
  let attempt = 0;
  let delay = smsConfig.retryConfig?.initialDelay || 1000;

  while (attempt < maxRetries) {
    attempt++;
    try {
      const base = smsConfig.baseUrl.replace(/\/+$/, '');
      const url = `${base}/messaging?username=${smsConfig.username}`;

      const sender = from || smsConfig.defaultSender || 'AFRICASTKNG';

      console.log('[SMS Util] Sender being used:', sender);

      const formData = qs.stringify({
        username: smsConfig.username,
        to: cleanTo,
        message: message.substring(0, 160),
        from: sender
      });

      logger.info(`SMS attempt ${attempt}/${maxRetries}`, {
        to: cleanTo,
        from: sender,
        url,
        username: smsConfig.username,
        apiKeyPreview: smsConfig.apiKey?.substring(0, 10) + '...'
      });

      const response = await axios.post(
        url,
        formData,
        {
          headers: {
            'apiKey': smsConfig.apiKey,
            'Content-Type': 'application/x-www-form-urlencoded',
            'Accept': 'application/json'
          },
          timeout: 15000
        }
      );

      const data = response.data;
      if (data && data.SMSMessageData) {
        const recipients = data.SMSMessageData.Recipients || [];

        // ✅ Africa's Talking: 100 = Success, 101 = Queued (both are good)
        const isDelivered = recipients.every(r => r.statusCode === 100 || r.statusCode === 101);

        if (recipients.length === 0) {
          const errorMsg = data.SMSMessageData.Message || 'Unknown error';
          throw new Error(`SMS failed: ${errorMsg}`);
        }

        if (!isDelivered) {
          const errors = recipients
            .filter(r => r.statusCode !== 100 && r.statusCode !== 101)
            .map(r => `${r.number}: ${r.status} (code ${r.statusCode})`)
            .join(', ');
          throw new Error(`SMS delivery failed: ${errors}`);
        }

        // ✅ Log success even if queued
        const firstStatus = recipients[0]?.status || 'Unknown';
        logger.info('✅ SMS accepted', { to: cleanTo, attempt, status: firstStatus });
        return { success: true, data: response.data };
      }

      logger.info('✅ SMS sent (no recipient data)', { to: cleanTo, attempt });
      return { success: true, data: response.data };

    } catch (error) {
      const isRetryable = error.code === 'ECONNABORTED' ||
                          error.code === 'ECONNRESET' ||
                          error.response?.status >= 500 ||
                          error.response?.status === 429;

      logger.error(`SMS attempt ${attempt} failed`, {
        to: cleanTo,
        status: error.response?.status,
        data: error.response?.data,
        message: error.message
      });

      if (!isRetryable || attempt === maxRetries) {
        const errorMessage = error.response?.data?.error ||
                            error.response?.data?.SMSMessageData?.Message ||
                            error.message;
        return {
          success: false,
          error: errorMessage
        };
      }

      const jitter = Math.random() * 200;
      const waitTime = Math.min(delay + jitter, smsConfig.retryConfig?.maxDelay || 10000);
      logger.warn(`SMS retry ${attempt} after ${waitTime}ms`, { to: cleanTo });
      await new Promise(resolve => setTimeout(resolve, waitTime));
      delay *= smsConfig.retryConfig?.backoffFactor || 2;
    }
  }

  return { success: false, error: 'Max retries exceeded' };
};

module.exports = { sendSMS };