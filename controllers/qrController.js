// qrController
const qrService = require('../services/qrService');
const qrcode = require('qrcode');

const generateQR = async (req, res) => {
  try {
    const { data } = req.body;
    const hash = qrService.generateHMAC(data);
    const qrData = JSON.stringify({ ...data, hash });
    const qrImage = await qrcode.toDataURL(qrData);
    res.json({ qrImage, hash });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const verifyQR = async (req, res) => {
  try {
    const { data, signature } = req.body;
    const isValid = qrService.verifyHMAC(data, signature);
    res.json({ valid: isValid });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { generateQR, verifyQR };