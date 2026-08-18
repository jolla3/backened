const { SMS_LENGTH } = require('../constants/smsConstants');

/**
 * Rough GSM-7 check (ASCII subset).
 * Extended GSM-7 chars (^{}\\[~]|€) are not fully modeled —
 * keep production messages well under 160 chars.
 */
const isGSM7Compatible = (message) => {
  if (!message) return true;
  return /^[\x00-\x7F]*$/.test(message);
};

/**
 * Segment count
 * 1 segment: ≤160 GSM-7 or ≤70 UCS-2
 * 2+: ceil(len / 153) GSM-7 or ceil(len / 67) UCS-2
 */
const calculateSegments = (message) => {
  if (!message || message.length === 0) return 0;

  const isGSM7 = isGSM7Compatible(message);
  const length = message.length;

  if (isGSM7) {
    if (length <= SMS_LENGTH.GSM7_SINGLE) return 1;
    return Math.ceil(length / SMS_LENGTH.GSM7_CONCAT);
  }

  if (length <= SMS_LENGTH.UNICODE_SINGLE) return 1;
  return Math.ceil(length / SMS_LENGTH.UNICODE_CONCAT);
};

const getSmsLengthInfo = (message) => {
  const length = message ? message.length : 0;
  const isGSM7 = isGSM7Compatible(message);
  const segments = calculateSegments(message);

  const charCountPerSms = isGSM7
    ? segments === 1
      ? SMS_LENGTH.GSM7_SINGLE
      : SMS_LENGTH.GSM7_CONCAT
    : segments === 1
      ? SMS_LENGTH.UNICODE_SINGLE
      : SMS_LENGTH.UNICODE_CONCAT;

  return {
    length,
    segments,
    encoding: isGSM7 ? 'GSM-7' : 'Unicode/UCS2',
    fitsInSingle: segments === 1,
    charCountPerSms,
    estimatedCost: segments,
  };
};

const fitsInSingleSms = (message) => calculateSegments(message) === 1;

const truncateToSegments = (message, maxSegments = 1) => {
  if (!message) return message;

  const isGSM7 = isGSM7Compatible(message);
  let maxLength;

  if (maxSegments <= 1) {
    maxLength = isGSM7 ? SMS_LENGTH.GSM7_SINGLE : SMS_LENGTH.UNICODE_SINGLE;
  } else {
    const per = isGSM7 ? SMS_LENGTH.GSM7_CONCAT : SMS_LENGTH.UNICODE_CONCAT;
    maxLength = maxSegments * per;
  }

  if (message.length <= maxLength) return message;
  return message.substring(0, Math.max(0, maxLength - 3)) + '...';
};

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