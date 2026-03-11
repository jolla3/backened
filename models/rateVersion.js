const mongoose = require('mongoose');

const rateVersionSchema = new mongoose.Schema({
  type: {
    type: String,
    required: true,
    index: true
  },
  rate: {
    type: Number,
    required: true
  },
  effective_date: {
    type: Date,
    required: true,
    index: true
  },
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, {
  timestamps: true
});

rateVersionSchema.index({ type: 1, effective_date: -1 });

module.exports = mongoose.model('RateVersion', rateVersionSchema);