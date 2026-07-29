// utils/phoneUtils.js
const normalizePhone = (phone) => {
  if (!phone) return '';
  let cleaned = String(phone).replace(/\s+/g, '').replace(/^0+/, '');
  if (!cleaned.startsWith('+')) {
    if (cleaned.startsWith('254')) {
      cleaned = `+${cleaned}`;
    } else if (cleaned.length === 9 && cleaned.startsWith('7')) {
      cleaned = `+254${cleaned}`;
    } else if (cleaned.length === 10 && cleaned.startsWith('71')) {
      cleaned = `+254${cleaned.slice(1)}`;
    } else {
      cleaned = `+${cleaned}`;
    }
  }
  return cleaned;
};

module.exports = { normalizePhone };