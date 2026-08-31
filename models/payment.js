const mongoose = require('mongoose');

// A Settlement answers "what does the cooperative owe this farmer for this
// period, all carry-forward considered." It is NOT a claim that money moved.
// This collection is where that claim actually gets made — separately,
// auditable on its own, and extensible to real payment rails without
// touching settlement math at all.
const paymentSchema = new mongoose.Schema({
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
  farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
  settlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Settlement', required: true, index: true },
  batchId: { type: mongoose.Schema.Types.ObjectId, ref: 'SettlementBatch', required: true, index: true },

  amount: { type: Number, required: true },
  method: {
    type: String,
    enum: ['CASH', 'BANK', 'MPESA', 'CHEQUE', 'INTERNAL_TRANSFER', 'OTHER'],
    required: true,
  },
  // Internal settlement/payment reference (e.g. the settlementNumber).
  reference: { type: String },
  // The rail's own confirmation code (M-Pesa transaction code, bank
  // reference, cheque number...). Optional at creation, filled in on confirm.
  externalReference: { type: String },

  status: {
    type: String,
    enum: ['PENDING', 'CONFIRMED', 'FAILED', 'CANCELLED'],
    default: 'PENDING',
    index: true,
  },

  createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  confirmedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  confirmedAt: Date,
  failureReason: String,
  notes: String,

  // Retry-safety for "record this payment" requests, same pattern as Ledger.
  idempotencyKey: { type: String, index: true },
}, { timestamps: true });

paymentSchema.index({ cooperativeId: 1, settlementId: 1, createdAt: -1 });
paymentSchema.index({ idempotencyKey: 1 }, { unique: true, sparse: true });

const Payment = mongoose.models.Payment || mongoose.model('Payment', paymentSchema);
module.exports = Payment;