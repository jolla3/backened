const reportService = require('../services/reportService');
const monthlyPaymentService = require('../services/monthlyPaymentService');
const {
  createMonthlySummaryWorkbook,
  createBankPaymentsZipByBank,
  buildSummaryFilename,
  buildBankZipFilename,
} = require('../utils/excel');
const logger = require('../utils/logger');

// json2csv v6 exports { parse, Parser } — not { json2csv }
const { parse: parseToCsv } = require('json2csv');

/**
 * Flatten the monthly report object into an array of simple rows for CSV.
 * Nested charts/graphs are omitted; executive + operational totals are exported.
 */
function flattenReportForCsv(report, year, month) {
  if (!report || typeof report !== 'object') {
    return [{ year, month, note: 'No report data' }];
  }

  const kpis = report.executiveKpis || report.overview || {};
  const operational = report.operational || {};
  const financial = report.financial || {};

  if (Array.isArray(report.rows) && report.rows.length) {
    return report.rows;
  }
  if (Array.isArray(report) && report.length) {
    return report;
  }

  const summary = {
    year,
    month,
    cooperative:
      (report.cooperative && report.cooperative.name) ||
      report.cooperative ||
      '',
    totalLitres:
      kpis.totalLitres ?? operational.totalLitres ?? '',
    totalMilkPayout:
      kpis.totalMilkPayout ??
      operational.totalPayout ??
      financial.totalMilkPayout ??
      '',
    totalFeedRevenue:
      kpis.totalFeedRevenue ?? financial.totalFeedRevenue ?? '',
    activeFarmers:
      kpis.activeFarmers ?? operational.uniqueFarmersCount ?? '',
    transactionCount:
      kpis.transactionCount ?? operational.transactionCount ?? '',
  };

  return [summary];
}

const getMonthly = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;
    const report = await reportService.getMonthlyReport(year, month, cooperativeId);
    res.json(report);
  } catch (error) {
    logger.error('Get monthly report failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

const exportCSV = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;

    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || new Date().getMonth() + 1;

    const data = await reportService.getMonthlyReport(year, month, cooperativeId);

    // Flatten nested monthly report into a single CSV-friendly row of KPIs
    // (full nested JSON is not a valid flat CSV structure)
    const flat = flattenReportForCsv(data, year, month);
    const csv = parseToCsv(flat);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename=report_${year}_${String(month).padStart(2, '0')}.csv`
    );
    res.send(csv);
  } catch (error) {
    logger.error('Export CSV failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

/**
 * JSON preview of authoritative monthly payment rows (Ledger-based).
 * GET /api/reports/monthly-payment?year=2026&month=9
 */
const getMonthlyPayment = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;

    const result = await monthlyPaymentService.calculateMonthlyPayments({
      cooperativeId,
      year,
      month,
    });

    const missingBankDetails = monthlyPaymentService.findMissingBankDetails(result);

    res.json({
      success: true,
      cooperative: result.cooperative,
      period: {
        year: result.period.year,
        month: result.period.month,
        periodStart: result.period.periodStart,
        periodEnd: result.period.periodEnd,
        nextPeriodStart: result.period.nextPeriodStart,
      },
      totals: result.totals,
      farmerCount: result.rows.length,
      missingBankDetailsCount: missingBankDetails.length,
      missingBankDetails,
      rows: result.rows.map((r) => ({
        farmerId: r.farmerId,
        farmerCode: r.farmerCode,
        farmerName: r.farmerName,
        milkLitres: r.milkLitres,
        grossEarnings: r.grossEarnings,
        deductions: r.deductions,
        bonuses: r.bonuses,
        adjustments: r.adjustments,
        netPayout: r.netPayout,
        hasBankAccount: Boolean(String(r.accountNumber || '').trim()),
      })),
    });
  } catch (error) {
    logger.error('Get monthly payment failed', {
      error: error.message,
      coopId: req.user.cooperativeId,
    });
    res.status(400).json({ success: false, error: error.message });
  }
};

/**
 * Monthly Summary Excel (no bank columns).
 * GET /api/reports/monthly-payment/excel/summary?year=2026&month=9
 */
const exportMonthlySummaryExcel = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;

    const result = await monthlyPaymentService.calculateMonthlyPayments({
      cooperativeId,
      year,
      month,
    });

    const workbook = await createMonthlySummaryWorkbook(result);
    const filename = buildSummaryFilename({
      year,
      month,
      cooperativeName: result.cooperative.name,
    });

    res.setHeader(
      'Content-Type',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);

    await workbook.xlsx.write(res);
    res.end();
  } catch (error) {
    logger.error('Export monthly summary excel failed', {
      error: error.message,
      coopId: req.user.cooperativeId,
    });
    if (!res.headersSent) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
};

/**
 * Bank Payment Excel — Amount is the same netPayout from monthlyPaymentService.
 * Blocks generation if any payable farmer is missing accountNumber.
 * GET /api/reports/monthly-payment/excel/bank?year=2026&month=9
 */
const exportBankPaymentExcel = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const year = parseInt(req.query.year, 10) || new Date().getFullYear();
    const month = parseInt(req.query.month, 10) || new Date().getMonth() + 1;

    const result = await monthlyPaymentService.calculateMonthlyPayments({
      cooperativeId,
      year,
      month,
    });

    // Payable farmers must have account numbers (bank file cannot omit them)
    const missingBankDetails = monthlyPaymentService.findMissingBankDetails(result);
    if (missingBankDetails.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some farmers are missing bank account details',
        missingBankDetails,
      });
    }

    // Positive net payout only — amount is authoritative netPayout
    const payableRows = result.rows
      .filter((r) => r.netPayout > 0)
      .map((r) => ({
        farmerName: r.farmerName,
        accountNumber: String(r.accountNumber).trim(),
        netPayout: r.netPayout,
        bankName: String(r.bankName || '').trim(),
      }));

    // One Excel per bankName, packaged as a ZIP folder
    const { buffer, bankCount, banks } = await createBankPaymentsZipByBank(payableRows, {
      cooperativeName: result.cooperative.name,
      year,
      month,
    });

    const filename = buildBankZipFilename({
      year,
      month,
      cooperativeName: result.cooperative.name,
    });

    logger.info('Bank payment ZIP generated', {
      coopId: cooperativeId,
      year,
      month,
      bankCount,
      banks,
      payableFarmers: payableRows.length,
    });

    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.setHeader('Content-Length', buffer.length);
    res.send(buffer);
  } catch (error) {
    logger.error('Export bank payment excel failed', {
      error: error.message,
      coopId: req.user.cooperativeId,
    });
    if (!res.headersSent) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
};

module.exports = {
  getMonthly,
  exportCSV,
  getMonthlyPayment,
  exportMonthlySummaryExcel,
  exportBankPaymentExcel,
};
