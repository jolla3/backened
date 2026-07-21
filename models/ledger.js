const mongoose = require('mongoose');

const ledgerSchema = new mongoose.Schema({
    cooperativeId: { type: mongoose.Schema.Types.ObjectId, ref: 'Cooperative', required: true, index: true },
    farmerId: { type: mongoose.Schema.Types.ObjectId, ref: 'Farmer', required: true, index: true },
    transactionId: { type: mongoose.Schema.Types.ObjectId, ref: 'Transaction', index: true },
    settlementId: { type: mongoose.Schema.Types.ObjectId, ref: 'Settlement', index: true },
    type: {
        type: String,
        enum: [
            'MILK_CREDIT',
            'FEED_DEBIT',
            'FEED_CASH_SALE',
            'PAYMENT',              // ✅ NEW: when settlement is actually paid
            'MANUAL_ADJUSTMENT',
            'BONUS',
            'PENALTY',
            'LOAN',
            'INTEREST',
            'REVERSAL',
        ],
        required: true,
        index: true,
    },
    amount: {
        type: Number,
        required: true,
    },
    runningBalance: {
        type: Number,
        required: true,
    },
    description: { type: String },
    reference: { type: String },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
    metadata: { type: mongoose.Schema.Types.Mixed },
    timestamp: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

ledgerSchema.index({ cooperativeId: 1, farmerId: 1, timestamp: -1 });

const Ledger = mongoose.models.Ledger || mongoose.model('Ledger', ledgerSchema);
module.exports = Ledger;