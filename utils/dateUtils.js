// utils/dateUtils.js
function getKenyaDateString(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Africa/Nairobi',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function isValidDateString(str) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(str)) return false;
  const [year, month, day] = str.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function parseKenyaDate(dateStr) {
  if (!isValidDateString(dateStr)) {
    throw new Error(`Invalid date string: ${dateStr}. Expected YYYY-MM-DD`);
  }
  return new Date(`${dateStr}T00:00:00+03:00`);
}

module.exports = {
  getKenyaDateString,
  isValidDateString,
  parseKenyaDate,
};