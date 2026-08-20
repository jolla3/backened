/**
 * Receipt Formatter – pure functions, no DB or business logic.
 * SMS is compact (target 1 SMS unit). Printable retains full detail.
 * All date/time helpers are defensive against invalid values.
 */

const SEPARATOR = '='.repeat(40);

// ─── Currency helpers ───────────────────────────────────────

const formatCurrency = (amount) => {
  return `KES ${Number(amount).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatSmsCurrency = (amount) => {
  const rounded = Math.round(Number(amount || 0));
  return `KES ${rounded.toLocaleString('en-KE')}`;
};

// ─── Date / time helpers (defensive) ────────────────────────

const formatDate = (date) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
};

const formatCollectionDate = (dateInput) => {
  if (!dateInput) return '';
  let d;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, day] = dateInput.split('-').map(Number);
    d = new Date(Date.UTC(y, m - 1, day));
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return String(dateInput);
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(d);
};

// SMS date – day + month only
const formatSmsDate = (dateInput) => {
  if (!dateInput) return '';
  let d;
  if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
    const [y, m, day] = dateInput.split('-').map(Number);
    d = new Date(Date.UTC(y, m - 1, day));
  } else {
    d = new Date(dateInput);
  }
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    day: 'numeric',
    month: 'short',
  }).format(d);
};

/**
 * Safe SMS time formatter.
 * Accepts Date, full datetime string, or bare "HH:mm" / "HH:mm:ss".
 * Never throws. Prefer not calling this with a pure date-only string.
 */
const formatSmsTime = (timeInput) => {
  if (!timeInput) return '';

  if (timeInput instanceof Date) {
    if (isNaN(timeInput.getTime())) return '';
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(timeInput);
  }

  const value = String(timeInput).trim();

  // Bare HH:mm or HH:mm:ss
  const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match) {
    let hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) return '';
    const suffix = hour >= 12 ? 'PM' : 'AM';
    const displayHour = hour % 12 || 12;
    return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
  }

  // Full datetime string
  const d = new Date(value);
  if (isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-KE', {
    timeZone: 'Africa/Nairobi',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  }).format(d);
};

// ─── Milk receipt (compact) ─────────────────────────────────

const formatMilkReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  litres,
  payout,
  walletBalance,
  cumulativeMilk,
  collectionDate,
  collectionShift,
}) => {
  const milk = Number(litres || 0);
  const cumulative = Number(cumulativeMilk || 0);
  const coop = (cooperativeName || 'COOPERATIVE').toUpperCase().trim();
  const farmer = farmerName || `Farmer #${farmerCode || 'N/A'}`;

  // Only use what we actually have: date + shift
  const when = [formatSmsDate(collectionDate), collectionShift]
    .filter(Boolean)
    .join(' ');

  // Compact: farmer + short receipt on same line
  const farmerLine = receiptNumber
    ? `${farmer} ${receiptNumber}`
    : farmer;

  const sms = [
    coop,
    farmerLine,
    `Milk ${milk}L Earned ${formatSmsCurrency(payout)}`,
    `Month ${cumulative}L Wallet ${formatSmsCurrency(walletBalance)}`,
    when,
  ].join('\n');

  // Printable (verbose)
  const printable = [
    coop,
    'MILK DELIVERY RECEIPT',
    '',
    `Receipt: ${receiptNumber || 'N/A'}`,
    `Farmer: ${farmerName || ''}`,
    `Code: ${farmerCode || ''}`,
    SEPARATOR,
    `Milk Delivered: ${milk.toFixed(1)} L`,
    `Month Total: ${cumulative.toFixed(1)} L`,
    `Amount Earned: ${formatCurrency(payout)}`,
    `Collection: ${formatCollectionDate(collectionDate)}${collectionShift ? `, ${collectionShift}` : ''}`,
    SEPARATOR,
    `Wallet Balance: ${formatCurrency(walletBalance)}`,
    '',
    'Thank you.',
    SEPARATOR,
  ].join('\n');

  return {
    sms,
    printable,
    smsLength: sms.length,
  };
};

// ─── Feed purchase receipt (compact SMS) ────────────────────

const formatFeedReceipt = ({
  cooperativeName,
  farmerName,
  farmerCode,
  items = [],
  total,
  walletBalance,
}) => {
  const coop = (cooperativeName || 'COOPERATIVE').toUpperCase().trim();
  const farmer = farmerName || `Farmer #${farmerCode || 'N/A'}`;

  const itemLines = (items || []).map((item) => {
    const qtyLabel = item.unit
      ? `${item.quantity} ${item.unit}`
      : `${item.quantity}`;
    return `${item.productName} ${qtyLabel} @ ${formatSmsCurrency(item.unitPrice)}`;
  });

  const sms = [
    coop,
    farmer,
    ...itemLines,
    `Total ${formatSmsCurrency(total)} Wallet ${formatSmsCurrency(walletBalance)}`,
  ].join('\n');

  return {
    sms,
    smsLength: sms.length,
  };
};

// ─── Manual balance deduction (compact + unit price) ────────

// utils/receiptFormatter.js – formatDeductionReceipt (no truncation)

const formatDeductionReceipt = ({
  cooperativeName,
  farmerName,
  farmerCode,
  reason,
  amount,
  walletBalance,
  productName,
  quantity,
  unit,
  unitPrice,
  items, // optional array of product snapshots
}) => {
  const coop = (cooperativeName || 'COOPERATIVE').toUpperCase().trim();
  const farmer = farmerName || `Farmer #${farmerCode || 'N/A'}`;

  const reasonLabels = {
    feeds: 'Feed',
    debt: 'Debt',
    loan: 'Loan',
    interest: 'Interest',
    penalty: 'Penalty',
    other: 'Deduction',
  };
  const label = reasonLabels[reason] || 'Deduction';

  // Multi‑product feed deduction – include ALL items
  if (reason === 'feeds' && items && items.length > 1) {
    const lines = [];
    lines.push(coop);
    lines.push(farmer);
    for (const item of items) {
      const qtyLabel = item.unit ? `${item.quantity} ${item.unit}` : `${item.quantity}`;
      lines.push(`${item.productName} ${qtyLabel} @ ${formatSmsCurrency(item.unitPrice)}`);
    }
    lines.push(`Total ${formatSmsCurrency(amount)} Wallet ${formatSmsCurrency(walletBalance)}`);
    const sms = lines.join('\n');
    return { sms, smsLength: sms.length };
  }

  // Single‑product feed deduction
  if (reason === 'feeds' && productName) {
    const compactName = String(productName).trim().replace(/\s+/g, ' ').slice(0, 24);
    const quantityText = [quantity, unit].filter(v => v !== undefined && v !== null && v !== '').join(' ');
    const sms = [
      coop,
      farmer,
      `${compactName} ${quantityText} @ ${formatSmsCurrency(unitPrice)}`,
      `Deducted ${formatSmsCurrency(amount)}`,
      `Wallet ${formatSmsCurrency(walletBalance)}`,
    ].join('\n');
    return { sms, smsLength: sms.length };
  }

  // Non-feed deductions
  const sms = [
    coop,
    farmer,
    `${label} ${formatSmsCurrency(amount)}`,
    `Wallet ${formatSmsCurrency(walletBalance)}`,
  ].join('\n');
  return { sms, smsLength: sms.length };
};

module.exports = {
  formatCurrency,
  formatSmsCurrency,
  formatDate,
  formatCollectionDate,
  formatSmsDate,
  formatSmsTime,
  formatMilkReceipt,
  formatFeedReceipt,
  formatDeductionReceipt,
};