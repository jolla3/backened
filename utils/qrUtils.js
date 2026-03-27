// Utils/qrUtils.js
const qrcode = require('qrcode');

const generateQRCode = async (data) => {
  return await qrcode.toDataURL(data);
};

module.exports = { generateQRCode };