/**
 * Receipt Formatter – pure functions, no DB or business logic.
 * SMS is compact; printable retains full detail.
 */
const SEPARATOR = '='.repeat(40);

// Full currency for printable (with decimals)
const formatCurrency = (amount) => {
  return `KES ${Number(amount).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

// Compact currency for SMS (round to nearest shilling, no decimals)
const formatSmsCurrency = (amount) => {
  const rounded = Math.round(Number(amount || 0));
  return `KES ${rounded.toLocaleString('en-KE')}`;
};

const formatDate = (date) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) throw new Error('Invalid date');
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
    d = new Date(y, m - 1, day);
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

/**
 * Milk receipt – compact SMS, verbose printable.
 */
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

  // Extract short numeric part from REC-YYYYMMDD-XXXXXX
  const receiptShort = String(receiptNumber || '')
    .replace(/^REC-\d{8}-/, '');

  const date = formatCollectionDate(collectionDate);
  const shift = collectionShift ? ` ${collectionShift}` : '';

  // ---- SMS (aggressively compact) ----
  const sms = [
    (cooperativeName || 'COOPERATIVE').toUpperCase(),
    `Milk Receipt ${receiptShort}`,
    `${farmerName || 'Farmer'} #${farmerCode || 'N/A'}`,
    `${milk}L | ${cumulative}L Mo`,
    formatSmsCurrency(payout),
    `${date}${shift}`,
    `Bal ${formatSmsCurrency(walletBalance).replace('KES ', '')}`,
  ].join('\n');

  // ---- Printable (verbose, with decimals) ----
  const printable = [
    (cooperativeName || 'COOPERATIVE').toUpperCase(),
    'MILK DELIVERY RECEIPT',
    '',
    `Receipt: ${receiptNumber}`,
    '',
    `Farmer: ${farmerName}`,
    `Code: ${farmerCode}`,
    SEPARATOR,
    `Milk Delivered: ${milk.toFixed(1)} L`,
    `Month Total: ${cumulative.toFixed(1)} L`,
    `Amount Earned: ${formatCurrency(payout)}`,
    `Collection: ${date}${shift ? `, ${shift.trim()}` : ''}`,
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

/**
 * Feed receipt – unchanged (kept for completeness)
 */
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
    `Receipt: ${receiptNumber}`,
    '',
    `Farmer: ${farmerName}`,
    `Code: ${farmerCode}`,
    '',
  ];

  const paymentLabel = paymentMethod === 'balance' ? 'Farmer Balance' : 'Cash';
  const itemLines = (items || []).map(item => {
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

module.exports = {
  formatCurrency,
  formatSmsCurrency,
  formatDate,
  formatCollectionDate,
  formatMilkReceipt,
  formatFeedReceipt,
};