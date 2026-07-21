const User = require('../models/User');
const bcrypt = require('bcryptjs');
const mongoose = require('mongoose');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────
const validateEmail = (email) => {
  const re = /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/;
  return re.test(email);
};

// ─── CRUD ──────────────────────────────────────────────────
const createUser = async (data, cooperativeId, createdBy) => {
  const { name, email, password, role } = data;

  // Validate role – only allowed roles
  const allowedRoles = ['ADMIN', 'MANAGER', 'ACCOUNTANT'];
  if (!allowedRoles.includes(role)) {
    throw new Error('Invalid role. Allowed: ADMIN, MANAGER, ACCOUNTANT');
  }

  // Email validation
  if (!validateEmail(email)) {
    throw new Error('Invalid email format');
  }

  // Hash password
  const hashedPassword = await bcrypt.hash(password, 10);

  const user = new User({
    name,
    email: email.toLowerCase().trim(),
    password: hashedPassword,
    role,
    cooperativeId,
  });

  await user.save();

  // Audit log
  logger.info('User created', {
    userId: user._id,
    cooperativeId,
    role,
    createdBy: createdBy?.id || 'system'
  });

  // Return clean user without password
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt
  };
};

const getUsers = async (cooperativeId, query = {}) => {
  const { page = 1, limit = 10, search = '', role, status } = query;
  const skip = (page - 1) * limit;

  // Build filter
  const filter = { cooperativeId };
  if (search) {
    filter.$or = [
      { name: { $regex: search, $options: 'i' } },
      { email: { $regex: search, $options: 'i' } }
    ];
  }
  if (role) filter.role = role;
  if (status === 'active') filter.isActive = true;
  else if (status === 'inactive') filter.isActive = false;

  const [users, total] = await Promise.all([
    User.find(filter)
      .select('-password -__v')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    User.countDocuments(filter)
  ]);

  return {
    users: users.map(u => ({
      id: u._id,
      name: u.name,
      email: u.email,
      role: u.role,
      isActive: u.isActive,
      lastLogin: u.lastLogin,
      createdAt: u.createdAt
    })),
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    totalPages: Math.ceil(total / limit)
  };
};

const getUserById = async (userId, cooperativeId) => {
  const user = await User.findOne({ _id: userId, cooperativeId })
    .select('-password -__v');
  if (!user) {
    throw new Error('User not found or does not belong to your cooperative');
  }
  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt
  };
};

const updateUser = async (userId, updates, cooperativeId, requestingUser) => {
  const { name, email, role, isActive } = updates;

  // Find user and ensure it belongs
  const user = await User.findOne({ _id: userId, cooperativeId });
  if (!user) {
    throw new Error('User not found or does not belong to your cooperative');
  }

  // Prevent self-update? Actually allow, but prevent self-deactivation (handled elsewhere)
  // Role hierarchy check: only SUPER_ADMIN can promote to ADMIN
  if (role && role !== user.role) {
    if (role === 'SUPER_ADMIN') {
      throw new Error('Cannot assign SUPER_ADMIN role');
    }
    // If requesting user is not SUPER_ADMIN, they cannot change roles at all
    if (requestingUser?.role !== 'SUPER_ADMIN') {
      throw new Error('Only SUPER_ADMIN can change roles');
    }
    // Additional: if user is SUPER_ADMIN, cannot be demoted (we'll prevent in controller)
  }

  // Email validation
  if (email && !validateEmail(email)) {
    throw new Error('Invalid email format');
  }

  const updateFields = {};
  if (name !== undefined) updateFields.name = name;
  if (email !== undefined) updateFields.email = email.toLowerCase().trim();
  if (role !== undefined) updateFields.role = role;
  if (isActive !== undefined) updateFields.isActive = isActive;

  // If deactivating self, block (controller will handle)
  const updated = await User.findByIdAndUpdate(
    userId,
    { $set: updateFields },
    { new: true, runValidators: true }
  ).select('-password -__v');

  logger.info('User updated', {
    userId,
    cooperativeId,
    updatedBy: requestingUser?.id || 'system'
  });

  return {
    id: updated._id,
    name: updated.name,
    email: updated.email,
    role: updated.role,
    isActive: updated.isActive,
    lastLogin: updated.lastLogin,
    createdAt: updated.createdAt
  };
};

// ─── Soft Delete (deactivate) ────────────────────────────
const deactivateUser = async (userId, cooperativeId, requestingUser) => {
  const user = await User.findOne({ _id: userId, cooperativeId });
  if (!user) {
    throw new Error('User not found or does not belong to your cooperative');
  }

  // Prevent self-deactivation
  if (requestingUser && requestingUser.id === userId) {
    throw new Error('You cannot deactivate yourself');
  }

  // Prevent deactivating SUPER_ADMIN (unless it's self, already blocked)
  if (user.role === 'SUPER_ADMIN') {
    throw new Error('Cannot deactivate SUPER_ADMIN');
  }

  // Soft delete: set isActive=false, optionally deletedAt
  user.isActive = false;
  user.deletedAt = new Date(); // add field to schema if needed
  await user.save();

  logger.info('User deactivated', {
    userId,
    cooperativeId,
    deactivatedBy: requestingUser?.id || 'system'
  });

  return { message: 'User deactivated successfully' };
};

const activateUser = async (userId, cooperativeId, requestingUser) => {
  const user = await User.findOne({ _id: userId, cooperativeId });
  if (!user) {
    throw new Error('User not found or does not belong to your cooperative');
  }

  user.isActive = true;
  user.deletedAt = null;
  await user.save();

  logger.info('User activated', {
    userId,
    cooperativeId,
    activatedBy: requestingUser?.id || 'system'
  });

  return { message: 'User activated successfully' };
};

// ─── Reset password ──────────────────────────────────────
const resetPassword = async (userId, newPassword, cooperativeId, requestingUser) => {
  const user = await User.findOne({ _id: userId, cooperativeId });
  if (!user) {
    throw new Error('User not found or does not belong to your cooperative');
  }

  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  logger.info('Password reset', {
    userId,
    cooperativeId,
    resetBy: requestingUser?.id || 'system'
  });

  return { message: 'Password reset successfully' };
};

// ─── Change own password ──────────────────────────────
const changeOwnPassword = async (userId, oldPassword, newPassword) => {
  const user = await User.findById(userId);
  if (!user) {
    throw new Error('User not found');
  }

  const isMatch = await bcrypt.compare(oldPassword, user.password);
  if (!isMatch) {
    throw new Error('Current password is incorrect');
  }

  if (newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters');
  }

  user.password = await bcrypt.hash(newPassword, 10);
  await user.save();

  logger.info('Password changed', { userId });

  return { message: 'Password changed successfully' };
};

// ─── Get own profile ──────────────────────────────────────
const getMe = async (userId, cooperativeId) => {
  const user = await User.findOne({ _id: userId, cooperativeId })
    .select('-password -__v')
    .populate('cooperativeId', 'name'); // if you have cooperative model

  if (!user) {
    throw new Error('User not found');
  }

  const coop = user.cooperativeId;
  const cooperative = coop ? { id: coop._id, name: coop.name } : null;

  return {
    id: user._id,
    name: user.name,
    email: user.email,
    role: user.role,
    isActive: user.isActive,
    lastLogin: user.lastLogin,
    createdAt: user.createdAt,
    cooperative
  };
};

module.exports = {
  createUser,
  getUsers,
  getUserById,
  updateUser,
  deactivateUser,
  activateUser,
  resetPassword,
  changeOwnPassword,
  getMe
};