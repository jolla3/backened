// services/smsService.js
const Cooperative = require('../models/cooperative');
const smsConfig = require('../config/smsConfig');
const smsUtil = require('../utils/smsUtil');
const logger = require('../utils/logger');

// Simple cache for cooperative data (30 minutes TTL)
let cooperativeCache = {
  data: null,
  timestamp: null,
  ttl: 30 * 60 * 1000
};

/**
 * Get Cooperative Configuration with Simple Caching
 * @returns {Promise<Object>} Cooperative configuration with sender name
 */
const getCooperativeConfig = async () => {
  const now = Date.now();

  // Return cached data if still valid
  if (cooperativeCache.data && (now - cooperativeCache.timestamp) < cooperativeCache.ttl) {
    return cooperativeCache.data;
  }

  try {
    const coop = await Cooperative.findOne().lean();

    if (!coop) {
      logger.warn('Cooperative not found, using default sender');
      cooperativeCache.data = {
        senderName: smsConfig.defaultSender
      };
      cooperativeCache.timestamp = now;
      return cooperativeCache.data;
    }

    // Use senderName from cooperative or fallback to default
    const senderName = coop.senderName || smsConfig.defaultSender;

    cooperativeCache.data = {
      senderName
    };
    cooperativeCache.timestamp = now;

    logger.info('Cooperative config loaded', { senderName });
    return cooperativeCache.data;
  } catch (error) {
    logger.error('Failed to load cooperative config', { error: error.message });
    // Fallback to default sender on error
    cooperativeCache.data = {
      senderName: smsConfig.defaultSender
    };
    cooperativeCache.timestamp = now;
    return cooperativeCache.data;
  }
};

/**
 * Send SMS to a Single Phone Number
 * @param {string} phoneNumber - Recipient phone number (with country code)
 * @param {string} message - SMS message content
 * @returns {Promise<Object>} Result of SMS send operation
 */
const sendSMS = async (phoneNumber, message) => {
  try {
    // Validate inputs
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Invalid phone number');
    }

    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message');
    }

    // Get cooperative config (with caching)
    const coopConfig = await getCooperativeConfig();
    const senderName = coopConfig.senderName || smsConfig.defaultSender;

    // Log SMS attempt
    logger.info('SMS sending attempt', {
      recipient: phoneNumber,
      sender: senderName,
      messageLength: message.length
    });

    // Use smsUtil for low-level API call
    const result = await smsUtil.sendSMS({
      to: phoneNumber,
      message: message,
      from: senderName
    });

    // Log success
    logger.info('SMS sent successfully', {
      recipient: phoneNumber,
      sender: senderName,
      success: result.success
    });

    return result;
  } catch (error) {
    // Log failure
    logger.error('SMS sending failed', {
      phoneNumber,
      error: error.message
    });

    return {
      success: false,
      error: error.message
    };
  }
};

/**
 * Send Monthly Milk Summary to Farmer
 * @param {string} farmerPhone - Farmer's phone number
 * @param {string} farmerName - Farmer's name
 * @param {number} litresDelivered - Total litres delivered this month
 * @param {number} totalPayout - Total expected payout
 * @param {number} totalDeductions - Total deductions from purchases
 * @returns {Promise<Object>} Result of SMS send operation
 */
const sendMonthlyMilkSummary = async (
  farmerPhone,
  farmerName,
  litresDelivered,
  totalPayout,
  totalDeductions
) => {
  try {
    // Validate inputs
    if (!farmerPhone || !farmerName) {
      throw new Error('Invalid farmer details');
    }

    // Calculate net payout
    const netPayout = totalPayout - totalDeductions;

    // Get cooperative config (with caching)
    const coopConfig = await getCooperativeConfig();
    const senderName = coopConfig.senderName || smsConfig.defaultSender;

    // Format message with cooperative branding
    const message = `Dear ${farmerName},\n\n` +
      `Monthly Milk Summary:\n` +
      `Total Litres: ${litresDelivered}L\n` +
      `Expected Payout: ${totalPayout}\n` +
      `Total Deductions: ${totalDeductions}\n` +
      `Net Payout: ${netPayout}\n\n` +
      `Thank you for using ${senderName}!`;

    // Send SMS
    const result = await sendSMS(farmerPhone, message);

    // Log summary
    logger.info('Monthly milk summary sent', {
      farmer: farmerName,
      litres: litresDelivered,
      payout: totalPayout,
      deductions: totalDeductions,
      netPayout: netPayout,
      success: result.success
    });

    return result;
  } catch (error) {
    logger.error('Failed to send monthly milk summary', { error: error.message });
    return {
      success: false,
      error: error.message
    };
  }
};

module.exports = {
  sendSMS,
  sendMonthlyMilkSummary
};