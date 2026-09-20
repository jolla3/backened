const reportService = require('../services/reportService');
const monthlyPaymentService = require('../services/monthlyPaymentService');
const {
  createMonthlySummaryWorkbook,
  createBankPaymentWorkbook,
  buildSummaryFilename,
  buildBankFilename,
} = require('../utils/excel');
const logger = require('../utils/logger');

// ✅ Move json2csv to TOP - fix dynamic import issue
const { json2csv } = require('json2csv');

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

    // ✅ json2csv now available at module scope
    const csv = json2csv.parse([data]);

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

    const missingBankDetails = monthlyPaymentService.findMissingBankDetails(result);
    if (missingBankDetails.length > 0) {
      return res.status(400).json({
        success: false,
        message: 'Some farmers are missing bank account details',
        missingBankDetails,
      });
    }

    // Only include rows with positive net payout (nothing to pay if <= 0)
    const bankRows = result.rows
      .filter((r) => r.netPayout > 0)
      .map((r) => ({
        fullName: r.farmerName,
        accountNumber: String(r.accountNumber).trim(),
        amount: r.netPayout,
      }));

    const workbook = await createBankPaymentWorkbook(bankRows, {
      cooperativeName: result.cooperative.name,
      year,
      month,
    });
    const filename = buildBankFilename({
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
