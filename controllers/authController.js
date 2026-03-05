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

const register = async (req, res) => {
  try {
    const { email, password, name, role } = req.body;

    if (!email || !password || !name) {
      return res.status(400).json({ error: 'Email, password, and name required' });
    }

    const result = await authService.register(email, password, name, role);
    
    logger.info('User registered', { 
      userId: result.user.id, 
      role: result.user.role,
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

module.exports = { login, register };