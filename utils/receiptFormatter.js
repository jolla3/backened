/**
 * Receipt Formatter (dumb – no DB, no business logic)
 */
const SEPARATOR = '='.repeat(40);

const formatCurrency = (amount) => {
  return `KES ${Number(amount).toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
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
  // Accept YYYY-MM-DD or Date
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

const buildHeader = ({ cooperativeName, receiptNumber, farmerName, farmerCode, title }) => {
  return [
    (cooperativeName || 'COOPERATIVE').toUpperCase(),
    title,
    '',
    `Receipt: ${receiptNumber}`,
    '',
    `Farmer: ${farmerName}`,
    `Code: ${farmerCode}`,
    '',
  ];
};

/**
 * Milk receipt – includes cumulative milk when provided
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
  transactionDate,
}) => {
  const header = buildHeader({
    cooperativeName,
    receiptNumber,
    farmerName,
    farmerCode,
    title: 'MILK DELIVERY RECEIPT',
  });

  const body = [
    `Milk Delivered: ${Number(litres).toFixed(1)} L`,
  ];

  if (cumulativeMilk !== undefined && cumulativeMilk !== null) {
    body.push(`Cumulative Milk: ${Number(cumulativeMilk).toFixed(1)} L`);
  }

  body.push(`Amount Earned: ${formatCurrency(payout)}`);
  body.push('');
  body.push(`Collection Date: ${formatCollectionDate(collectionDate)}`);

  const footer = [
    '',
    `Wallet Balance: ${formatCurrency(walletBalance)}`,
    '',
    'Thank you.',
  ];

  const sms = [...header, ...body, ...footer].join('\n');
  const printable = [
    ...header,
    SEPARATOR,
    ...body,
    SEPARATOR,
    ...footer,
    SEPARATOR,
  ].join('\n');

  return { sms, printable };
};

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
  const header = buildHeader({
    cooperativeName,
    receiptNumber,
    farmerName,
    farmerCode,
    title: 'FEED PURCHASE RECEIPT',
  });
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
  formatDate,
  formatCollectionDate,
  formatMilkReceipt,
  formatFeedReceipt,
};