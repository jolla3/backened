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
    type: String,
    required: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

// Composite index for rate lookup
rateVersionSchema.index({ type: 1, effective_date: -1 });

module.exports = mongoose.model('RateVersion', rateVersionSchema);