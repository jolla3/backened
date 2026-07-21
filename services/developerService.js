const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const Cooperative = require('../models/Cooperative');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const Farmer = require('../models/Farmer');
const Porter = require('../models/Porter');
const Transaction = require('../models/Transaction');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────

// Whitelist for cooperative updates (now supports dot notation)
const COOP_ALLOWED_UPDATES = [
  'name',
  'registrationNumber',
  'location.county',
  'location.address',
  'contact.phone',
  'contact.email',
  'website',
  'isActive'
];

// Whitelist for user updates
const USER_ALLOWED_UPDATES = ['name', 'email', 'isActive'];

/**
 * Map flat frontend fields to nested MongoDB update paths.
 */
const mapCooperativeUpdate = (data) => {
  const mapped = {};
  if (data.name) mapped.name = data.name;
  if (data.registrationNumber) mapped.registrationNumber = data.registrationNumber;
  if (data.county) mapped['location.county'] = data.county;
  if (data.town) mapped['location.address'] = data.town;
  if (data.phone) mapped['contact.phone'] = data.phone;
  if (data.email) mapped['contact.email'] = data.email;
  if (data.website) mapped.website = data.website;
  if (data.isActive !== undefined) mapped.isActive = data.isActive;
  return mapped;
};

const filterCoopUpdates = (data) => {
  const filtered = {};
  for (const key of COOP_ALLOWED_UPDATES) {
    if (data[key] !== undefined) filtered[key] = data[key];
  }
  return filtered;
};

const filterUserUpdates = (data) => {
  const filtered = {};
  for (const key of USER_ALLOWED_UPDATES) {
    if (data[key] !== undefined) filtered[key] = data[key];
  }
  return filtered;
};

const formatCooperative = (coop) => ({
  id: coop._id,
  name: coop.name,
  registrationNumber: coop.registrationNumber,
  location: coop.location,
  contact: coop.contact,
  website: coop.website,
  isActive: coop.isActive,
  superAdmin: coop.superAdmin || null,
  createdAt: coop.createdAt,
  updatedAt: coop.updatedAt,
});

const formatUser = (user) => ({
  id: user._id,
  name: user.name,
  email: user.email,
  role: user.role,
  isActive: user.isActive,
  cooperativeId: user.cooperativeId,
  lastLogin: user.lastLogin,
  createdAt: user.createdAt,
});

// ─── Audit Log ────────────────────────────────────────────
const createAuditLog = async (developerId, action, metadata, ip = null, userAgent = null) => {
  try {
    if (!developerId) return;
    const log = new AuditLog({
      developerId,
      action,
      metadata: {
        ...metadata,
        ip,
        userAgent,
        timestamp: new Date(),
      },
    });
    await log.save();
  } catch (error) {
    console.error('[AuditLog] Failed to save log:', error.message);
  }
};

// ─── Cooperatives ──────────────────────────────────────────

const createCooperativeWithAdmin = async (coopData, adminData, developerId, ip, userAgent) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const existingUser = await User.findOne({ email: adminData.email.toLowerCase().trim() });
    if (existingUser) throw new Error('Email already registered');

    const cooperative = new Cooperative(coopData);
    await cooperative.save({ session });

    const hashedPassword = await bcrypt.hash(adminData.password, 10);
    const user = new User({
      name: adminData.name,
      email: adminData.email.toLowerCase().trim(),
      password: hashedPassword,
      role: 'SUPER_ADMIN',
      cooperativeId: cooperative._id,
      isActive: true,
    });
    await user.save({ session });

    await session.commitTransaction();
    session.endSession();

    await createAuditLog(developerId, 'COOPERATIVE_CREATED', {
      cooperativeId: cooperative._id,
      cooperativeName: cooperative.name,
      adminId: user._id,
      adminEmail: user.email,
    }, ip, userAgent);

    return {
      cooperative: formatCooperative({ ...cooperative.toObject(), superAdmin: formatUser(user) }),
      superAdmin: formatUser(user),
    };
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const getCooperatives = async (query = {}) => {
  const { page = 1, limit = 10, search = '', isActive, showDeleted = false } = query;
  const safeLimit = Math.min(parseInt(limit) || 10, 100);
  const skip = (parseInt(page) - 1) * safeLimit;

  const filter = {};
  if (!showDeleted) filter.isActive = { $ne: false };
  if (isActive !== undefined && isActive !== '') filter.isActive = isActive === 'true';

  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { registrationNumber: { $regex: search, $options: 'i' } },
      { 'contact.email': { $regex: search, $options: 'i' } },
    ];
  }

  const [cooperatives, total] = await Promise.all([
    Cooperative.find(filter).sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    Cooperative.countDocuments(filter),
  ]);

  const cooperativesWithAdmin = await Promise.all(
    cooperatives.map(async (coop) => {
      const admin = await User.findOne({ cooperativeId: coop._id, role: 'SUPER_ADMIN' }).select('_id name email');
      const coopObj = coop.toObject();
      coopObj.superAdmin = admin ? formatUser(admin) : null;
      return coopObj;
    })
  );

  return {
    cooperatives: cooperativesWithAdmin.map(formatCooperative),
    total,
    page: parseInt(page),
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
};

