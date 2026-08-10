const mongoose = require('mongoose');

const transactionSchema = new mongoose.Schema({
  // ─── Device/POS fields ────────────────────────────────────
  device_id: { type: String, index: true },
  device_seq_num: { type: Number, default: 0, index: true },
  qr_hash: { type: String, index: true },
  digital_signature: { type: String },

  // ─── Core transaction data ──────────────────────────────
  receipt_num: { type: String, index: true },
  status: {
    type: String,
    enum: ['completed', 'pending', 'failed'],
    default: 'completed',
    index: true
  },
  server_seq_num: { type: String },

  timestamp_local: { type: Date, index: true },
  timestamp_server: { type: Date, default: Date.now, index: true },

  idempotency_key: { type: String, unique: true, index: true },
  soft_delta: { type: Number, default: 0 },

  // ─── Transaction type ────────────────────────────────────
  type: {
    type: String,
    enum: ['milk', 'feed'],
    index: true
  },

  // ─── Milk fields ─────────────────────────────────────────
  litres: { type: Number, default: 0 },
  payout: { type: Number, default: 0 },

  // ─── Feed fields ─────────────────────────────────────────
  quantity: { type: Number, default: 0 },
  cost: { type: Number, default: 0 },
  product_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Inventory', index: true },
  paymentMethod: {
    type: String,
    enum: ['balance', 'cash'],
    default: 'balance',
    index: true
  },

  // ─── Relationships ──────────────────────────────────────
  farmer_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', index: true },
  porter_id: { type: mongoose.Schema.Types.ObjectId, ref: 'Porter', index: true },
  rate_version_id: { type: mongoose.Schema.Types.ObjectId, ref: 'RateVersion', index: true },
  cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
  branch_id: { type: String, index: true },

  // ─── Zone ──────────────────────────────────────────────
  zoneId: { type: mongoose.Schema.Types.ObjectId, ref: 'Zone', index: true },
  zone: { type: String, trim: true, index: true },

  // ─── Collection information ─────────────────────────────
  collectionShift: {
    type: String,
    enum: ['AM', 'PM'],
    required: true,
    index: true
  },

  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true
  },

  entryMethod: {
    type: String,
    enum: ['manual', 'pos'],
    default: 'manual',
    index: true
  },

  // ─── Timestamps ─────────────────────────────────────────
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now }
}, { timestamps: true });

// ─── Optimized indexes ──────────────────────────────────
// For per‑farmer history
transactionSchema.index({ farmer_id: 1, timestamp_local: -1 });
// For per‑porter collection reports
transactionSchema.index({ porter_id: 1, timestamp_local: -1 });
// For cooperative‑wide reports by date and shift
transactionSchema.index({
  cooperativeId: 1,
  timestamp_local: -1,
  collectionShift: 1
});
// For auditing entries by creator (optional, but useful)
transactionSchema.index({ cooperativeId: 1, createdBy: 1, timestamp_server: -1 });

// The separate index on cooperativeId + timestamp_local is
// covered by the compound index above (prefix), so removed.

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;