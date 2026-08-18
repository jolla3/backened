/**
 * Celcom SMS Provider - Official Celcom Africa API
 *
 * POST https://isms.celcomafrica.com/api/services/sendsms/
 * Body: { partnerID, apikey, mobile, message, shortcode, pass_type }
 *
 * Response: { responses: [{ "respose-code", "response-description", messageid, ... }] }
 * NOTE: Celcom uses the typo "respose-code".
 */
const axios = require('axios');
const logger = require('../utils/logger');

class CelcomSmsProvider {
  constructor(config = {}) {
    this.smsUrl = config.smsUrl || process.env.CELCOM_SMS_URL || 'https://isms.celcomafrica.com/api/services/sendsms/';
    this.dlrUrl = config.dlrUrl || process.env.CELCOM_DLR_URL || 'https://isms.celcomafrica.com/api/services/getdlr/';
    this.balanceUrl = config.balanceUrl || process.env.CELCOM_BALANCE_URL || 'https://isms.celcomafrica.com/api/services/getbalance/';
    this.partnerId = config.partnerId || process.env.CELCOM_PARTNER_ID;
    this.apiKey = config.apiKey || process.env.CELCOM_API_KEY;
    this.senderId = config.senderId || process.env.CELCOM_SENDER_ID || 'JOMUGITAGRI';
    this.timeout = config.timeout || parseInt(process.env.SMS_REQUEST_TIMEOUT_MS || process.env.CELCOM_TIMEOUT_MS || '15000', 10);

    if (!this.partnerId) throw new Error('CELCOM_PARTNER_ID is required');
    if (!this.apiKey) throw new Error('CELCOM_API_KEY is required');
    if (!this.senderId) throw new Error('CELCOM_SENDER_ID is required');

    logger.info('CelcomSmsProvider initialized', {
      smsUrl: this.smsUrl,
      senderId: this.senderId,
      partnerId: this.partnerId,
      hasApiKey: !!this.apiKey,
      timeout: this.timeout,
    });
  }

  _buildRequestBody(mobile, message) {
    return {
      partnerID: this.partnerId,
      apikey: this.apiKey,
      mobile,
      message,
      shortcode: this.senderId,
      pass_type: 'plain',
    };
  }

  /**
   * @param {string} mobile - E.164 (+254...)
   * @param {string} message
   * @param {string|null} clientReference - local idempotency key (not sent to Celcom)
   */
  async send(mobile, message, clientReference = null) {
    if (!mobile || !message) {
      return this._errorResponse('Missing required fields: mobile, message', 'invalid_request', false);
    }

    try {
      logger.debug('Celcom send request', {
        mobile: this._maskPhone(mobile),
        messageLength: message.length,
        clientReference,
      });

      const body = this._buildRequestBody(mobile, message);

      const response = await axios.post(this.smsUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeout,
      });

      return this._handleSuccessResponse(response);
    } catch (error) {
      return this._handleErrorResponse(error);
    }
  }

  async checkStatus(messageId) {
    if (!messageId) throw new Error('messageId is required');

    try {
      const body = {
        partnerID: this.partnerId,
        apikey: this.apiKey,
        messageID: messageId,
      };
      const response = await axios.post(this.dlrUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeout,
      });
      return {
        status: 'ok',
        deliveryStatus: response.data.status || response.data['response-description'] || 'unknown',
        raw: response.data,
      };
    } catch (error) {
      logger.error('Celcom DLR check failed', { messageId, error: error.message });
      return { status: 'error', error: error.message, raw: error.response?.data || null };
    }
  }

  async checkBalance() {
    try {
      const body = {
        partnerID: this.partnerId,
        apikey: this.apiKey,
      };
      const response = await axios.post(this.balanceUrl, body, {
        headers: { 'Content-Type': 'application/json' },
        timeout: this.timeout,
      });
      return {
        balance: response.data.balance ?? response.data.credit ?? null,
        currency: response.data.currency || 'KES',
        raw: response.data,
      };
    } catch (error) {
      logger.error('Celcom balance check failed', { error: error.message });
      throw error;
    }
  }

// providers/CelcomSmsProvider.js  – key changes only

