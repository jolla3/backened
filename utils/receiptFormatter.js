/**
 * Receipt Formatter – pure formatting only.
 * No database calls, no business logic, no side effects.
 */

const SEPARATOR = '='.repeat(40);

// ─── Cooperative helpers ────────────────────────────────────

/**
 * Human-readable short name for SMS / printable receipts.
 * Deterministic and generic – never hard-coded.
 *
 * Examples:
 *   "ITHITU DAIRY CO-OP SOCIETY LTD"     → "ITHITU DAIRY"
 *   "MERU FARMERS COOPERATIVE SOCIETY"   → "MERU FARMERS"
 *   "KIRINYAGA DAIRY FARMERS CO-OP LTD"  → "KIRINYAGA DAIRY"
 */
function getCooperativeShortName(cooperativeName) {
  if (!cooperativeName || typeof cooperativeName !== 'string') return 'COOP';

  let name = cooperativeName
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
    .toUpperCase();

  // Remove common legal / organisational suffixes
  const suffixes = [
    /\bLIMITED\b/g,
    /\bLTD\b\.?/g,
    /\bPLC\b/g,
    /\bCOMPANY\b/g,
    /\bCO\.?\b/g,
    /\bCOOPERATIVE\b/g,
    /\bCO-OPERATIVE\b/g,
    /\bCO-OP\b/g,
    /\bSOCIETY\b/g,
    /\bS\.?C\.?\b/g,
  ];

  for (const re of suffixes) {
    name = name.replace(re, ' ');
  }

  name = name.replace(/\s+/g, ' ').trim();
  const tokens = name.split(' ').filter(Boolean);

  if (tokens.length === 0) return 'COOP';
  if (tokens.length === 1) return tokens[0];

  // Keep meaningful second token (DAIRY, FARMERS, etc.)
  const identityWords = new Set(['DAIRY', 'FARMERS', 'FARMER', 'MILK', 'UNION']);
  if (tokens.length >= 2 && identityWords.has(tokens[1])) {
    return `${tokens[0]} ${tokens[1]}`;
  }

  // Fallback: first token only
  return tokens[0];
}

/**
 * Exactly 3 uppercase alphabetic characters.
 * Deterministic. Never random. Never contains numbers.
 */
function getCooperativePrefix(cooperativeName) {
  const short = getCooperativeShortName(cooperativeName).replace(/[^A-Z]/g, '');

  if (short.length >= 3) return short.slice(0, 3);
  if (short.length === 2) return short + short[0];
  if (short.length === 1) return short.repeat(3);
  return 'XXX';
}

// ─── Currency ───────────────────────────────────────────────

const formatCurrency = (amount) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return 'KES 0.00';
  return `KES ${n.toLocaleString('en-KE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
};

const formatSmsCurrency = (amount) => {
  const n = Number(amount || 0);
  if (!Number.isFinite(n)) return 'KES 0';

  const abs = Math.abs(Math.round(n));
  const formatted = abs.toLocaleString('en-KE');

  if (n < 0) {
    return `-KES ${formatted}`;   // clearer than "KES -18,650"
  }
  return `KES ${formatted}`;
};
// ─── Defensive date helpers (Africa/Nairobi) ────────────────

function isValidDate(d) {
  return d instanceof Date && !isNaN(d.getTime());
}

const formatDate = (date) => {
  try {
    const d = date instanceof Date ? date : new Date(date);
    if (!isValidDate(d)) return '';
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
};

const formatCollectionDate = (dateInput) => {
  if (dateInput == null || dateInput === '') return '';
  try {
    let d;
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [y, m, day] = dateInput.split('-').map(Number);
      d = new Date(Date.UTC(y, m - 1, day)); // preserve calendar day
    } else {
      d = new Date(dateInput);
    }
    if (!isValidDate(d)) return String(dateInput);
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      day: 'numeric',
      month: 'short',
      year: 'numeric',
    }).format(d);
  } catch {
    return String(dateInput);
  }
};

const formatSmsDate = (dateInput) => {
  if (dateInput == null || dateInput === '') return '';
  try {
    let d;
    if (typeof dateInput === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(dateInput)) {
      const [y, m, day] = dateInput.split('-').map(Number);
      d = new Date(Date.UTC(y, m - 1, day));
    } else {
      d = new Date(dateInput);
    }
    if (!isValidDate(d)) return '';
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      day: 'numeric',
      month: 'short',
    }).format(d);
  } catch {
    return '';
  }
};

const formatSmsTime = (timeInput) => {
  if (timeInput == null || timeInput === '') return '';
  try {
    if (timeInput instanceof Date) {
      if (!isValidDate(timeInput)) return '';
      return new Intl.DateTimeFormat('en-KE', {
        timeZone: 'Africa/Nairobi',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      }).format(timeInput);
    }

    const value = String(timeInput).trim();
    const match = value.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (match) {
      let hour = Number(match[1]);
      const minute = Number(match[2]);
      if (hour > 23 || minute > 59) return '';
      const suffix = hour >= 12 ? 'PM' : 'AM';
      const displayHour = hour % 12 || 12;
      return `${displayHour}:${String(minute).padStart(2, '0')} ${suffix}`;
    }

    const d = new Date(value);
    if (!isValidDate(d)) return '';
    return new Intl.DateTimeFormat('en-KE', {
      timeZone: 'Africa/Nairobi',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    }).format(d);
  } catch {
    return '';
  }
};

// ─── Product & quantity helpers ─────────────────────────────

function compactProductName(name, maxLen = 18) {
  if (!name) return 'Item';
  let s = String(name).replace(/\s+/g, ' ').trim();
  if (s.length <= maxLen) return s;
  const parts = s.split(' ');
  if (parts.length > 1) {
    const candidate = parts.slice(0, 2).join(' ');
    if (candidate.length <= maxLen) return candidate;
  }
  return s.slice(0, maxLen - 1) + '…';
}

/**
 * Safe quantity + unit formatting.
 * Prefer "25 kg" over "25kg". Never produce "25 kg kg".
 */
function formatQuantity(quantity, unit) {
  const q = quantity != null && quantity !== '' ? String(quantity).trim() : '';
  const u = unit != null && unit !== '' ? String(unit).trim() : '';
  if (!q && !u) return '';
  if (!u) return q;
  if (!q) return u;
  return `${q} ${u}`;
}

// ─── Farmer line helper ─────────────────────────────────────

function buildFarmerLine(farmerName, farmerCode) {
  const name = (farmerName || '').trim();
  const code = (farmerCode || '').trim();

  if (name && code) return `${name} #${code}`;
  if (name) return name;
  if (code) return `Farmer #${code}`;
  return 'Farmer';
}

