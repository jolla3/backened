// controllers/developerAuthController.js
const Developer = require('../models/Developer');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');

const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    const developer = await Developer.findOne({ email: email.toLowerCase().trim() });
    if (!developer || !developer.isActive) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isMatch = await developer.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      {
        id: developer._id,
        email: developer.email,
        name: developer.name,
        role: 'DEVELOPER',
      },
      process.env.JWT_SECRET,
      { expiresIn: '24h' }
    );

    res.json({
      token,
      developer: {
        id: developer._id,
        name: developer.name,
        email: developer.email,
      },
    });
  } catch (error) {
    logger.error('Developer login failed', { error: error.message });
    res.status(400).json({ error: error.message });
  }
};

module.exports = { login };
