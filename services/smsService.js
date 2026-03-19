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

const getCooperativeConfig = async () => {
  const now = Date.now();

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

    const senderName = coop.senderName || smsConfig.defaultSender;

    cooperativeCache.data = {
      senderName
    };
    cooperativeCache.timestamp = now;

    logger.info('Cooperative config loaded', { senderName });
    return cooperativeCache.data;
  } catch (error) {
    logger.error('Failed to load cooperative config', { error: error.message });
    cooperativeCache.data = {
      senderName: smsConfig.defaultSender
    };
    cooperativeCache.timestamp = now;
    return cooperativeCache.data;
  }
};

const sendSMS = async (phoneNumber, message) => {
  try {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Invalid phone number');
    }

    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message');
    }

    // ✅ Format Kenyan phone numbers
    let formattedPhone = phoneNumber.toString().replace(/\D/g, '');
    if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) {
      formattedPhone = `+254${formattedPhone}`;
    } else if (!formattedPhone.startsWith('254')) {
      formattedPhone = `+254${formattedPhone}`;
    }

    const coopConfig = await getCooperativeConfig();
    const senderName = coopConfig.senderName || smsConfig.defaultSender;

    logger.info('SMS sending attempt', {
      recipient: formattedPhone,
      sender: senderName,
      messageLength: message.length
    });

    const result = await smsUtil.sendSMS({
      to: formattedPhone,
      message: message.substring(0, 160),  // Max SMS length
      from: senderName
    });

    logger.info('SMS result', {
      recipient: formattedPhone,
      sender: senderName,
      success: result.success
    });

    return result;
  } catch (error) {
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

const sendMonthlyMilkSummary = async (
  farmerPhone,
  farmerName,
  litresDelivered,
  totalPayout,
  totalDeductions
) => {
  try {
    if (!farmerPhone || !farmerName) {
      throw new Error('Invalid farmer details');
    }

    const netPayout = totalPayout - totalDeductions;

    const coopConfig = await getCooperativeConfig();
    const senderName = coopConfig.senderName || smsConfig.defaultSender;

    const message = `Dear ${farmerName},\nMonthly Milk Summary:\nLitres: ${litresDelivered}L\nPayout: ${totalPayout}\nDeductions: ${totalDeductions}\nNet: ${netPayout}\nThank you for using ${senderName}!`;

    const result = await sendSMS(farmerPhone, message);

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