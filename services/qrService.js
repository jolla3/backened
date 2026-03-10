const crypto = require('crypto');
const config = require('../config');

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

// Verify QR transaction
const verifyQRTransaction = async (receiptNum) => {
  const Transaction = require('../models/transaction');
  
  const transaction = await Transaction.findOne({ receipt_num: receiptNum })
    .populate('farmer_id', 'name farmer_code')
    .populate('porter_id', 'name')
    .populate('rate_version_id', 'rate');
  
  if (!transaction) {
    return { valid: false, error: 'Transaction not found' };
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
        rate: transaction.rate_version_id.rate,
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