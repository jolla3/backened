const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema({
  farmer_code: {
    type: String,
    unique: true,
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    trim: true
  },
  branch_id: {
    type: String,
    trim: true
  },
  location: {
    type: String,
    trim: true
  },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  currentBalance: {
    type: Number,
    default: 0
  },
  lastLedgerId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Ledger'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  zoneId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Zone',
    index: true,
  },
  zoneName: { type: String, trim: true }
});

farmerSchema.index({ cooperativeId: 1, currentBalance: 1 });
farmerSchema.index({ cooperativeId: 1, farmer_code: 1 });

// ✅ Guard against OverwriteModelError
const Farmer = mongoose.models.Farmer || mongoose.model('Farmer', farmerSchema);

module.exports = Farmer;