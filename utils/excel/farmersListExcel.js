// utils/excel/farmersListExcel.js
const ExcelJS = require('exceljs');

const moneyFmt = '#,##0.00';
const headerFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FF1F4E79' },
};
const headerFont = { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 };
const inactiveFill = {
  type: 'pattern',
  pattern: 'solid',
  fgColor: { argb: 'FFFCE4D6' },
};

/**
 * @param {Array<object>} farmers - normalized farmer rows
 * @param {{ cooperativeName?: string }} metadata
 * @returns {Promise<ExcelJS.Workbook>}
 */
const createFarmersListWorkbook = async (farmers, metadata = {}) => {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MaziwaSmart';
  wb.created = new Date();

  const ws = wb.addWorksheet('Farmers', {
    views: [{ state: 'frozen', ySplit: 1 }],
  });

  ws.columns = [
    { header: 'No', key: 'no', width: 6 },
    { header: 'Farmer Code', key: 'farmerCode', width: 14 },
    { header: 'Name', key: 'name', width: 28 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Location', key: 'location', width: 18 },
    { header: 'Zone', key: 'zoneName', width: 16 },
    { header: 'Branch', key: 'branchId', width: 12 },
    { header: 'Bank Name', key: 'bankName', width: 18 },
    { header: 'Account Number', key: 'accountNumber', width: 20 },
    { header: 'Current Balance', key: 'currentBalance', width: 15 },
    { header: 'Status', key: 'status', width: 16 },
    { header: 'Active', key: 'active', width: 10 },
  ];

  const headerRow = ws.getRow(1);
  headerRow.eachCell((cell) => {
    cell.fill = headerFill;
    cell.font = headerFont;
    cell.alignment = { horizontal: 'center', vertical: 'middle' };
  });
  headerRow.height = 20;

  farmers.forEach((f, idx) => {
    const row = ws.addRow({
      no: idx + 1,
      farmerCode: f.farmerCode || '',
      name: f.name || '',
      phone: f.phone || '',
      location: f.location || '',
      zoneName: f.zoneName || '',
      branchId: f.branchId || '',
      bankName: f.bankName || '',
      accountNumber: f.accountNumber ? String(f.accountNumber) : '',
      currentBalance: Number(f.currentBalance) || 0,
      status: f.status || '',
      active: f.active === false ? 'No' : 'Yes',
    });
    row.getCell('accountNumber').numFmt = '@';
    row.getCell('phone').numFmt = '@';
    row.getCell('currentBalance').numFmt = moneyFmt;
    if (f.active === false) {
      row.eachCell((cell) => {
        cell.fill = inactiveFill;
      });
    }
  });

  const meta = wb.addWorksheet('Meta');
  meta.columns = [
    { header: 'Field', key: 'field', width: 22 },
    { header: 'Value', key: 'value', width: 40 },
  ];
  if (metadata.cooperativeName) {
    meta.addRow({ field: 'Cooperative', value: metadata.cooperativeName });
  }
  meta.addRow({ field: 'Exported At', value: new Date().toISOString() });
  meta.addRow({ field: 'Farmer Count', value: farmers.length });
  meta.addRow({
    field: 'Active Count',
    value: farmers.filter((f) => f.active !== false).length,
  });
  meta.addRow({
    field: 'With Bank Account',
    value: farmers.filter((f) => String(f.accountNumber || '').trim()).length,
  });

  return wb;
};

module.exports = { createFarmersListWorkbook };
