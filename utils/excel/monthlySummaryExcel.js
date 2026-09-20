// utils/excel/monthlySummaryExcel.js
const ExcelJS = require('exceljs');

const moneyFmt = '#,##0.00';
const litresFmt = '#,##0.00';

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
 * @param {object} paymentResult - from monthlyPaymentService.calculateMonthlyPayments
 * @returns {Promise<ExcelJS.Workbook>}
 */
const createMonthlySummaryWorkbook = async (paymentResult) => {
  const { cooperative, period, rows, totals } = paymentResult;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MaziwaSmart';
  wb.created = new Date();

  const ws = wb.addWorksheet('Monthly Summary', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'Farmer Code', key: 'farmerCode', width: 14 },
    { header: 'Farmer Name', key: 'farmerName', width: 28 },
    { header: 'Milk Quantity', key: 'milkLitres', width: 14 },
    { header: 'Gross Earnings', key: 'grossEarnings', width: 15 },
    { header: 'Deductions', key: 'deductions', width: 13 },
    { header: 'Bonuses', key: 'bonuses', width: 12 },
    { header: 'Adjustments', key: 'adjustments', width: 13 },
    { header: 'Net Payout', key: 'netPayout', width: 14 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 20;

  for (const r of rows) {
    const row = ws.addRow({
      farmerCode: r.farmerCode,
      farmerName: r.farmerName,
      milkLitres: r.milkLitres,
      grossEarnings: r.grossEarnings,
      deductions: r.deductions,
      bonuses: r.bonuses,
      adjustments: r.adjustments,
      netPayout: r.netPayout,
    });
    row.getCell('milkLitres').numFmt = litresFmt;
    row.getCell('grossEarnings').numFmt = moneyFmt;
    row.getCell('deductions').numFmt = moneyFmt;
    row.getCell('bonuses').numFmt = moneyFmt;
    row.getCell('adjustments').numFmt = moneyFmt;
    row.getCell('netPayout').numFmt = moneyFmt;
  }

  const totalRow = ws.addRow({
    farmerCode: '',
    farmerName: 'TOTAL',
    milkLitres: totals.milkLitres,
    grossEarnings: totals.grossEarnings,
    deductions: totals.deductions,
    bonuses: totals.bonuses,
    adjustments: totals.adjustments,
    netPayout: totals.netPayout,
  });
  totalRow.font = { bold: true };
  totalRow.eachCell((cell) => {
    cell.fill = totalFill;
  });
  totalRow.getCell('milkLitres').numFmt = litresFmt;
  totalRow.getCell('grossEarnings').numFmt = moneyFmt;
  totalRow.getCell('deductions').numFmt = moneyFmt;
  totalRow.getCell('bonuses').numFmt = moneyFmt;
  totalRow.getCell('adjustments').numFmt = moneyFmt;
  totalRow.getCell('netPayout').numFmt = moneyFmt;

  // Metadata sheet
  const meta = wb.addWorksheet('Meta');
  meta.columns = [
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Value', key: 'value', width: 40 },
  ];
  meta.addRow({ field: 'Cooperative', value: cooperative.name });
  meta.addRow({ field: 'Year', value: period.year });
  meta.addRow({ field: 'Month', value: period.month });
  meta.addRow({
    field: 'Period Start (UTC)',
    value: period.periodStart.toISOString(),
  });
  meta.addRow({
    field: 'Period End (UTC)',
    value: period.periodEnd.toISOString(),
  });
  meta.addRow({ field: 'Farmer Rows', value: rows.length });
  meta.addRow({ field: 'Source', value: 'Ledger (settleable types)' });

  return wb;
};

module.exports = { createMonthlySummaryWorkbook };
