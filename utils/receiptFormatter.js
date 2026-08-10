// utils/receiptFormatter.js
// Pure dumb formatter – no validation, no business logic, no state.

const SEPARATOR = '='.repeat(40);

const formatCurrency = (amount) => {
  return `KES ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (date) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid date');
  }
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

const formatMilkReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  litres,
  payout,
  walletBalance,
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
    `Amount Earned: ${formatCurrency(payout)}`,
    '',
    `Collection Date: ${collectionDate}`,
  ];

  const auditLine = transactionDate ? [`Recorded At: ${formatDate(transactionDate)}`] : [];

  const footer = [
    '',
    `Wallet Balance: ${formatCurrency(walletBalance)}`,
    '',
    ...auditLine,
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

// ─── Feed receipt ──────────────────────────────────────────

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

  const itemLines = items.map(item => {
    const qtyLabel = item.unit
      ? `${item.quantity} ${item.unit} ${item.productName}`
      : `${item.quantity} x ${item.productName}`;
    const categoryPart = item.category ? ` (${item.category})` : '';
    const unitPriceStr = formatCurrency(item.unitPrice);
    const totalStr = formatCurrency(item.lineTotal);
    return `${qtyLabel}${categoryPart} @ ${unitPriceStr} = ${totalStr}`;
  });

  const smsItems = itemLines.join('\n');
  const smsBody = [
    `Payment: ${paymentLabel}`,
    '',
    smsItems,
    '',
    `TOTAL: ${formatCurrency(total)}`,
  ];

  const printableItems = itemLines.map(line => `  ${line}`).join('\n');
  const printableBody = [
    `Payment: ${paymentLabel}`,
    '',
    printableItems,
    '',
    `TOTAL: ${formatCurrency(total)}`,
  ];

  const footer = [
    '',
    `Wallet Balance: ${formatCurrency(walletBalance)}`,
    '',
    `Transaction Date: ${formatDate(transactionDate)}`,
    '',
    'Thank you.',
  ];

  const sms = [...header, ...smsBody, ...footer].join('\n');
  const printable = [
    ...header,
    SEPARATOR,
    ...printableBody,
    SEPARATOR,
    ...footer,
    SEPARATOR,
  ].join('\n');

  return { sms, printable };
};

module.exports = {
  formatCurrency,
  formatDate,
  formatMilkReceipt,
  formatFeedReceipt,
};