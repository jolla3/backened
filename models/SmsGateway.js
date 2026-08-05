const mongoose = require('mongoose');

const smsGatewaySchema = new mongoose.Schema({
  deviceId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Device',
    required: true,
    unique: true,
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

  // ─── Provisioning & Secret ──────────────────────────────
  plainSecret: { type: String, default: null },
  secretRetrievedAt: { type: Date, default: null },

  // ─── Provisioning state (ADDED) ────────────────────────
  provisionState: {
    type: String,
    enum: ['pending', 'secret_issued', 'confirmed', 'revoked'],
    default: 'pending',
  },

  // ─── Staged rotation fields (ADDED) ────────────────────
  stagedSecretToken: { type: String },
  stagedPlainSecret: { type: String },
  stagedSecretIssuedAt: { type: Date },
  stagedSecretVersion: { type: Number },

  // ─── Rotation audit ─────────────────────────────────────
  lastRotatedBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  lastRotatedIp: { type: String },
  lastRotatedAt: { type: Date },

  // ─── SIM slots ──────────────────────────────────────────
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

  // ─── Registration audit ──────────────────────────────────
  registeredBy: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  registrationIp: { type: String },
  registeredAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
}, { timestamps: true });

// ─── Compound indexes ─────────────────────────────────────
smsGatewaySchema.index({ cooperativeId: 1, status: 1 });

// ─── Guard against OverwriteModelError ───────────────────
const SmsGateway = mongoose.models.SmsGateway || mongoose.model('SmsGateway', smsGatewaySchema);

module.exports = SmsGateway;