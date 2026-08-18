// utils/smsLengthUtils.js
const { SMS_LENGTH, GSM7_CHARSET } = require('../constants/smsConstants');

/**
 * Detect if a message contains only GSM-7 characters.
 * GSM-7 uses 7 bits per character, allowing more chars per SMS.
 */
const isGSM7Compatible = (message) => {
  if (!message) return true;
  // Basic check: if all chars are ASCII 0-127 (excluding special cases), it's GSM7
  return /^[\x00-\x7F]*$/.test(message);
};

/**
 * Calculate the number of SMS segments needed.
 * A single SMS can hold 160 GSM-7 chars or 70 Unicode chars.
 * Concatenated SMS can hold 306 GSM-7 chars or 134 Unicode chars per segment.
 */
const calculateSegments = (message) => {
  if (!message || message.length === 0) return 0;

  const isGSM7 = isGSM7Compatible(message);
  const messageLength = message.length;

  if (isGSM7) {
    if (messageLength <= SMS_LENGTH.GSM7_SINGLE) {
      return 1;
    }
    // Calculate how many 306-char segments needed
    return Math.ceil(messageLength / SMS_LENGTH.GSM7_CONCAT);
  } else {
    // Unicode/UCS2
    if (messageLength <= SMS_LENGTH.UNICODE_SINGLE) {
      return 1;
    }
    return Math.ceil(messageLength / SMS_LENGTH.UNICODE_CONCAT);
  }
};

/**
 * Get SMS length info.
 * Returns: { length, segments, encoding, fitsInSingle, charCountPerSms }
 */
const getSmsLengthInfo = (message) => {
  const length = message ? message.length : 0;
  const isGSM7 = isGSM7Compatible(message);
  const segments = calculateSegments(message);

  let charCountPerSms;
  if (isGSM7) {
    charCountPerSms = segments === 1 ? SMS_LENGTH.GSM7_SINGLE : SMS_LENGTH.GSM7_CONCAT;
  } else {
    charCountPerSms = segments === 1 ? SMS_LENGTH.UNICODE_SINGLE : SMS_LENGTH.UNICODE_CONCAT;
  }

  return {
    length,
    segments,
    encoding: isGSM7 ? 'GSM-7' : 'Unicode/UCS2',
    fitsInSingle: segments === 1,
    charCountPerSms,
    estimatedCost: segments, // Often billed per segment
  };
};

/**
 * Check if message will fit in a single SMS without concatenation.
 */
const fitsInSingleSms = (message) => {
  return calculateSegments(message) === 1;
};

/**
 * Truncate message to fit in N segments.
 * Useful for ensuring messages don't exceed a certain cost.
 */
const truncateToSegments = (message, maxSegments = 1) => {
  if (!message) return message;

  const isGSM7 = isGSM7Compatible(message);
  const maxCharsPerSegment = isGSM7 ? SMS_LENGTH.GSM7_CONCAT : SMS_LENGTH.UNICODE_CONCAT;
  const maxLength = maxSegments * maxCharsPerSegment;

  if (message.length <= maxLength) {
    return message;
  }

  // Truncate and add ellipsis indicator
  return message.substring(0, maxLength - 3) + '...';
};

/**
 * Estimate Celcom SMS cost (1 segment = ~0.1 KES, adjust as needed).
 * Provides transparency to system operators.
 */
const estimateCost = (message, costPerSegment = 0.1) => {
  const segments = calculateSegments(message);
  return (segments * costPerSegment).toFixed(2);
};

module.exports = {
  isGSM7Compatible,
  calculateSegments,
  getSmsLengthInfo,
  fitsInSingleSms,
  truncateToSegments,
  estimateCost,
};