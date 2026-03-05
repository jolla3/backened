const mongoose = require('mongoose');

const notificationQueueSchema = new mongoose.Schema({
  phone: { type: String, required: true },
  message: { type: String, required: true },
  status: { type: String, enum: ['pending', 'sent', 'failed'], default: 'pending' },
  attempts: { type: Number, default: 0 },
  created_at: { type: Date, default: Date.now }
});

module.exports = mongoose.model('NotificationQueue', notificationQueueSchema);