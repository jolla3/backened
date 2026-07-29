// utils/receiptFormatter.js
// Pure dumb formatter – no validation, no business logic, no state.
// Receives raw data, returns SMS and printable strings.

const SEPARATOR = '='.repeat(40);

const formatCurrency = (amount) => {
  return `KES ${Number(amount).toLocaleString('en-KE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

const formatDate = (date) => {
  const d = new Date(date);
  if (isNaN(d.getTime())) {
    throw new Error('Invalid transaction date');
  }
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const day = String(d.getDate()).padStart(2,'0');
  const month = months[d.getMonth()];
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2,'0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12 || 12;
  return `${day} ${month} ${year} ${hours}:${minutes} ${ampm}`;
};

// ─── Shared header ─────────────────────────────────────────

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

// ─── Milk receipt ──────────────────────────────────────────

const formatMilkReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  litres,
  payout,
  walletBalance,
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
    `Delivered At: ${formatDate(transactionDate)}`,
  ];

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

// ─── Feed receipt ──────────────────────────────────────────

const formatFeedReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  paymentMethod,
  items,          // [{ productName, quantity, unit, category, unitPrice, lineTotal }]
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

  const paymentLabel = paymentMethod === 'balance'
    ? 'Farmer Balance'
    : 'Cash';

  // ── Build item lines for SMS and printable ──
  // Each item: "2 x Dairy Meal (Feed) @ KES 3,500 = KES 7,000"
  const itemLines = items.map(item => {
    const qtyLabel = item.unit
      ? `${item.quantity} ${item.unit} ${item.productName}`
      : `${item.quantity} x ${item.productName}`;
    const categoryPart = item.category ? ` (${item.category})` : '';
    const unitPriceStr = formatCurrency(item.unitPrice);
    const totalStr = formatCurrency(item.lineTotal);
    return `${qtyLabel}${categoryPart} @ ${unitPriceStr} = ${totalStr}`;
  });

  // For printable, we might want to indent the line total, but we'll keep it simple.
  // For SMS, we put each item on its own line, no extra blank lines between.
  // The SMS body will have items separated by newline only.

  const smsItems = itemLines.join('\n');

  const smsBody = [
    `Payment: ${paymentLabel}`,
    '',
    smsItems,
    '',
    `TOTAL: ${formatCurrency(total)}`,
  ];

  // Printable: same items, but indented slightly for readability
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
    `Purchased At: ${formatDate(transactionDate)}`,
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