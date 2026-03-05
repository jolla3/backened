const mongoose = require('mongoose');

const porterSchema = new mongoose.Schema({
  name: { type: String, required: true },
  zones: [{ type: String }],
  totals: {
    litresCollected: { type: Number, default: 0 },
    transactionsCount: { type: Number, default: 0 }
  },
  isActive: { type: Boolean, default: true }
});

module.exports = mongoose.model('Porter', porterSchema);