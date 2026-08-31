const mongoose = require('mongoose');

const settlementSchema = new mongoose.Schema(
  {
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

    // Frozen farmer identity at generation time
    farmerSnapshot: {
      name: { type: String, required: true },
      code: String,
      phone: String,
      zone: String,
    },

    // Period: queries use [periodStart, nextPeriodStart)
    periodStart: { type: Date, required: true },
    periodEnd: { type: Date, required: true }, // display only
    nextPeriodStart: { type: Date, required: true },
    year: { type: Number, required: true },
    month: { type: Number, required: true, min: 1, max: 12 },

    settlementNumber: { type: String, unique: true, required: true },

    // ── Period activity (this month only) ─────────────────
    grossMilkLitres: { type: Number, default: 0 },
    grossMilkEarnings: { type: Number, required: true, default: 0 },
    deductions: [
      {
        type: {
          type: String,
          enum: [
            'FEED',
            'FEED_DEBIT',
            'LOAN',
            'INTEREST',
            'PENALTY',
            'MANUAL_ADJUSTMENT',
            'OTHER',
          ],
        },
        amount: Number,
        description: String,
      },
    ],
    totalDeductions: { type: Number, default: 0 },
    bonuses: { type: Number, default: 0 },
    adjustments: { type: Number, default: 0 },

    // Period-only net (gross + bonuses + adjustments - deductions)
    netPayable: { type: Number, required: true, default: 0 },

    // Carry-in from before periodStart + period net
    openingBalance: { type: Number, default: 0 },
    totalPayable: { type: Number, required: true, default: 0 },

    // After settlement / override: what remains unpaid (if any)
    closingOutstandingBalance: { type: Number, default: 0 },

    // Optional payment tracking (separate from ledger clearance)
    amountPaid: { type: Number, default: 0 },
    paymentStatus: {
      type: String,
      enum: ['UNPAID', 'PARTIALLY_PAID', 'PAID'],
      default: 'UNPAID',
    },

    // ── Generation snapshot ───────────────────────────────
    generationBalance: { type: Number, default: 0 },
    generationLedgerId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ledger',
    },
    generationAt: { type: Date },
    generationMismatch: { type: Boolean, default: false },
    generationDifference: { type: Number, default: 0 },

    // ── Status ────────────────────────────────────────────
    status: {
      type: String,
      enum: ['GENERATED', 'MISMATCH', 'OVERRIDE_REQUESTED', 'SETTLED'],
      default: 'GENERATED',
      index: true,
    },

    overrideRequest: {
      requestedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      requestedAt: Date,
      reason: String,

      expectedBalance: Number,
      actualBalance: Number, // service uses actualBalance (not currentBalance)
      difference: Number,

      postGenerationEntries: [
        {
          ledgerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Ledger' },
          type: String,
          amount: Number,
          timestamp: Date,
          reference: String,
          description: String,
        },
      ],

      status: {
        type: String,
        enum: ['PENDING', 'APPROVED', 'REJECTED'],
      },
      approvedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
      approvedAt: Date,

      resolutionType: {
        type: String,
        enum: ['ACCEPT_ACTUAL', 'KEEP_ORIGINAL', 'MANUAL_AMOUNT'],
      },
      resolutionAmount: Number,
      resolutionNotes: String,
    },

    generatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    settledBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
    settledAt: Date,
    ledgerEntryId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Ledger',
      index: true,
    },
    notes: String,
  },
  { timestamps: true }
);

// One settlement per farmer per accounting period
settlementSchema.index(
  { cooperativeId: 1, farmerId: 1, year: 1, month: 1 },
  { unique: true }
);
settlementSchema.index({ batchId: 1, farmerId: 1 });
settlementSchema.index({ cooperativeId: 1, status: 1, periodStart: -1 });
settlementSchema.index({ cooperativeId: 1, year: 1, month: 1 });
settlementSchema.index({ batchId: 1, status: 1 });

module.exports =
  mongoose.models.Settlement || mongoose.model('Settlement', settlementSchema);