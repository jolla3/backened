const mongoose = require('mongoose');

const rateVersionSchema = new mongoose.Schema({
  rate: { type: Number, required: true },
  effective_date: { type: Date, required: true, index: true },
  admin_id: { type: String, required: true },
  type: { type: String, enum: ['milk', 'feed'], required: true }
});

module.exports = mongoose.model('RateVersion', rateVersionSchema);