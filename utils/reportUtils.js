const { json2csv } = require('json2csv');
const jsPDF = require('jspdf');

const convertToCSV = (data) => {
  return json2csv.parse(data);
};

const generatePDF = (data) => {
  const doc = new jsPDF();
  doc.text(JSON.stringify(data, null, 2), 10, 10);
  return doc.output('datauristring');
};

module.exports = { convertToCSV, generatePDF };