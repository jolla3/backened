// utils/excel/index.js
const { createMonthlySummaryWorkbook } = require('./monthlySummaryExcel');
const { createBankPaymentWorkbook } = require('./bankPaymentExcel');
const { createFarmersListWorkbook } = require('./farmersListExcel');

const sanitizeFilenamePart = (value) =>
  String(value || '')
    .replace(/[^\w\-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 40);

const buildSummaryFilename = ({ year, month, cooperativeName }) => {
  const ym = `${year}_${String(month).padStart(2, '0')}`;
  const coop = sanitizeFilenamePart(cooperativeName);
  return coop
    ? `Monthly_Summary_${coop}_${ym}.xlsx`
    : `Monthly_Summary_${ym}.xlsx`;
};

const buildBankFilename = ({ year, month, cooperativeName }) => {
  const ym = `${year}_${String(month).padStart(2, '0')}`;
  const coop = sanitizeFilenamePart(cooperativeName);
  return coop
    ? `Bank_Payments_${coop}_${ym}.xlsx`
    : `Bank_Payments_${ym}.xlsx`;
};

const buildFarmersListFilename = ({ cooperativeName }) => {
  const coop = sanitizeFilenamePart(cooperativeName);
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  return coop
    ? `Farmers_List_${coop}_${day}.xlsx`
    : `Farmers_List_${day}.xlsx`;
};

module.exports = {
  createMonthlySummaryWorkbook,
  createBankPaymentWorkbook,
  createFarmersListWorkbook,
  buildSummaryFilename,
  buildBankFilename,
  buildFarmersListFilename,
  sanitizeFilenamePart,
};
