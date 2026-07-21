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
  // ✅ Keep top-level county for simplicity (we'll also keep location.county for compatibility)
  county: {
    type: String,
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
  // ✅ Add website field
  website: {
    type: String,
    trim: true
  },
  adminId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false,
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

const Cooperative = mongoose.models.Cooperative || mongoose.model('Cooperative', cooperativeSchema);
module.exports = Cooperative;