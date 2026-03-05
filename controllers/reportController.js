const reportService = require('../services/reportService');

const getMonthly = async (req, res) => {
  try {
    const report = await reportService.getMonthlyReport(req.query.year, req.query.month);
    res.json(report);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

const exportCSV = async (req, res) => {
  try {
    const { json2csv } = require('json2csv');
    const data = await reportService.getMonthlyReport(req.query.year, req.query.month);
    const csv = json2csv.parse([data]);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=report.csv');
    res.send(csv);
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
};

module.exports = { getMonthly, exportCSV };