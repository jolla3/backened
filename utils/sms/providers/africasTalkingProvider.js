// sms/providers/africasTalkingProvider.js
const axios = require('axios');
const qs = require('qs');
const smsConfig = require('../../config/smsConfig');
const logger = require('../../utils/logger');
const { withRetry } = require('../../utils/retry');
const { normalizePhone } = require('../../utils/phoneUtils');

const sendSMS = async ({ to, message, from }) => {
  const cleanTo = normalizePhone(to).replace(/^\+/, ''); // Africa's Talking expects no '+'
  const sender = from || smsConfig.defaultSender || 'AFRICASTKNG';

  const base = smsConfig.baseUrl.replace(/\/+$/, '');
  const url = `${base}/messaging?username=${smsConfig.username}`;

  const formData = qs.stringify({
    username: smsConfig.username,
    to: cleanTo,
    message: message.substring(0, 160),
    from: sender,
  });

  const doRequest = async () => {
    logger.info('Sending SMS via Africa\'s Talking', { to: cleanTo, from: sender });
    const response = await axios.post(url, formData, {
      headers: {
        apiKey: smsConfig.apiKey,
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      timeout: 15000,
    });

    const data = response.data;
    if (data?.SMSMessageData) {
      const recipients = data.SMSMessageData.Recipients || [];
      const isDelivered = recipients.every((r) => r.statusCode === 100 || r.statusCode === 101);
      if (recipients.length === 0) {
        throw new Error(data.SMSMessageData.Message || 'Unknown error');
      }
      if (!isDelivered) {
        const errors = recipients
          .filter((r) => r.statusCode !== 100 && r.statusCode !== 101)
          .map((r) => `${r.number}: ${r.status} (code ${r.statusCode})`)
          .join(', ');
        throw new Error(`SMS delivery failed: ${errors}`);
      }
      return { success: true, data: response.data };
    }
    return { success: true, data: response.data };
  };

  try {
    return await withRetry(doRequest, smsConfig.retryConfig, `Africa's Talking SMS (${cleanTo})`);
  } catch (error) {
    const errorMessage =
      error.response?.data?.error ||
      error.response?.data?.SMSMessageData?.Message ||
      error.message;
    return { success: false, error: errorMessage };
  }
};

module.exports = { sendSMS };