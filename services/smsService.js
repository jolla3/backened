const smsConfig = require('../config/smsConfig');
const smsUtil = require('../utils/smsUtil');
const logger = require('../utils/logger');

const sendSMS = async (phoneNumber, message) => {
  try {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Invalid phone number');
    }

    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message');
    }

    // ✅ FIXED: NO DB CALL - Use config directly
    const senderName = smsConfig.defaultSender || 'AgriWallet';

    // Format phone
    let formattedPhone = phoneNumber.toString().replace(/\D/g, '');
    if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) {
      formattedPhone = `254${formattedPhone}`;
    }

    logger.info('SMS sending attempt', {
      recipient: `+${formattedPhone}`,
      sender: senderName,
      messageLength: message.length
    });

    const result = await smsUtil.sendSMS({
      to: `+${formattedPhone}`,
      message: message.substring(0, 160),
      from: senderName
    });

    logger.info('SMS result', { success: result.success });
    return result;
  } catch (error) {
    logger.error('SMS sending failed', { phoneNumber, error: error.message });
    return { success: false, error: error.message };
  }
};

const sendMonthlyMilkSummary = async (farmerPhone, farmerName, litresDelivered, totalPayout, totalDeductions) => {
  try {
    if (!farmerPhone || !farmerName) {
      throw new Error('Invalid farmer details');
    }

    const netPayout = totalPayout - totalDeductions;
    const message = `Dear ${farmerName}, Monthly: ${litresDelivered}L, Payout:${totalPayout}, Deduct:${totalDeductions}, Net:${netPayout}`;

    return await sendSMS(farmerPhone, message);
  } catch (error) {
    logger.error('Monthly summary failed', { error: error.message });
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendSMS,
  sendMonthlyMilkSummary
};