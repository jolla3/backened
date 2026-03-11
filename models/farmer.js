const mongoose = require('mongoose');

const farmerSchema = new mongoose.Schema({
  farmer_code: {
    type: String,
    required: true,
    unique: true,  // ✅ This creates the unique index
    trim: true
  },
  name: {
    type: String,
    required: true,
    trim: true
  },
  phone: {
    type: String,
    required: true,
    trim: true
  },
  branch_id: {
    type: String,
    required: true,
    trim: true
  },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true  // ✅ This creates the index
  },
  balance: {
    type: Number,
    default: 0
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

// ✅ Only add indexes that are NOT already created by field definitions
farmerSchema.index({ cooperativeId: 1, farmer_code: 1 });

module.exports = mongoose.model('Farmer', farmerSchema);