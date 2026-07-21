const crypto = require('crypto');
const qrcode = require('qrcode');
const config = require('../config');
const Transaction = require('../models/transaction');
const logger = require('../utils/logger');

const generateHMAC = (data) => {
  const payload = typeof data === 'object' ? JSON.stringify(data) : data;
  return crypto
    .createHmac('sha256', config.HMAC_SECRET)
    .update(payload)
    .digest('hex');
};

const generateQRUrl = (receiptNum) => {
  const base = config.QR_BASE_URL || 'https://coop.com/verify';
  return `${base}/${receiptNum}`;
};

const generateQRForTransaction = async (transactionId, userCooperativeId) => {
  const transaction = await Transaction.findById(transactionId)
    .populate('farmer_id')
    .lean();
  if (!transaction) throw new Error('Transaction not found');

  if (transaction.cooperativeId.toString() !== userCooperativeId.toString()) {
    throw new Error('Unauthorised: transaction does not belong to your cooperative');
  }

  const payload = {
    receiptNum: transaction.receipt_num,
    farmerCode: transaction.farmer_id?.farmer_code || 'UNKNOWN',
    litres: transaction.litres,
    payout: transaction.payout,
    timestamp: transaction.timestamp_server.toISOString(),
  };

  const signature = generateHMAC(payload);
  const qrData = JSON.stringify({ ...payload, signature });

  const qrImage = await qrcode.toDataURL(qrData, {
    errorCorrectionLevel: 'H',
    width: 300,
  });

  return {
    qrImage,
    receiptNum: transaction.receipt_num,
    verificationUrl: generateQRUrl(transaction.receipt_num),
  };
};

const verifyQRPayload = async (qrPayload, userCooperativeId) => {
  // ✅ Guard: ensure qrPayload is an object
  if (!qrPayload || typeof qrPayload !== 'object') {
    throw new Error('Invalid QR payload: must be an object');
  }

  const { receiptNum, signature, ...providedData } = qrPayload;

  if (!receiptNum || !signature) {
    throw new Error('Missing receiptNum or signature in QR payload');
  }

  const transaction = await Transaction.findOne({ receipt_num: receiptNum })
    .populate('farmer_id')
    .lean();
  if (!transaction) throw new Error('Transaction not found');

  if (transaction.cooperativeId.toString() !== userCooperativeId.toString()) {
    throw new Error('Unauthorised: transaction does not belong to your cooperative');
  }

  const expectedPayload = {
    receiptNum: transaction.receipt_num,
    farmerCode: transaction.farmer_id?.farmer_code || 'UNKNOWN',
    litres: transaction.litres,
    payout: transaction.payout,
    timestamp: transaction.timestamp_server.toISOString(),
  };

  const isValid = generateHMAC(expectedPayload) === signature;
  if (!isValid) {
    logger.warn('Invalid QR signature', { receiptNum, userCooperativeId });
    throw new Error('Invalid QR signature – data may have been tampered');
  }

  // Check data consistency (prevents stale QR codes)
  if (
    providedData.farmerCode !== expectedPayload.farmerCode ||
    Number(providedData.litres) !== expectedPayload.litres ||
    Number(providedData.payout) !== expectedPayload.payout ||
    providedData.timestamp !== expectedPayload.timestamp
  ) {
    throw new Error('QR data does not match current transaction record');
  }

  // ✅ Return transaction WITHOUT payout (porter doesn't see money)
  return {
    valid: true,
    transaction: {
      receiptNum: transaction.receipt_num,
      farmer: {
        code: transaction.farmer_id?.farmer_code,
        name: transaction.farmer_id?.name,
      },
      milk: {
        litres: transaction.litres,
        // payout omitted – porter only sees litres
      },
      timestamp: transaction.timestamp_server,
      status: transaction.status,
    },
  };
};

module.exports = {
  generateHMAC,
  generateQRUrl,
  generateQRForTransaction,
  verifyQRPayload,
};