const getCooperativeById = async (cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) throw new Error('Cooperative not found');
  const admin = await User.findOne({ cooperativeId: cooperative._id, role: 'SUPER_ADMIN' }).select('_id name email');
  const coopObj = cooperative.toObject();
  coopObj.superAdmin = admin ? formatUser(admin) : null;
  return formatCooperative(coopObj);
};

// ─── FIXED updateCooperative ─────────────────────────────
const updateCooperative = async (cooperativeId, updates, developerId, ip, userAgent) => {
  // 1. Map flat fields to nested MongoDB paths
  const mapped = mapCooperativeUpdate(updates);
  
  // 2. Whitelist only allowed fields
  const filtered = filterCoopUpdates(mapped);
  if (Object.keys(filtered).length === 0) {
    throw new Error('No valid fields to update');
  }

  // 3. Perform update
  const cooperative = await Cooperative.findByIdAndUpdate(
    cooperativeId,
    { $set: filtered },
    { new: true, runValidators: true }
  );
  if (!cooperative) throw new Error('Cooperative not found');

  await createAuditLog(developerId, 'COOPERATIVE_UPDATED', {
    cooperativeId,
    cooperativeName: cooperative.name,
    updates: filtered,
  }, ip, userAgent);

  const admin = await User.findOne({ cooperativeId: cooperative._id, role: 'SUPER_ADMIN' }).select('_id name email');
  const coopObj = cooperative.toObject();
  coopObj.superAdmin = admin ? formatUser(admin) : null;
  return formatCooperative(coopObj);
};

const activateCooperative = async (cooperativeId, developerId, ip, userAgent) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cooperative = await Cooperative.findByIdAndUpdate(
      cooperativeId,
      { isActive: true },
      { new: true, session }
    );
    if (!cooperative) throw new Error('Cooperative not found');

    await User.updateMany(
      { cooperativeId: cooperative._id, role: 'SUPER_ADMIN' },
      { isActive: true },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await createAuditLog(developerId, 'COOPERATIVE_ACTIVATED', {
      cooperativeId,
      cooperativeName: cooperative.name,
    }, ip, userAgent);

    const admin = await User.findOne({ cooperativeId: cooperative._id, role: 'SUPER_ADMIN' }).select('_id name email');
    const coopObj = cooperative.toObject();
    coopObj.superAdmin = admin ? formatUser(admin) : null;
    return formatCooperative(coopObj);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

const deactivateCooperative = async (cooperativeId, developerId, ip, userAgent) => {
  const session = await mongoose.startSession();
  session.startTransaction();

  try {
    const cooperative = await Cooperative.findByIdAndUpdate(
      cooperativeId,
      { isActive: false },
      { new: true, session }
    );
    if (!cooperative) throw new Error('Cooperative not found');

    await User.updateMany(
      { cooperativeId: cooperative._id, role: 'SUPER_ADMIN' },
      { isActive: false },
      { session }
    );

    await session.commitTransaction();
    session.endSession();

    await createAuditLog(developerId, 'COOPERATIVE_DEACTIVATED', {
      cooperativeId,
      cooperativeName: cooperative.name,
    }, ip, userAgent);

    const admin = await User.findOne({ cooperativeId: cooperative._id, role: 'SUPER_ADMIN' }).select('_id name email');
    const coopObj = cooperative.toObject();
    coopObj.superAdmin = admin ? formatUser(admin) : null;
    return formatCooperative(coopObj);
  } catch (error) {
    await session.abortTransaction();
    session.endSession();
    throw error;
  }
};

// ─── SUPER_ADMIN ───────────────────────────────────────────
const getSuperAdmins = async (query = {}) => {
  const { page = 1, limit = 10, search = '', isActive } = query;
  const safeLimit = Math.min(parseInt(limit) || 10, 100);
  const skip = (parseInt(page) - 1) * safeLimit;

  const filter = { role: 'SUPER_ADMIN' };
  if (isActive !== undefined && isActive !== '') filter.isActive = isActive === 'true';
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } },
    ];
  }

  const [users, total] = await Promise.all([
    User.find(filter).select('-password -__v').populate('cooperativeId', 'name registrationNumber').sort({ createdAt: -1 }).skip(skip).limit(safeLimit),
    User.countDocuments(filter),
  ]);

  return {
    users: users.map(formatUser),
    total,
    page: parseInt(page),
    limit: safeLimit,
    totalPages: Math.ceil(total / safeLimit),
  };
};

const getSuperAdminById = async (userId) => {
  const user = await User.findOne({ _id: userId, role: 'SUPER_ADMIN' })
    .select('-password -__v')
    .populate('cooperativeId', 'name registrationNumber');
  if (!user) throw new Error('SUPER_ADMIN not found');
  return formatUser(user);
};

