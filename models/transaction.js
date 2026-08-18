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
    index: true,
  },
  server_seq_num: { type: String },

  timestamp_local: { type: Date, index: true },
  timestamp_server: { type: Date, default: Date.now, index: true },

  idempotency_key: {
    type: String,
    unique: true,
    index: true,
  },
  soft_delta: { type: Number, default: 0 },

  type: {
    type: String,
    enum: ['milk', 'feed'],
    index: true,
  },

  // ─── Milk fields ─────────────────────────────────────────
  litres: { type: Number, default: 0 },
  payout: { type: Number, default: 0 },

  // ─── Feed fields ─────────────────────────────────────────
  quantity: { type: Number, default: 0 },
  cost: { type: Number, default: 0 },
  product_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Inventory',
    index: true,
  },
  category: { type: String, trim: true },
  paymentMethod: {
    type: String,
    enum: ['balance', 'cash'],
    default: 'balance',
    index: true,
  },
  balanceAdjusted: { type: Boolean, default: false },

  // Groups multi-product feed purchases
  purchaseId: {
    type: mongoose.Schema.Types.ObjectId,
    index: true,
  },

  // Historical wallet snapshot at time of transaction (receipt integrity)
  wallet_balance_before: { type: Number },
  wallet_balance_after: { type: Number },

  // ─── Relationships ──────────────────────────────────────
  farmer_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Farmer',
    index: true,
  },
  porter_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Porter',
    index: true,
  },
  rate_version_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'RateVersion',
    index: true,
  },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true,
  },
  branch_id: { type: String, index: true },
  admin_id: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    index: true,
  },

  // ─── Zone ──────────────────────────────────────────────
  zoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    index: true,
  },
  zone: { type: String, trim: true, index: true },

  // ─── Collection information ─────────────────────────────
  collectionDate: {
    type: String,
    required: true,
    index: true,
    match: /^\d{4}-\d{2}-\d{2}$/,
  },
  collectionShift: {
    type: String,
    enum: ['AM', 'PM'],
    required: true,
    index: true,
  },

  // ─── Audit ──────────────────────────────────────────────
  createdBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  },

  entryMethod: {
    type: String,
    enum: ['manual', 'pos'],
    default: 'manual',
    index: true,
  },

  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// ─── Indexes ──────────────────────────────────────────────────

transactionSchema.index({ farmer_id: 1, collectionDate: -1 });
transactionSchema.index({ porter_id: 1, collectionDate: -1 });
transactionSchema.index({
  cooperativeId: 1,
  collectionDate: 1,
  collectionShift: 1,
});
transactionSchema.index({ cooperativeId: 1, createdBy: 1, timestamp_server: -1 });
transactionSchema.index({ cooperativeId: 1, purchaseId: 1 });

// One milk entry per farmer per date + shift
transactionSchema.index(
  {
    cooperativeId: 1,
    farmer_id: 1,
    collectionDate: 1,
    collectionShift: 1,
  },
  {
    unique: true,
    partialFilterExpression: { type: 'milk' },
  }
);

const Transaction =
  mongoose.models.Transaction || mongoose.model('Transaction', transactionSchema);
module.exports = Transaction;