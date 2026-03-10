const mongoose = require('mongoose');

const taskSchema = new mongoose.Schema({
  title: { type: String, required: true },
  description: { type: String, required: true },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedToType: { type: String, enum: ['admin', 'porter', 'farmer'], required: true },
  priority: { type: String, enum: ['low', 'medium', 'high', 'critical'], default: 'medium' },
  status: { type: String, enum: ['pending', 'in_progress', 'completed', 'escalated'], default: 'pending' },
  category: { type: String, enum: ['device', 'farmer', 'porter', 'financial', 'inventory'], required: true },
  dueDate: { type: Date },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  escalated: { type: Boolean, default: false },
  escalationCount: { type: Number, default: 0 }
});

module.exports = mongoose.model('Task', taskSchema);