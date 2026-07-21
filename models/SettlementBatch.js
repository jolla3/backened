const mongoose = require('mongoose');

const settlementBatchSchema = new mongoose.Schema({
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true,
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
  periodStart: {
    type: Date,
    required: true,
  },
  periodEnd: {
    type: Date,
    required: true,
  },
  status: {
    type: String,
    enum: ['GENERATING', 'GENERATED', 'APPROVED', 'SETTLING', 'SETTLED', 'PAID', 'CLOSED', 'FAILED', 'CANCELLED'],
    default: 'GENERATING',
    index: true,
  },
  totalFarmers: { type: Number, default: 0 },
  totalSkippedFarmers: { type: Number, default: 0 },
  totalGrossMilkLitres: { type: Number, default: 0 },
  totalGrossMilkEarnings: { type: Number, default: 0 },
  totalDeductions: { type: Number, default: 0 },
  totalBonuses: { type: Number, default: 0 },
  totalNetPayable: { type: Number, default: 0 },
  averageMilkRate: { type: Number, default: 0 },
  highestSettlement: { type: Number, default: 0 },
  lowestSettlement: { type: Number, default: 0 },
  generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  generatedAt: Date,
  approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  approvedAt: Date,
  settlingStartedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  settlingStartedAt: Date,
  settledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  settledAt: Date,
  notes: String,
}, { timestamps: true });

settlementBatchSchema.index({ cooperativeId: 1, year: 1, month: 1 }, { unique: true });
settlementBatchSchema.index({ cooperativeId: 1, status: 1 });

module.exports = mongoose.models.SettlementBatch || mongoose.model('SettlementBatch', settlementBatchSchema);