// ─── Milk receipt ───────────────────────────────────────────

const formatMilkReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  litres,
  payout,
  walletBalance,
  cumulativeMilk,          // standardised name
  collectionDate,
  collectionShift,
}) => {
  const milk = Number(litres || 0);
  const cumulative = Number(cumulativeMilk || 0);
  const shortName = getCooperativeShortName(cooperativeName);
  const farmerLine = buildFarmerLine(farmerName, farmerCode);

  const when = [formatSmsDate(collectionDate), collectionShift]
    .filter(Boolean)
    .join(' ');

  const sms = [
    shortName,
    farmerLine,
    receiptNumber || '',
    `Milk ${milk}L Earned ${formatSmsCurrency(payout)}`,
    `Month ${cumulative}L Wallet ${formatSmsCurrency(walletBalance)}`,
    when,
  ]
    .filter(Boolean)
    .join('\n');

  const printable = [
    shortName,
    'MILK DELIVERY RECEIPT',
    '',
    `Receipt: ${receiptNumber || 'N/A'}`,
    `Farmer: ${farmerName || ''}`,
    `Code: ${farmerCode || ''}`,
    SEPARATOR,
    `Milk: ${milk.toFixed(1)} L`,
    `Month Total: ${cumulative.toFixed(1)} L`,
    `Earned: ${formatCurrency(payout)}`,
    `Collection: ${formatCollectionDate(collectionDate)}${collectionShift ? `, ${collectionShift}` : ''}`,
    SEPARATOR,
    `Wallet: ${formatCurrency(walletBalance)}`,
    '',
    'Thank you.',
    SEPARATOR,
  ].join('\n');

  return { sms, printable, smsLength: sms.length };
};

// ─── Feed purchase receipt ──────────────────────────────────

const formatFeedReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  items = [],
  total,
  walletBalance,
}) => {
  const shortName = getCooperativeShortName(cooperativeName);
  const farmerLine = buildFarmerLine(farmerName, farmerCode);

  const itemLines = (items || []).map((item) => {
    const name = compactProductName(item.productName || item.name);
    const qtyLabel = formatQuantity(item.quantity, item.unit);
    return `${name} ${qtyLabel} @ ${formatSmsCurrency(item.unitPrice)}`.trim();
  });

  const sms = [
    shortName,
    farmerLine,
    receiptNumber || '',
    ...itemLines,
    `Total ${formatSmsCurrency(total)}`,
    `Wallet ${formatSmsCurrency(walletBalance)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { sms, smsLength: sms.length };
};

// ─── Deduction receipt ──────────────────────────────────────

const formatDeductionReceipt = ({
  cooperativeName,
  receiptNumber,
  farmerName,
  farmerCode,
  reason,
  amount,
  walletBalance,
  items = [],                 // multi-product preferred
  productName,                // legacy single-product
  quantity,
  unit,
  unitPrice,
}) => {
  const shortName = getCooperativeShortName(cooperativeName);
  const farmerLine = buildFarmerLine(farmerName, farmerCode);

  const reasonLabels = {
    feeds: 'Feed',
    debt: 'Debt',
    loan: 'Loan',
    interest: 'Interest',
    penalty: 'Penalty',
    other: 'Deduction',
  };
  const label = reasonLabels[reason] || 'Deduction';

  let productLines = [];

  if (Array.isArray(items) && items.length > 0) {
    productLines = items.map((item) => {
      const name = compactProductName(item.productName || item.name);
      const qtyLabel = formatQuantity(item.quantity, item.unit);
      return `${name} ${qtyLabel} @ ${formatSmsCurrency(item.unitPrice)}`.trim();
    });
  } else if (reason === 'feeds' && productName) {
    const name = compactProductName(productName, 24);
    const qtyLabel = formatQuantity(quantity, unit);
    productLines = [`${name} ${qtyLabel} @ ${formatSmsCurrency(unitPrice)}`.trim()];
  }

  const sms = [
    shortName,
    farmerLine,
    receiptNumber || '',
    ...productLines,
    productLines.length
      ? `Deducted ${formatSmsCurrency(amount)}`
      : `${label} ${formatSmsCurrency(amount)}`,
    `Wallet ${formatSmsCurrency(walletBalance)}`,
  ]
    .filter(Boolean)
    .join('\n');

  return { sms, smsLength: sms.length };
};

module.exports = {
  getCooperativeShortName,
  getCooperativePrefix,
  formatCurrency,
  formatSmsCurrency,
  formatDate,
  formatCollectionDate,
  formatSmsDate,
  formatSmsTime,
  formatMilkReceipt,
  formatFeedReceipt,
  formatDeductionReceipt,
  compactProductName,
  formatQuantity,
  buildFarmerLine,
};