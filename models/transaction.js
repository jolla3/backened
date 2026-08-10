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

  // ─── Legacy timestamps ──────────────────────────────────
  timestamp_local: { type: Date, index: true },
  timestamp_server: { type: Date, default: Date.now, index: true },

  // 🔒 Unique index on idempotency_key
  idempotency_key: {
    type: String,
    unique: true,
    index: true
  },
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
  collectionDate: {
    type: String,
    required: true,
    index: true,
    match: /^\d{4}-\d{2}-\d{2}$/
  },
  collectionShift: {
    type: String,
    enum: ['AM', 'PM'],
    required: true,
    index: true
  },

  // ─── Audit ──────────────────────────────────────────────
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

// ─── Indexes ──────────────────────────────────────────────────

// Per‑farmer history
transactionSchema.index({ farmer_id: 1, collectionDate: -1 });

// Per‑porter collection reports
transactionSchema.index({ porter_id: 1, collectionDate: -1 });

// Cooperative‑wide reports by date and shift
transactionSchema.index({
  cooperativeId: 1,
  collectionDate: 1,
  collectionShift: 1
});

// Auditing
transactionSchema.index({ cooperativeId: 1, createdBy: 1, timestamp_server: -1 });

// 🔒 Business‑rule uniqueness: one milk entry per farmer per date + shift
// (porter_id is removed from the key – adjust if your rule includes porter)
transactionSchema.index(
  {
    cooperativeId: 1,
    farmer_id: 1,
    collectionDate: 1,
    collectionShift: 1,
  },
  {
    unique: true,
    partialFilterExpression: { type: 'milk' }
  }
);

// 🔒 idempotency_key is already marked `unique: true` above.
// If you need to add it manually:
// transactionSchema.index({ idempotency_key: 1 }, { unique: true });

const Transaction = mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;