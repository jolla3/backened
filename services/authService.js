const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/user');
const logger = require('../utils/logger');

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

const generateJWT = (userId, role) => {
  return jwt.sign(
    { id: userId, role },
    config.JWT_SECRET,
    { expiresIn: '8h' }
  );
};

const verifyJWT = (token) => {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
};

const login = async (email, password) => {
  const user = await User.findOne({ email }).select('+password');
  
  if (!user) {
    throw new Error('Invalid credentials');
  }

  if (!user.isActive) {
    throw new Error('Account is deactivated');
  }

  const isValidPassword = await comparePassword(password, user.password);
  
  if (!isValidPassword) {
    throw new Error('Invalid credentials');
  }

  // Update last login
  user.lastLogin = new Date();
  await user.save();

  const token = generateJWT(user._id, user.role);

  return {
    token,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name
    }
  };
};

const register = async (email, password, name, role = 'porter') => {
  const existingUser = await User.findOne({ email });
  
  if (existingUser) {
    throw new Error('Email already registered');
  }

  const hashedPassword = await hashPassword(password);
  
  const user = await User.create({
    email,
    password: hashedPassword,
    name,
    role
  });

  const token = generateJWT(user._id, user.role);

  return {
    token,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name
    }
  };
};

module.exports = {
  hashPassword,
  comparePassword,
  generateJWT,
  verifyJWT,
  login,
  register
};