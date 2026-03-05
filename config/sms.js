// Placeholder for Twilio/AfricasTalking client
// In production, initialize the actual client here
const sendSMS = async (phone, message) => {
  // Logic to call SMS provider
  console.log(`[SMS] Sending to ${phone}: ${message}`);
  return { success: true };
};

module.exports = { sendSMS };