const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,        // ✅ This creates the index automatically
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'ACCOUNTANT'],
    default: 'ADMIN'
  },
  name: {
    type: String,
    required: true,
    trim: true  
  },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    default: null
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  }
});

userSchema.methods.comparePassword = async function(candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

// ─── Indexes ─────────────────────────────────────────────────
// ❌ Remove this line – duplicate index:
// userSchema.index({ email: 1 }, { unique: true });

// ✅ Keep only these additional indexes (compound and query-optimising)
userSchema.index({ role: 1, cooperativeId: 1 });
userSchema.index({ cooperativeId: 1, isActive: 1 });

// Guard against OverwriteModelError
const User = mongoose.models.User || mongoose.model('User', userSchema);
module.exports = User;