// analytics/utils/formatters.js
/**
 * Safely format a number as currency (KES).
 * Returns '—' if value is null/undefined.
 */
const formatMoney = (value) => {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  return num.toLocaleString('en-KE', { style: 'currency', currency: 'KES', minimumFractionDigits: 0 });
};

/**
 * Safely format a number with commas.
 * Returns '—' if value is null/undefined.
 */
const formatNumber = (value) => {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  return num.toLocaleString();
};

/**
 * Safely format a percentage.
 * Returns '—' if value is null/undefined.
 */
const formatPercent = (value) => {
  if (value === null || value === undefined) return '—';
  const num = Number(value);
  if (isNaN(num)) return '—';
  return num.toFixed(1) + '%';
};

/**
 * Safely get a number, defaulting to 0.
 */
const safeNumber = (value) => {
  if (value === null || value === undefined) return 0;
  const num = Number(value);
  return isNaN(num) ? 0 : num;
};

module.exports = { formatMoney, formatNumber, formatPercent, safeNumber };