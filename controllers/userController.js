const userService = require('../services/userService');
const logger = require('../utils/logger');

// ─── Create ───────────────────────────────────────────────
const createUser = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({ error: 'All fields required' });
    }

    const user = await userService.createUser({ name, email, password, role }, cooperativeId, req.user);
    res.status(201).json(user);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    logger.error('Create user failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Get all (with pagination, search, filters) ──────────
const getUsers = async (req, res) => {
  try {
    const cooperativeId = req.user.cooperativeId;
    const { page, limit, search, role, status } = req.query;
    const result = await userService.getUsers(cooperativeId, { page, limit, search, role, status });
    res.json(result);
  } catch (error) {
    logger.error('Get users failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ─── Get single user ──────────────────────────────────────
const getUser = async (req, res) => {
  try {
    const { id } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const user = await userService.getUserById(id, cooperativeId);
    res.json(user);
  } catch (error) {
    logger.error('Get user failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
};

// ─── Update user ──────────────────────────────────────────
const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const cooperativeId = req.user.cooperativeId;
    const updates = req.body;

    // Prevent role escalation beyond SUPER_ADMIN
    if (updates.role && updates.role === 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot assign SUPER_ADMIN role' });
    }

    // If user is SUPER_ADMIN, prevent demotion (optional)
    const existing = await userService.getUserById(id, cooperativeId);
    if (existing.role === 'SUPER_ADMIN' && req.user.role !== 'SUPER_ADMIN') {
      return res.status(403).json({ error: 'Cannot modify SUPER_ADMIN' });
    }

    const updated = await userService.updateUser(id, updates, cooperativeId, req.user);
    res.json(updated);
  } catch (error) {
    if (error.code === 11000 && error.keyPattern?.email) {
      return res.status(409).json({ error: 'Email already exists' });
    }
    logger.error('Update user failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Deactivate (soft delete) ────────────────────────────
const deactivateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const cooperativeId = req.user.cooperativeId;
    await userService.deactivateUser(id, cooperativeId, req.user);
    res.json({ message: 'User deactivated successfully' });
  } catch (error) {
    logger.error('Deactivate user failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Activate user ────────────────────────────────────────
const activateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const cooperativeId = req.user.cooperativeId;
    await userService.activateUser(id, cooperativeId, req.user);
    res.json({ message: 'User activated successfully' });
  } catch (error) {
    logger.error('Activate user failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Reset password (admin) ──────────────────────────────
const resetPassword = async (req, res) => {
  try {
    const { id } = req.params;
    const { password } = req.body;
    const cooperativeId = req.user.cooperativeId;

    if (!password || password.length < 6) {
      return res.status(400).json({ error: 'Password must be at least 6 characters' });
    }

    await userService.resetPassword(id, password, cooperativeId, req.user);
    res.json({ message: 'Password reset successfully' });
  } catch (error) {
    logger.error('Reset password failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Change own password ──────────────────────────────────
const changeOwnPassword = async (req, res) => {
  try {
    const { oldPassword, newPassword } = req.body;
    const userId = req.user.id;

    if (!oldPassword || !newPassword) {
      return res.status(400).json({ error: 'Old and new password required' });
    }

    await userService.changeOwnPassword(userId, oldPassword, newPassword);
    res.json({ message: 'Password changed successfully' });
  } catch (error) {
    logger.error('Change own password failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Get own profile ──────────────────────────────────────
const getMe = async (req, res) => {
  try {
    const userId = req.user.id;
    const cooperativeId = req.user.cooperativeId;
    const profile = await userService.getMe(userId, cooperativeId);
    res.json(profile);
  } catch (error) {
    logger.error('Get me failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
};

module.exports = {
  createUser,
  getUsers,
  getUser,
  updateUser,
  deactivateUser,
  activateUser,
  resetPassword,
  changeOwnPassword,
  getMe
};