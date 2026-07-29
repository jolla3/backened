// sms/providers/androidGatewayProvider.js
const axios = require('axios');
const smsConfig = require('../../config/smsConfig');
const logger = require('../../utils/logger');
const { withRetry } = require('../../utils/retry');
const { normalizePhone } = require('../../utils/phoneUtils');

const sendSMS = async ({ to, message, from }) => {
  const gatewayUrl = smsConfig.gatewayUrl?.replace(/\/+$/, '');
  if (!gatewayUrl) {
    return { success: false, error: 'Android Gateway URL not configured' };
  }

  const token = smsConfig.gatewayToken;
  const normalizedTo = normalizePhone(to);

  const payload = { to: normalizedTo, message };
  if (from) payload.from = from;

  const headers = { 'Content-Type': 'application/json' };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const doRequest = async () => {
    logger.info('Sending SMS via Android Gateway', { to: normalizedTo, gatewayUrl });
    const response = await axios.post(`${gatewayUrl}/send`, payload, { headers, timeout: 15000 });
    const data = response.data;
    if (data && data.success !== false) {
      return { success: true, data };
    }
    throw new Error(data?.error || data?.message || 'Gateway returned failure');
  };

  try {
    return await withRetry(doRequest, smsConfig.retryConfig, `Android Gateway SMS (${normalizedTo})`);
  } catch (error) {
    const errorMsg = error.response?.data?.error || error.response?.data?.message || error.message;
    return { success: false, error: errorMsg };
  }
};

module.exports = { sendSMS };