const crypto = require('crypto');
const config = require('../config');

const generateHMAC = (data) => {
  return crypto.createHmac('sha256', config.HMAC_SECRET)
    .update(JSON.stringify(data))
    .digest('hex');
};

const verifyHMAC = (data, signature) => {
  const expected = generateHMAC(data);
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
};

module.exports = { generateHMAC, verifyHMAC };