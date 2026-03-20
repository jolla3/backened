const reportService = require('../services/reportService');
const logger = require('../utils/logger');

const getMonthly = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;  // ✅ From JWT
    const report = await reportService.getMonthlyReport(
      req.query.year || new Date().getFullYear(),
      req.query.month || (new Date().getMonth() + 1),
      cooperativeId  // ✅ Pass cooperativeId
    );
    res.json(report);
  } catch (error) {
    logger.error('Get monthly report failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};
const exportCSV = async (req, res) => {
  try {
    const adminId = req.user.id;
    const { json2csv } = require('json2csv');
    const data = await reportService.getMonthlyReport(req.query.year, req.query.month, adminId);
    const csv = json2csv.parse([data]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=report.csv');
    res.send(csv);
  } catch (error) {
    logger.error('Export CSV failed', { error: error.message, adminId: req.user.id });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getMonthly, exportCSV };