// utils/excel/index.js
const { createMonthlySummaryWorkbook } = require('./monthlySummaryExcel');
const {
  createBankPaymentWorkbook,
  createBankPaymentsZipByBank,
  groupPayableByBank,
  sanitizeBankFilePart,
} = require('./bankPaymentExcel');
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

/** Single-file name (legacy). Prefer ZIP for multi-bank. */
const buildBankFilename = ({ year, month, cooperativeName, bankName }) => {
  const ym = `${year}_${String(month).padStart(2, '0')}`;
  const coop = sanitizeFilenamePart(cooperativeName);
  if (bankName) {
    const bank = sanitizeBankFilePart(bankName);
    return coop ? `Bank_${bank}_${coop}_${ym}.xlsx` : `Bank_${bank}_${ym}.xlsx`;
  }
  return coop
    ? `Bank_Payments_${coop}_${ym}.xlsx`
    : `Bank_Payments_${ym}.xlsx`;
};

/** Multi-bank package */
const buildBankZipFilename = ({ year, month, cooperativeName }) => {
  const ym = `${year}_${String(month).padStart(2, '0')}`;
  const coop = sanitizeFilenamePart(cooperativeName);
  return coop
    ? `Bank_Payments_${coop}_${ym}.zip`
    : `Bank_Payments_${ym}.zip`;
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
  createBankPaymentsZipByBank,
  groupPayableByBank,
  createFarmersListWorkbook,
  buildSummaryFilename,
  buildBankFilename,
  buildBankZipFilename,
  buildFarmersListFilename,
  sanitizeFilenamePart,
  sanitizeBankFilePart,
};
