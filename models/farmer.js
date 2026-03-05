const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema({
  name: { type: String, required: true, index: true },
  phone: { type: String, required: true, index: true },
  balance: { type: Number, default: 0 },
  history: [{ type: mongoose.Schema.Types.ObjectId, ref: 'Transaction' }],
  branch_id: { type: String, default: 'main' },
  createdAt: { type: Date, default: Date.now }
});

farmerSchema.index({ name: 1, phone: 1 });

module.exports = mongoose.model('Farmer', farmerSchema);