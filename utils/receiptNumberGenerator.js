const crypto = require('crypto');
const Transaction = require('../models/transaction');
const { getCooperativePrefix } = require('../utils/receiptFormatter'); // or wherever it lives

// Restricted alphabet – no I, O, 0, 1
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 7;
const MAX_RETRIES = 8;

/**
 * Cryptographically secure, unbiased random code.
 */
function generateRandomCode(length = CODE_LENGTH) {
  let code = '';
  for (let i = 0; i < length; i++) {
    code += ALPHABET[crypto.randomInt(0, ALPHABET.length)];
  }
  return code;
}

/**
 * Generate a unique receipt number.
 * Format: XXX-XXXXXXX  (exactly 11 characters)
 * Example: ITH-X7K9Q2M
 *
 * @param {string} cooperativeName - Full cooperative name (preferred)
 * @returns {Promise<string>}
 */
const generateReceiptNum = async (cooperativeName, maxRetries = MAX_RETRIES) => {
  if (!cooperativeName || typeof cooperativeName !== 'string') {
    throw new Error('cooperativeName is required to generate a receipt number');
  }

  // Reject ObjectId – caller must pass the actual name
  if (cooperativeName.length === 24 && /^[a-f0-9]{24}$/i.test(cooperativeName)) {
    throw new Error(
      'generateReceiptNum expects the cooperative name, not the cooperative ID'
    );
  }

  const prefix = getCooperativePrefix(cooperativeName);

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const code = generateRandomCode(CODE_LENGTH);
    const candidate = `${prefix}-${code}`;

    // Fast path – reduces insert attempts
    const exists = await Transaction.exists({ receipt_num: candidate });
    if (!exists) {
      return candidate;
    }
  }

  throw new Error(
    `Unable to generate unique receipt number after ${maxRetries} attempts`
  );
};

module.exports = {
  generateReceiptNum,
  generateRandomCode, // useful for tests
  ALPHABET,
  CODE_LENGTH,
};