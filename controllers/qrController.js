const qrService = require('../services/qrService');
const qrcode = require('qrcode');
const logger = require('../utils/logger');

const generateQR = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { data } = req.body;
    const hash = qrService.generateHMAC(data);
    const qrData = JSON.stringify({ ...data, hash });
    const qrImage = await qrcode.toDataURL(qrData);
    res.json({ qrImage, hash });
  } catch (error) {
    logger.error('QR generation failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

const verifyQR = async (req, res) => {
  try {
    const { data, signature } = req.body;
    const isValid = qrService.verifyHMAC(data, signature);
    res.json({ valid: isValid });
  } catch (error) {
    logger.error('QR verification failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { generateQR, verifyQR };