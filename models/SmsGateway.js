const mongoose = require('mongoose');

const smsGatewaySchema = new mongoose.Schema({
  deviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true,
    unique: true,          // ✅ This creates the unique index
    // ❌ remove index: true – it's redundant with unique: true
  },
  gatewayId: {
    type: String,
    required: true,
    unique: true,
    index: true,
  },
  secretToken: {
    type: String,
    required: true,
  },
  secretIssuedAt: {
    type: Date,
    default: Date.now,
  },
  secretVersion: {
    type: Number,
    default: 1,
  },
  cooperativeId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Cooperative',
    required: true,
    index: true,
  },
  // ── Device metadata ─────────────────────────────────────
  deviceName: { type: String },
  deviceModel: { type: String },
  manufacturer: { type: String },
  androidVersion: { type: String },
  appVersion: { type: String },
  // ── SIM and connectivity ──────────────────────────────
  simOperator: { type: String },
  simSerial: { type: String },
  signalStrength: { type: Number, min: 0, max: 100 },
  batteryLevel: { type: Number, min: 0, max: 100 },
  isCharging: { type: Boolean },
  batteryTemperature: { type: Number },
  networkType: { type: String },
  publicIp: { type: String },
  tunnelConnected: { type: Boolean, default: false },
  cloudflareTunnelVersion: { type: String },
  lastTunnelReconnect: { type: Date },
  tunnelLatency: { type: Number },
  // ── Performance ─────────────────────────────────────────
  queueLength: { type: Number, default: 0 },
  storageFree: { type: Number },
  ramUsage: { type: Number },
  lastSmsSentAt: { type: Date },
  lastSmsFailedAt: { type: Date },
  appState: { type: String, enum: ['foreground', 'background', 'killed'] },
  // ── Status ──────────────────────────────────────────────
  status: {
    type: String,
    enum: ['pending', 'online', 'degraded', 'needs_update', 'offline', 'revoked'],
    default: 'pending',
    index: true,
  },
  lastHeartbeat: { type: Date, index: true },
  lastPoll: { type: Date },
  // ── Rotation audit ─────────────────────────────────────
  lastRotatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastRotatedIp: { type: String },
  lastRotatedAt: { type: Date },
  plainSecret: {
    type: String,
    default: null
},

// models/SmsGateway.js – add field
availableSimSlots: [{
  slot: Number,
  carrier: String,
  active: Boolean,
}],

simSlots: [{
  slot: Number,
  carrier: String,
  active: Boolean,
}],
 
secretRetrievedAt: {
    type: Date,
    default: null
},
  // ── Registration audit ──────────────────────────────────
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  registrationIp: { type: String },
  registeredAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// ─── Compound indexes ─────────────────────────────────────
smsGatewaySchema.index({ cooperativeId: 1, status: 1 });
// ✅ Only keep this if you need it; but the unique index is already on deviceId

// ─── Guard against OverwriteModelError ───────────────────
const SmsGateway = mongoose.models.SmsGateway || mongoose.model('SmsGateway', smsGatewaySchema);

module.exports = SmsGateway;