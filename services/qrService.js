const crypto = require('crypto');
const config = require('../config');
const Transaction = require('../models/transaction');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

// Generate HMAC signature
const generateHMAC = (data) => {
  return crypto.createHmac('sha256', config.HMAC_SECRET)
    .update(JSON.stringify(data))
    .digest('hex');
};

// Verify HMAC signature (timing-safe to prevent timing attacks)
const verifyHMAC = (data, signature) => {
  const expected = generateHMAC(data);
  const input1 = Buffer.from(expected, 'hex');
  const input2 = Buffer.from(signature, 'hex');
  
  try {
    return crypto.timingSafeEqual(input1, input2);
  } catch (error) {
    return false;
  }
};

// Generate QR verification URL
const generateQRUrl = (receiptNum) => {
  return `coop.com/verify/${receiptNum}`;
};

// Verify QR transaction with Cooperative Scoping
const verifyQRTransaction = async (receiptNum, adminId) => {
  const transaction = await Transaction.findOne({ receipt_num: receiptNum });
  
  if (!transaction) {
    return { valid: false, error: 'Transaction not found' };
  }

  // Verify transaction belongs to admin's cooperative
  const cooperative = await Cooperative.findById(adminId);
  if (!cooperative || transaction.cooperativeId.toString() !== cooperative._id.toString()) {
    return { valid: false, error: 'Unauthorized: Transaction does not belong to your cooperative' };
  }

  // Verify signature
  const signatureData = {
    receiptNum: transaction.receipt_num,
    farmerCode: transaction.farmer_id.farmer_code,
    litres: transaction.litres,
    payout: transaction.payout,
    timestamp: transaction.timestamp_server
  };
  
  const expectedSignature = generateHMAC(signatureData);
  const isValid = verifyHMAC(signatureData, transaction.qr_hash);
  
  logger.info('QR verification', { receiptNum, isValid, cooperativeId: cooperative._id });
  
  return {
    valid: isValid,
    transaction: {
      receiptNum: transaction.receipt_num,
      farmer: {
        code: transaction.farmer_id.farmer_code,
        name: transaction.farmer_id.name
      },
      milk: {
        litres: transaction.litres,
        payout: transaction.payout
      },
      timestamp: transaction.timestamp_server,
      status: transaction.status
    }
  };
};

module.exports = {
  generateHMAC,
  verifyHMAC,
  generateQRUrl,
  verifyQRTransaction
};