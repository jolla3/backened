const reportService = require('../services/reportService');
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
    res.setHeader('Content-Disposition', `attachment; filename=report_${year}_${String(month).padStart(2, '0')}.csv`);
    res.send(csv);
  } catch (error) {
    logger.error('Export CSV failed', { error: error.message, coopId: req.user.cooperativeId });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getMonthly, exportCSV };