// utils/excel/bankPaymentExcel.js
const ExcelJS = require('exceljs');

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

/**
 * Build bank payment workbook.
 * Amount is ALWAYS the pre-calculated netPayout — never recalculated here.
 *
 * @param {Array<{ fullName: string, accountNumber: string, amount: number }>} bankRows
 * @param {object} metadata
 * @returns {Promise<ExcelJS.Workbook>}
 */
const createBankPaymentWorkbook = async (bankRows, metadata = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MaziwaSmart';
  wb.created = new Date();

  const ws = wb.addWorksheet('Bank Payments', {
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
    // Force account number as text (leading zeros)
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

  if (metadata.cooperativeName || metadata.year) {
    const meta = wb.addWorksheet('Meta');
    meta.columns = [
      { header: 'Field', key: 'field', width: 22 },
      { header: 'Value', key: 'value', width: 40 },
    ];
    if (metadata.cooperativeName) {
      meta.addRow({ field: 'Cooperative', value: metadata.cooperativeName });
    }
    if (metadata.year != null) meta.addRow({ field: 'Year', value: metadata.year });
    if (metadata.month != null) meta.addRow({ field: 'Month', value: metadata.month });
    meta.addRow({ field: 'Payment Rows', value: bankRows.length });
    meta.addRow({
      field: 'Source',
      value: 'monthlyPaymentService.netPayout + Farmer.accountNumber',
    });
  }

  return wb;
};

module.exports = { createBankPaymentWorkbook };
