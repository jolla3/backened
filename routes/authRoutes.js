const express = require('express');
const router = express.Router();
const { login, register } = require('../controllers/authController');
const { validate } = require('../middlewares/validationMiddleware');
const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required()
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  name: Joi.string().min(2).required(),
  role: Joi.string().valid('admin', 'porter').optional()
});

// Public login endpoint
router.post('/login', validate(loginSchema), login);

// Internal register (for seed script only)
router.post('/register', validate(registerSchema), register);

module.exports = router;