_handleSuccessResponse(response) {
  const data = response.data;

  if (!data.responses || !Array.isArray(data.responses) || data.responses.length === 0) {
    return this._errorResponse('Invalid Celcom response structure', 'invalid_response', false);
  }

  const first = data.responses[0];
  // Normalize Celcom typo once; never store "resposeCode" internally
  const responseCode = first['respose-code'] ?? first['response-code'];
  const responseDescription = first['response-description'];
  const messageid = first.messageid;

  if (responseCode === 200 || responseCode === '200') {
    if (!messageid) {
      // Success without message ID is unusable for DLR and dangerous for retries
      logger.warn('Celcom success without messageid', { data });
      return this._errorResponse(
        'Provider accepted but returned no message ID',
        'missing_message_id',
        false // do not auto-retry
      );
    }

    return {
      success: true,
      providerMessageId: String(messageid),
      status: 'accepted',
      responseCode: Number(responseCode) || responseCode,
      raw: data,
    };
  }

  const classification = this._classifyErrorCode(responseCode, responseDescription);
  return this._errorResponse(
    classification.message,
    classification.code,
    classification.retryable
  );
}

// CelcomSmsProvider._handleErrorResponse

_handleErrorResponse(error) {
  if (!error.response) {
    // Any uncertainty after the request may have left our process
    const uncertainCodes = [
      'ECONNABORTED', 'ETIMEDOUT', 'ECONNRESET',
      'EPIPE', 'EAI_AGAIN', 'ENOTFOUND',
    ];
    if (uncertainCodes.includes(error.code)) {
      return {
        success: false,
        status: 'unknown',
        errorMessage: `${error.code || 'network'} – outcome unknown, may have been accepted`,
        errorCode: error.code || 'network_uncertain',
        retryable: false,
        raw: null,
      };
    }
    return this._errorResponse(
      error.message || 'Network error',
      error.code || 'network_error',
      false // default: do not auto-retry
    );
  }

  const statusCode = error.response.status;
  const data = error.response.data;

  // 5xx after POST: Celcom may have processed the SMS
  if (statusCode >= 500) {
    return {
      success: false,
      status: 'unknown',
      errorMessage: data?.message || `HTTP ${statusCode}`,
      errorCode: `http_${statusCode}`,
      retryable: false,
      raw: data,
    };
  }

  // 4xx = definite rejection
  return this._errorResponse(
    data?.message || `HTTP ${statusCode}`,
    `http_${statusCode}`,
    false
  );
}

  _classifyErrorCode(code, message) {
    const codeStr = String(code);
    const classifications = {
      '1001': { message: 'Invalid sender ID', code: 'invalid_sender', retryable: false },
      '1002': { message: 'Network not allowed', code: 'network_restricted', retryable: false },
      '1003': { message: 'Invalid mobile number', code: 'invalid_phone', retryable: false },
      '1004': { message: 'Low bulk credits', code: 'insufficient_credits', retryable: false },
      '1005': { message: 'System error', code: 'system_error', retryable: true },
      '1006': { message: 'Invalid credentials', code: 'auth_failed', retryable: false },
      '1007': { message: 'System error', code: 'system_error', retryable: true },
      '1008': { message: 'No delivery report', code: 'no_dlr', retryable: false },
      '1009': { message: 'Unsupported data type', code: 'unsupported_type', retryable: false },
      '1010': { message: 'Unsupported request type', code: 'unsupported_request', retryable: false },
      '4090': { message: 'Internal error, try again in 5 minutes', code: 'internal_error', retryable: true },
      '4091': { message: 'No Partner ID set', code: 'missing_partner_id', retryable: false },
      '4092': { message: 'No API KEY provided', code: 'missing_api_key', retryable: false },
      '4093': { message: 'Details not found', code: 'not_found', retryable: false },
    };
    if (classifications[codeStr]) return classifications[codeStr];
    return {
      message: message || `Unknown error code: ${code}`,
      code: 'unknown_error',
      retryable: false,
    };
  }

  _errorResponse(message, errorCode, retryable) {
    return {
      success: false,
      status: 'failed',
      errorMessage: message,
      errorCode,
      retryable: !!retryable,
      raw: null,
    };
  }

  _maskPhone(phone) {
    if (!phone || phone.length < 6) return phone;
    return `${phone.substring(0, 7)}****${phone.substring(phone.length - 2)}`;
  }

  async healthCheck() {
    try {
      const balance = await this.checkBalance();
      return {
        status: 'healthy',
        message: 'Celcom provider is operational',
        balance: balance.balance,
      };
    } catch (error) {
      return { status: 'unhealthy', error: error.message };
    }
  }

  getProviderName() {
    return 'celcom';
  }
}

module.exports = CelcomSmsProvider;