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

// SMS date – day + month only (no year)
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
 * Accepts:
 *   - Date object
 *   - full datetime string
 *   - bare "HH:mm" or "HH:mm:ss"
 * Never throws.
 */
const formatSmsTime = (timeInput) => {
  if (!timeInput) return '';

  // Already a Date
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

// ─── Milk receipt ───────────────────────────────────────────

const formatMilkReceipt = ({
  cooperativeName,
  farmerName,
  farmerCode,
  litres,
  payout,
  walletBalance,
  cumulativeMilk,
  collectionDate,
  collectionShift,
  // collectionTime is intentionally ignored if present –
  // we derive time from collectionDate when available
}) => {
  const milk = Number(litres || 0);
  const cumulative = Number(cumulativeMilk || 0);
  const coop = (cooperativeName || 'COOPERATIVE').toUpperCase().trim();
  const farmer = farmerName || `Farmer #${farmerCode || 'N/A'}`;

  const date = formatSmsDate(collectionDate);
  // Prefer explicit shift if the business cares about AM/PM shifts.
  // Otherwise fall back to actual time of day.
  const when = [date, collectionShift || formatSmsTime(collectionDate)]
    .filter(Boolean)
    .join(' ');

  const sms = [
    coop,
    farmer,
    `Milk ${milk}L`,
    `Earned ${formatSmsCurrency(payout)}`,
    `Month ${cumulative}L`,
    `Wallet ${formatSmsCurrency(walletBalance)}`,
    when,
  ].join('\n');

  // Printable (verbose) – kept for completeness
  const printable = [
    coop,
    'MILK DELIVERY RECEIPT',
    '',
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

// ─── Feed purchase receipt (existing, kept) ─────────────────

const formatFeedReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  paymentMethod,
  items,
  total,
  walletBalance,
  transactionDate,
}) => {
  const header = [
    (cooperativeName || 'COOPERATIVE').toUpperCase(),
    'FEED PURCHASE RECEIPT',
    '',
    `Receipt: ${receiptNumber || ''}`,
    '',
    `Farmer: ${farmerName || ''}`,
    `Code: ${farmerCode || ''}`,
    '',
  ];

  const paymentLabel = paymentMethod === 'balance' ? 'Farmer Balance' : 'Cash';
  const itemLines = (items || []).map((item) => {
    const qtyLabel = item.unit
      ? `${item.quantity} ${item.unit} ${item.productName}`
      : `${item.quantity} x ${item.productName}`;
    const categoryPart = item.category ? ` (${item.category})` : '';
    return `${qtyLabel}${categoryPart} @ ${formatCurrency(item.unitPrice)} = ${formatCurrency(item.lineTotal)}`;
  });

  const smsBody = [
    `Payment: ${paymentLabel}`,
    '',
    itemLines.join('\n'),
    '',
    `TOTAL: ${formatCurrency(total)}`,
  ];

  const footer = [
    '',
    `Wallet Balance: ${formatCurrency(walletBalance)}`,
    '',
    `Transaction Date: ${formatDate(transactionDate || new Date())}`,
    '',
    'Thank you.',
  ];

  const sms = [...header, ...smsBody, ...footer].join('\n');
  const printable = [
    ...header,
    SEPARATOR,
    ...smsBody,
    SEPARATOR,
    ...footer,
    SEPARATOR,
  ].join('\n');

  return { sms, printable };
};

// ─── Manual balance deduction (compact) ─────────────────────

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

  let deductionLine;
  if (reason === 'feeds' && productName) {
    const quantityText = [quantity, unit]
      .filter((v) => v !== undefined && v !== null && v !== '')
      .join(' ');
    deductionLine = `${productName} ${quantityText}`.trim();
  } else {
    deductionLine = `${label} ${formatSmsCurrency(amount)}`;
  }

  const sms = [
    coop,
    farmer,
    deductionLine,
    `Deducted ${formatSmsCurrency(amount)}`,
    `Wallet ${formatSmsCurrency(walletBalance)}`,
  ].join('\n');

  return {
    sms,
    smsLength: sms.length,
  };
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