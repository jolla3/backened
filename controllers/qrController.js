const Joi = require('joi');
const qrService = require('../services/qrService');
const logger = require('../utils/logger');

const generateSchema = Joi.object({
  transactionId: Joi.string().hex().length(24).required(),
});

const verifySchema = Joi.object({
  receiptNum: Joi.string().required(),
  signature: Joi.string().hex().length(64).required(),
}).unknown(true);

const generateQR = async (req, res) => {
  try {
    const { error, value } = generateSchema.validate(req.body);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const { transactionId } = value;
    const userCooperativeId = req.user.cooperativeId;
    if (!userCooperativeId) {
      return res.status(403).json({ error: 'User has no cooperative assigned' });
    }

    const result = await qrService.generateQRForTransaction(transactionId, userCooperativeId);
    logger.info('QR generated', { receiptNum: result.receiptNum, userId: req.user.id });
    res.status(200).json(result);
  } catch (err) {
    logger.error('QR generation failed', { error: err.message, userId: req.user?.id });
    const status = err.message.includes('Unauthorised') ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
};

const verifyQR = async (req, res) => {
  try {
    // ✅ Support both JSON body and query parameters
    const payload = req.body && Object.keys(req.body).length > 0 ? req.body : req.query;

    if (!payload || Object.keys(payload).length === 0) {
      return res.status(400).json({ error: 'Missing QR payload. Send JSON body or query parameters.' });
    }

    const { error, value } = verifySchema.validate(payload);
    if (error) return res.status(400).json({ error: error.details[0].message });

    const qrPayload = value;
    const userCooperativeId = req.user.cooperativeId;
    if (!userCooperativeId) {
      return res.status(403).json({ error: 'User has no cooperative assigned' });
    }

    const result = await qrService.verifyQRPayload(qrPayload, userCooperativeId);
    logger.info('QR verified', { receiptNum: qrPayload.receiptNum, userId: req.user.id });
    res.status(200).json(result);
  } catch (err) {
    logger.error('QR verification failed', { error: err.message, userId: req.user?.id });
    const status = err.message.includes('Unauthorised') ? 403 : 400;
    res.status(status).json({ error: err.message });
  }
};

module.exports = { generateQR, verifyQR };