const updateSuperAdmin = async (userId, updates, developerId, ip, userAgent) => {
  const filtered = filterUserUpdates(updates);
  if (Object.keys(filtered).length === 0) throw new Error('No valid fields to update');

  const user = await User.findOne({ _id: userId, role: 'SUPER_ADMIN' });
  if (!user) throw new Error('SUPER_ADMIN not found');

  if (updates.email && updates.email !== user.email) {
    const existing = await User.findOne({ email: updates.email.toLowerCase().trim() });
    if (existing) throw new Error('Email already in use');
  }

  if (updates.name) user.name = updates.name;
  if (updates.email) user.email = updates.email.toLowerCase().trim();
  if (updates.isActive !== undefined) user.isActive = updates.isActive;

  await user.save();

  await createAuditLog(developerId, 'SUPER_ADMIN_UPDATED', {
    userId: user._id,
    userName: user.name,
    userEmail: user.email,
    updates: filtered,
  }, ip, userAgent);

  const updated = await User.findById(userId).select('-password -__v');
  return formatUser(updated);
};

const resetSuperAdminPassword = async (userId, newPassword, developerId, ip, userAgent) => {
  const user = await User.findOne({ _id: userId, role: 'SUPER_ADMIN' });
  if (!user) throw new Error('SUPER_ADMIN not found');
  if (newPassword.length < 6) throw new Error('Password must be at least 6 characters');
  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();
  await createAuditLog(developerId, 'SUPER_ADMIN_PASSWORD_RESET', {
    userId: user._id,
    userName: user.name,
  }, ip, userAgent);
  return { message: 'Password reset successfully' };
};

const activateSuperAdmin = async (userId, developerId, ip, userAgent) => {
  const user = await User.findOne({ _id: userId, role: 'SUPER_ADMIN' });
  if (!user) throw new Error('SUPER_ADMIN not found');
  user.isActive = true;
  await user.save();
  await createAuditLog(developerId, 'SUPER_ADMIN_ACTIVATED', { userId: user._id, userName: user.name }, ip, userAgent);
  return formatUser(user);
};

const deactivateSuperAdmin = async (userId, developerId, ip, userAgent) => {
  const user = await User.findOne({ _id: userId, role: 'SUPER_ADMIN' });
  if (!user) throw new Error('SUPER_ADMIN not found');
  user.isActive = false;
  await user.save();
  await createAuditLog(developerId, 'SUPER_ADMIN_DEACTIVATED', { userId: user._id, userName: user.name }, ip, userAgent);
  return formatUser(user);
};

// ─── Dashboard Stats ───────────────────────────────────────
const getDashboardStats = async () => {
  const [
    totalCooperatives,
    activeCooperatives,
    inactiveCooperatives,
    totalSuperAdmins,
    totalAdmins,
    totalManagers,
    totalAccountants,
    totalFarmers,
    totalPorters,
    totalTransactions,
  ] = await Promise.all([
    Cooperative.countDocuments(),
    Cooperative.countDocuments({ isActive: true }),
    Cooperative.countDocuments({ isActive: false }),
    User.countDocuments({ role: 'SUPER_ADMIN' }),
    User.countDocuments({ role: 'ADMIN' }),
    User.countDocuments({ role: 'MANAGER' }),
    User.countDocuments({ role: 'ACCOUNTANT' }),
    Farmer?.countDocuments() || 0,
    Porter?.countDocuments() || 0,
    Transaction?.countDocuments() || 0,
  ]);

  return {
    cooperatives: {
      total: totalCooperatives,
      active: activeCooperatives,
      inactive: inactiveCooperatives,
    },
    users: {
      superAdmins: totalSuperAdmins,
      admins: totalAdmins,
      managers: totalManagers,
      accountants: totalAccountants,
    },
    farmers: { total: totalFarmers },
    porters: { total: totalPorters },
    transactions: { total: totalTransactions },
  };
};

// ─── Impersonate ──────────────────────────────────────────
const impersonateSuperAdmin = async (cooperativeId) => {
  const user = await User.findOne({ cooperativeId, role: 'SUPER_ADMIN', isActive: true });
  if (!user) throw new Error('SUPER_ADMIN not found or inactive for this cooperative');
  return {
    id: user._id,
    email: user.email,
    role: user.role,
    cooperativeId: user.cooperativeId,
    name: user.name,
  };
};

module.exports = {
  createCooperativeWithAdmin,
  getCooperatives,
  getCooperativeById,
  updateCooperative,
  activateCooperative,
  deactivateCooperative,
  getSuperAdmins,
  getSuperAdminById,
  updateSuperAdmin,
  resetSuperAdminPassword,
  activateSuperAdmin,
  deactivateSuperAdmin,
  getDashboardStats,
  impersonateSuperAdmin,
  createAuditLog,
};