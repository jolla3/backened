const { parse: parseToCsv } = require('json2csv');

const convertToCSV = (data) => {
  // json2csv v6: parse() is a top-level export
  return parseToCsv(data);
};

// Optional PDF helper — keep if jspdf is installed; soft-fail otherwise
const generatePDF = (data) => {
  try {
    const jsPDF = require('jspdf');
    const doc = new jsPDF();
    doc.text(JSON.stringify(data, null, 2), 10, 10);
    return doc.output('datauristring');
  } catch (err) {
    throw new Error('PDF generation unavailable: ' + err.message);
  }
};

module.exports = { convertToCSV, generatePDF };
