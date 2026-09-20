// utils/excel/bankPaymentExcel.js
const ExcelJS = require('exceljs');
const { createZipBuffer } = require('./zipStore');

const moneyFmt = '#,##0.00';

const headerFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};
const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const totalFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFD9E2F3' },
};

const sanitizePart = (value, fallback = 'Unknown') =>
  String(value || fallback)
    .trim()
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40) || fallback;

/**
 * Group payable farmers by bankName.
 * Empty bankName → Unspecified_Bank
 */
const groupPayableByBank = (payableRows) => {
  const groups = new Map();
  for (const r of payableRows) {
    const raw = String(r.bankName || '').trim();
    const key = raw || 'Unspecified_Bank';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({
      fullName: r.farmerName || r.fullName || '',
      accountNumber: String(r.accountNumber || '').trim(),
      amount: Number(r.netPayout != null ? r.netPayout : r.amount) || 0,
    });
  }
  return new Map([...groups.entries()].sort((a, b) => a[0].localeCompare(b[0])));
};

/**
 * Filename inside the ZIP: {CoopName}_{BankName}.xlsx
 * (clean — coop + bank only; farmer rows are the file content)
 */
const buildPerBankExcelName = (cooperativeName, bankName) => {
  const coop = sanitizePart(cooperativeName, 'Cooperative');
  const bank = sanitizePart(bankName, 'Unspecified_Bank');
  return `${coop}_${bank}.xlsx`;
};

/**
 * One bank workbook — farmers only.
 * No Meta sheet. No title block.
 * Columns: Full Name | Account Number | Amount
 * Amount is always the pre-calculated netPayout.
 */
const createBankPaymentWorkbook = async (bankRows /* , metadata */) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MaziwaSmart';
  wb.created = new Date();

  const ws = wb.addWorksheet('Payments', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'Full Name', key: 'fullName', width: 30 },
    { header: 'Account Number', key: 'accountNumber', width: 22 },
    { header: 'Amount', key: 'amount', width: 14 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 20;

  let totalAmount = 0;
  for (const r of bankRows) {
    const amount = Number(r.amount) || 0;
    totalAmount += amount;
    const row = ws.addRow({
      fullName: r.fullName,
      accountNumber: String(r.accountNumber),
      amount,
    });
    row.getCell('accountNumber').numFmt = '@';
    row.getCell('amount').numFmt = moneyFmt;
  }

  const totalRow = ws.addRow({
    fullName: 'TOTAL',
    accountNumber: '',
    amount: Math.round((totalAmount + Number.EPSILON) * 100) / 100,
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => {
    cell.fill = totalFill;
  });
  totalRow.getCell('amount').numFmt = moneyFmt;

  return wb;
};

/**
 * ZIP of one Excel per bank.
 * File names: {CoopName}_{BankName}.xlsx
 */
const createBankPaymentsZipByBank = async (payableRows, metadata = {}) => {
  const groups = groupPayableByBank(payableRows);
  const files = [];
  const cooperativeName = metadata.cooperativeName || 'Cooperative';

  for (const [bankName, rows] of groups.entries()) {
    const wb = await createBankPaymentWorkbook(rows, {
      ...metadata,
      bankName,
    });
    const buf = await wb.xlsx.writeBuffer();
    files.push({
      name: buildPerBankExcelName(cooperativeName, bankName),
      data: Buffer.from(buf),
    });
  }

  if (!files.length) {
    const wb = await createBankPaymentWorkbook([], {
      ...metadata,
      bankName: 'No_Payments',
    });
    const buf = await wb.xlsx.writeBuffer();
    files.push({
      name: buildPerBankExcelName(cooperativeName, 'No_Payments'),
      data: Buffer.from(buf),
    });
  }

  return {
    buffer: createZipBuffer(files),
    bankCount: groups.size,
    banks: [...groups.keys()],
    files: files.map((f) => f.name),
  };
};

module.exports = {
  createBankPaymentWorkbook,
  createBankPaymentsZipByBank,
  groupPayableByBank,
  buildPerBankExcelName,
  sanitizePart,
};
