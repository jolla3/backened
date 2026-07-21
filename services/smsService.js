const smsUtil = require('../utils/smsUtil');
const logger = require('../utils/logger');

/**
 * Send generic SMS with validation and phone formatting
 */
const sendSMS = async (phoneNumber, message) => {
  try {
    if (!phoneNumber || typeof phoneNumber !== 'string') {
      throw new Error('Invalid phone number');
    }
    if (!message || typeof message !== 'string') {
      throw new Error('Invalid message');
    }

    // Format phone: remove non-digits, add 254 if missing, no '+'
    let formattedPhone = phoneNumber.toString().replace(/\D/g, '');
    if (formattedPhone.startsWith('0')) {
      formattedPhone = formattedPhone.substring(1);
    }
    if (!formattedPhone.startsWith('254')) {
      if (formattedPhone.startsWith('7') || formattedPhone.startsWith('1')) {
        formattedPhone = `254${formattedPhone}`;
      } else {
        // Already international (e.g., 254...)
      }
    }
    // ✅ DO NOT add '+' – AT expects just 254...
    // We'll let smsUtil handle the '+' removal (it also removes it)

    const senderName = process.env.SMS_SENDER || 'AgriWallet';

    logger.info('SMS sending attempt', {
      recipient: formattedPhone,
      sender: senderName,
      messageLength: message.length
    });

    const result = await smsUtil.sendSMS({
      to: formattedPhone,   // no '+'
      message: message.substring(0, 160),
      from: senderName
    });

    return result;
  } catch (error) {
    logger.error('SMS sending failed', { phoneNumber, error: error.message });
    return { success: false, error: error.message };
  }
};

/**
 * Send monthly milk summary (existing)
 */
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

/**
 * NEW: Send feed transaction notification to farmer
 * @param {Object} params
 * @param {string} params.farmerPhone - Farmer's phone number
 * @param {string} params.farmerName - Farmer's name
 * @param {string} params.productName - Name of feed product
 * @param {number} params.quantity - Quantity purchased
 * @param {number} params.pricePerUnit - Price per unit
 * @param {number} params.totalCost - Total cost
 * @param {string} params.cooperativeName - Name of cooperative
 * @param {number} params.newBalance - New balance after deduction
 */
const sendFeedTransactionNotification = async ({
  farmerPhone,
  farmerName,
  productName,
  quantity,
  pricePerUnit,
  totalCost,
  cooperativeName,
  newBalance
}) => {
  try {
    if (!farmerPhone || !farmerName) {
      throw new Error('Invalid farmer details');
    }

    const message = `Dear ${farmerName}, You bought ${quantity} units of ${productName} @ ${pricePerUnit}/unit. Total: ${totalCost}. Balance: ${newBalance}. ${cooperativeName || 'Cooperative'}`;

    return await sendSMS(farmerPhone, message);
  } catch (error) {
    logger.error('Feed transaction SMS failed', { error: error.message, farmerPhone });
    return { success: false, error: error.message };
  }
};

module.exports = {
  sendSMS,
  sendMonthlyMilkSummary,
  sendFeedTransactionNotification,
};