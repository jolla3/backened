const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema(
  {
    cooperativeId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Cooperative',
      required: true,
      index: true,
    },
    farmerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Farmer',
      required: true,
      index: true,
    },
    settlementId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Settlement',
      required: true,
      index: true,
    },
    batchId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'SettlementBatch',
      required: true,
      index: true,
    },

    amount: { type: Number, required: true },
    method: {
      type: String,
      enum: ['CASH', 'BANK', 'MPESA', 'CHEQUE', 'INTERNAL_TRANSFER', 'OTHER'],
      required: true,
    },
    reference: { type: String },
    externalReference: { type: String },

    status: {
      type: String,
      enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'],
      default: 'PENDING',
      index: true,
    },

    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    confirmedAt: Date,
    failureReason: String,
    notes: String,

    // No index: true here — unique sparse index is declared below
    idempotencyKey: { type: String },
  },
  { timestamps: true }
);

paymentSchema.index({ cooperativeId: 1, settlementId: 1, createdAt: -1 });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

module.exports =
  mongoose.models.Payment || mongoose.model('Payment', paymentSchema);