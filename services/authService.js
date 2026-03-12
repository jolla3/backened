const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const config = require('../config');
const User = require('../models/user');
const Porter = require('../models/porter');
const Cooperative = require('../models/cooperative');
const logger = require('../utils/logger');

const hashPassword = async (password) => {
  const salt = await bcrypt.genSalt(12);
  return await bcrypt.hash(password, salt);
};

const comparePassword = async (password, hashedPassword) => {
  return await bcrypt.compare(password, hashedPassword);
};

const generateJWT = (userId, role, email, cooperativeId, adminId = null) => {
  const payload = {
    id: userId,
    role,
    email,
    cooperativeId,
    adminId: role === 'admin' ? adminId : null
  };

  return jwt.sign(payload, config.JWT_SECRET, { expiresIn: '8h' });
};

const verifyJWT = (token) => {
  try {
    return jwt.verify(token, config.JWT_SECRET);
  } catch (error) {
    throw new Error('Invalid token');
  }
};

// Email/Password Login (Handle existing users without cooperativeId)
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

  user.lastLogin = new Date();
  await user.save();

  // Handle existing users without cooperativeId
  let cooperativeId = user.cooperativeId;
  if (!cooperativeId) {
    const defaultCoop = await Cooperative.findOne();
    if (defaultCoop) {
      cooperativeId = defaultCoop._id;
      user.cooperativeId = cooperativeId;
      await user.save();
      logger.info('User assigned default cooperative', { userId: user._id, cooperativeId });
    } else {
      throw new Error('No cooperative found in system');
    }
  }

  const token = generateJWT(user._id, user.role, user.email, cooperativeId, user._id);

  return {
    token,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      cooperativeId: cooperativeId,
      adminId: user._id
    }
  };
};

// Porter PIN Login
const porterLogin = async (phone, pin) => {
  const porter = await Porter.findOne({ phone, pin }).select('+pin');
  
  if (!porter) {
    throw new Error('Invalid credentials');
  }

  if (!porter.isActive) {
    throw new Error('Porter account is deactivated');
  }

  if (!porter.cooperativeId) {
    throw new Error('Porter not assigned to any cooperative');
  }

  const cooperative = await Cooperative.findById(porter.cooperativeId);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  if (!cooperative.isActive) {
    throw new Error('Cooperative is deactivated');
  }

  const token = generateJWT(porter._id, 'porter', porter.phone, porter.cooperativeId);

  return {
    token,
    user: {
      id: porter._id,
      phone: porter.phone,
      role: 'porter',
      name: porter.name,
      cooperativeId: porter.cooperativeId
    }
  };
};

// Register User with Cooperative Scoping
const register = async (email, password, name, role, cooperativeId) => {
  const cooperative = await Cooperative.findById(cooperativeId);
  if (!cooperative) {
    throw new Error('Cooperative not found');
  }

  if (!cooperative.isActive) {
    throw new Error('Cooperative is deactivated');
  }

  const existingUser = await User.findOne({ email });
  
  if (existingUser) {
    throw new Error('Email already registered');
  }

  const hashedPassword = await hashPassword(password);
  
  const user = await User.create({
    email,
    password: hashedPassword,
    name,
    role,
    cooperativeId
  });

  const token = generateJWT(user._id, user.role, user.email, user.cooperativeId, user._id);

  return {
    token,
    user: {
      id: user._id,
      email: user.email,
      role: user.role,
      name: user.name,
      cooperativeId: user.cooperativeId,
      adminId: user._id
    }
  };
};

// Get Cooperative by Admin ID
const getCooperativeByAdmin = async (adminId) => {
  const cooperative = await Cooperative.findOne({ adminId }).lean();
  
  if (!cooperative) {
    throw new Error('Cooperative not found for this admin');
  }

  return cooperative;
};

module.exports = {
  hashPassword,
  comparePassword,
  generateJWT,
  verifyJWT,
  login,
  porterLogin,
  register,
  getCooperativeByAdmin
};