const authService = require('../services/authService');
const logger = require('../utils/logger');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ error: 'Email and password required' });
    }

    const result = await authService.login(email, password);
    
    logger.info('Login successful', { 
      userId: result.user.id, 
      role: result.user.role,
      cooperativeId: result.user.cooperativeId,
      correlationId: req.correlationId 
    });

    res.json(result);
  } catch (error) {
    logger.error('Login failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(401).json({ error: error.message });
  }
};

// Porter PIN Login (With Cooperative Scoping)
const porterLogin = async (req, res) => {
  try {
    const { phone, pin } = req.body;

    if (!phone || !pin) {
      return res.status(400).json({ error: 'Phone and PIN required' });
    }

    const result = await authService.porterLogin(phone, pin);
    
    logger.info('Porter login successful', { 
      porterId: result.user.id, 
      cooperativeId: result.user.cooperativeId,
      correlationId: req.correlationId 
    });

    res.json(result);
  } catch (error) {
    logger.error('Porter login failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(401).json({ error: error.message });
  }
};

// Register User with Cooperative Scoping
const register = async (req, res) => {
  try {
    const { email, password, name, role, cooperativeId } = req.body;

    if (!email || !password || !name || !cooperativeId) {
      return res.status(400).json({ error: 'Email, password, name, and cooperativeId required' });
    }

    const result = await authService.register(email, password, name, role, cooperativeId);
    
    logger.info('User registered', { 
      userId: result.user.id, 
      role: result.user.role,
      cooperativeId: result.user.cooperativeId,
      correlationId: req.correlationId 
    });

    res.status(201).json(result);
  } catch (error) {
    logger.error('Registration failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(400).json({ error: error.message });
  }
};

// Get Cooperative Info (For Admin)
const getCooperativeInfo = async (req, res) => {
  try {
    const adminId = req.user.id;
    const cooperative = await authService.getCooperativeByAdmin(adminId);
    
    res.json({ success: true, cooperative });
  } catch (error) {
    logger.error('Get cooperative info failed', { 
      error: error.message,
      correlationId: req.correlationId 
    });
    
    res.status(404).json({ error: error.message });
  }
};

module.exports = { 
  login, 
  porterLogin, 
  register,
  getCooperativeInfo
};