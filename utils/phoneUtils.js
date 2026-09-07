/**
 * Normalize Kenyan phone numbers to E.164 (+254...).
 * Accepts: 0712345678, 712345678, 254712345678, +254712345678, etc.
 */
const normalizePhone = (phone) => {
  if (!phone) return '';

  let cleaned = String(phone).replace(/\s+/g, '').replace(/[^\d+]/g, '');

  // Strip leading zeros after country code handling
  if (cleaned.startsWith('+')) {
    // already international-ish
  } else if (cleaned.startsWith('254')) {
    cleaned = `+${cleaned}`;
  } else if (cleaned.startsWith('0')) {
    cleaned = `+254${cleaned.slice(1)}`;
  } else if (cleaned.length === 9 && cleaned.startsWith('7')) {
    cleaned = `+254${cleaned}`;
  } else {
    cleaned = `+${cleaned}`;
  }

  return cleaned;
};

/**
 * Validate that a normalized phone is a plausible Kenyan mobile number.
 * Kenyan mobiles: +2547XXXXXXXX or +2541XXXXXXXX (9 digits after country code).
 */
const isValidKenyanPhone = (phone) => {
  if (!phone || typeof phone !== 'string') return false;
  // Must be +254 followed by 9 digits starting with 7 or 1
  return /^\+254[17]\d{8}$/.test(phone);
};

module.exports = {
  normalizePhone,
  isValidKenyanPhone,
};