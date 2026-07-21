const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema({
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true,
  },
  batchId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'SettlementBatch',
    required: true,
    index: true,
  },
  farmerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Farmer',
    required: true,
    index: true,
  },
  // ─── Farmer Snapshot (frozen) ──────────────────────────
  farmerSnapshot: {
    name: { type: String, required: true },
    code: String,
    phone: String,
    zone: String,
  },
  // ─── Period ──────────────────────────────────────────────
  periodStart: {
    type: Date,
    required: true,
  },
  periodEnd: {
    type: Date,
    required: true,
  },
  year: {
    type: Number,
    required: true,
  },
  month: {
    type: Number,
    required: true,
    min: 1,
    max: 12,
  },
  // ─── Settlement Number ──────────────────────────────────
  settlementNumber: {
    type: String,
    unique: true,
    required: true,
  },
  // ─── Snapshot Data ──────────────────────────────────────
  grossMilkLitres: {
    type: Number,
    default: 0,
  },
  grossMilkEarnings: {
    type: Number,
    required: true,
    default: 0,
  },
  deductions: [{
    type: { type: String, enum: ['FEED', 'LOAN', 'PENALTY', 'INSURANCE', 'VETERINARY', 'SAVINGS', 'OTHER'] },
    amount: Number,
    description: String,
  }],
  totalDeductions: {
    type: Number,
    default: 0,
  },
  bonuses: {
    type: Number,
    default: 0,
  },
  netPayable: {
    type: Number,
    required: true,
    default: 0,
  },
  // ─── Status (mirrors batch but can be overridden) ──────
  status: {
    type: String,
    enum: ['GENERATED', 'SETTLED'],
    default: 'GENERATED',
    index: true,
  },
  // ─── Audit ──────────────────────────────────────────────
  generatedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  settledBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
  },
  settledAt: Date,  
  ledgerEntryId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger',
    index: true,
  },
  notes: String,
}, { timestamps: true });

// ─── Indexes ──────────────────────────────────────────────
settlementSchema.index(
  { cooperativeId: 1, farmerId: 1, periodStart: 1, periodEnd: 1 },
  { unique: true }
);
settlementSchema.index({ batchId: 1, farmerId: 1 });
settlementSchema.index({ cooperativeId: 1, status: 1, periodStart: -1 });
settlementSchema.index({ cooperativeId: 1, year: 1, month: 1 });

const Settlement = mongoose.models.Settlement || mongoose.model('Settlement', settlementSchema);
module.exports = Settlement;