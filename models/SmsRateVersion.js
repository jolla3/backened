const mongoose = require('mongoose');

const smsRateVersionSchema = new mongoose.Schema(
  {
    provider: {
      type: String,
      enum: ['celcom', 'gateway', 'other'],
      default: 'celcom',
      required: true,
    },
    currency: {
      type: String,
      default: 'KES',
    },
    costPerSegment: {
      type: Number,
      required: true,
      min: 0,
    },
    effectiveFrom: {
      type: Date,
      required: true,
      default: Date.now,
    },
    effectiveTo: {
      type: Date,
      default: null, // null means still active
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    metadata: {
      type: Object,
      default: {},
    },
  },
  {
    timestamps: { createdAt: true, updatedAt: true },
  }
);

// Ensure only one active rate per provider at a time
smsRateVersionSchema.index({ provider: 1, isActive: 1 }, { unique: true, partialFilterExpression: { isActive: true } });

module.exports = mongoose.model('SmsRateVersion', smsRateVersionSchema);