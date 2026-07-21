// controllers/developerController.js
const developerService = require('../services/developerService');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

// ─── Helpers ──────────────────────────────────────────────
const getClientInfo = (req) => ({
  ip: req.ip || req.connection?.remoteAddress || req.headers['x-forwarded-for'] || 'unknown',
  userAgent: req.headers['user-agent'] || 'unknown',
});

// ─── Cooperatives ──────────────────────────────────────────

const createCooperative = async (req, res) => {
  try {
    const { cooperative, admin } = req.body;
    if (!cooperative || !admin) {
      return res.status(400).json({ error: 'Both cooperative and admin data are required' });
    }
    const clientInfo = getClientInfo(req);
    const result = await developerService.createCooperativeWithAdmin(
      cooperative,
      admin,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.status(201).json(result);
  } catch (error) {
    logger.error('Create cooperative failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const getCooperatives = async (req, res) => {
  try {
    const { page, limit, search, isActive, showDeleted } = req.query;
    const result = await developerService.getCooperatives({ page, limit, search, isActive, showDeleted });
    res.json(result);
  } catch (error) {
    logger.error('Get cooperatives failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getCooperative = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Cooperative ID is required' });
    }
    const cooperative = await developerService.getCooperativeById(id);
    res.json(cooperative);
  } catch (error) {
    logger.error('Get cooperative failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
};

const updateCooperative = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Cooperative ID is required' });
    }
    const updates = req.body;
    const clientInfo = getClientInfo(req);
    const cooperative = await developerService.updateCooperative(
      id,
      updates,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(cooperative);
  } catch (error) {
    logger.error('Update cooperative failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const activateCooperative = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Cooperative ID is required' });
    }
    const clientInfo = getClientInfo(req);
    const cooperative = await developerService.activateCooperative(
      id,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(cooperative);
  } catch (error) {
    logger.error('Activate cooperative failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const deactivateCooperative = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'Cooperative ID is required' });
    }
    const clientInfo = getClientInfo(req);
    const cooperative = await developerService.deactivateCooperative(
      id,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(cooperative);
  } catch (error) {
    logger.error('Deactivate cooperative failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── SUPER_ADMINs ──────────────────────────────────────────

const getSuperAdmins = async (req, res) => {
  try {
    const { page, limit, search, isActive } = req.query;
    const result = await developerService.getSuperAdmins({ page, limit, search, isActive });
    res.json(result);
  } catch (error) {
    logger.error('Get SUPER_ADMINs failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

const getSuperAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const user = await developerService.getSuperAdminById(id);
    res.json(user);
  } catch (error) {
    logger.error('Get SUPER_ADMIN failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
};

const updateSuperAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const { name, email } = req.body;
    const clientInfo = getClientInfo(req);
    const updated = await developerService.updateSuperAdmin(
      id,
      { name, email },
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(updated);
  } catch (error) {
    logger.error('Update SUPER_ADMIN failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const resetSuperAdminPassword = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const { password } = req.body;
    if (!password) {
      return res.status(400).json({ error: 'Password is required' });
    }
    const clientInfo = getClientInfo(req);
    const result = await developerService.resetSuperAdminPassword(
      id,
      password,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(result);
  } catch (error) {
    logger.error('Reset SUPER_ADMIN password failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const activateSuperAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const clientInfo = getClientInfo(req);
    const result = await developerService.activateSuperAdmin(
      id,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(result);
  } catch (error) {
    logger.error('Activate SUPER_ADMIN failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

const deactivateSuperAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    if (!id) {
      return res.status(400).json({ error: 'User ID is required' });
    }
    const clientInfo = getClientInfo(req);
    const result = await developerService.deactivateSuperAdmin(
      id,
      req.user.id,
      clientInfo.ip,
      clientInfo.userAgent
    );
    res.json(result);
  } catch (error) {
    logger.error('Deactivate SUPER_ADMIN failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

// ─── Dashboard Stats ───────────────────────────────────────

const getDashboardStats = async (req, res) => {
  try {
    const stats = await developerService.getDashboardStats();
    res.json(stats);
  } catch (error) {
    logger.error('Get dashboard stats failed', { error: error.message });
    res.status(500).json({ error: error.message });
  }
};

// ─── Impersonation ─────────────────────────────────────────

const impersonate = async (req, res) => {
  try {
    const { id } = req.params; // cooperative ID
    if (!id) {
      return res.status(400).json({ error: 'Cooperative ID is required' });
    }
    const clientInfo = getClientInfo(req);

    // Get the SUPER_ADMIN for this cooperative
    const user = await developerService.impersonateSuperAdmin(id);

    // Generate temporary JWT (15 min expiry)
    const token = jwt.sign(
      {
        id: user.id,
        email: user.email,
        role: user.role,
        cooperativeId: user.cooperativeId,
      },
      process.env.JWT_SECRET,
      { expiresIn: '15m' }
    );

    // Audit log
    await developerService.createAuditLog(
      req.user.id,
      'IMPERSONATION',
      {
        cooperativeId: id,
        userId: user.id,
        userName: user.name,
        userEmail: user.email,
      },
      clientInfo.ip,
      clientInfo.userAgent
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        cooperativeId: user.cooperativeId,
      },
      expiresIn: '15m',
      message: 'Impersonation successful – you are now logged in as this SUPER_ADMIN',
    });
  } catch (error) {
    logger.error('Impersonation failed', { error: error.message });
    res.status(404).json({ error: error.message });
  }
};

module.exports = {
  createCooperative,
  getCooperatives,
  getCooperative,
  updateCooperative,
  activateCooperative,
  deactivateCooperative,
  getSuperAdmins,
  getSuperAdmin,
  updateSuperAdmin,
  resetSuperAdminPassword,
  activateSuperAdmin,
  deactivateSuperAdmin,
  getDashboardStats,
  impersonate,
};