const { sendSMS } = require('../config/sms');

const sendSMSMessage = async (phone, message) => {
  return await sendSMS(phone, message);
};

module.exports = { sendSMSMessage };