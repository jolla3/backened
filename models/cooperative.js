const mongoose = require('mongoose');

const cooperativeSchema = new mongoose.Schema({
  name: {
    type: String,
    required: true,
    trim: true
  },
  registrationNumber: {
    type: String,
    unique: true,
    trim: true
  },
  location: {
    county: {
      type: String,
      trim: true
    },
    address: {
      type: String,
      trim: true
    }
  },
  contact: {
    phone: {
      type: String,
      trim: true
    },
    email: {
      type: String,
      lowercase: true,
      trim: true
    },
    manager: {
      type: String,
      trim: true
    }
  },
  // FIX: Made adminId optional for initial setup
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false, // Changed from true to false
    default: null
  },
  senderName: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  updatedAt: {
    type: Date,
    default: Date.now
  }
}, {
  timestamps: true
});

cooperativeSchema.index({ name: 1 });

module.exports = mongoose.model('Cooperative', cooperativeSchema);