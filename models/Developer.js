// models/Developer.js
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const developerSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
  },
  password: {
    type: String,
    required: true,
  },
  name: {
    type: String,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});

developerSchema.methods.comparePassword = async function(candidate) {
  return await bcrypt.compare(candidate, this.password);
};

const Developer = mongoose.models.Developer || mongoose.model('Developer', developerSchema);
module.exports = Developer;