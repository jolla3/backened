const express = require('express');
const router = express.Router();
const { login, porterLogin, register, getCooperativeInfo } = require('../controllers/authController');
const { validate } = require('../middlewares/validationMiddleware');
const Joi = require('joi');

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required()
});

const porterLoginSchema = Joi.object({
  phone: Joi.string().required(),
  pin: Joi.string().required()
});

const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
  name: Joi.string().min(2).required(),
  role: Joi.string().valid('admin', 'porter').optional(),
  cooperativeId: Joi.string().required()
});

// Public login endpoint
router.post('/login', validate(loginSchema), login);

// Porter PIN login endpoint
router.post('/porter-login', validate(porterLoginSchema), porterLogin);

// Internal register (with cooperative scoping)
router.post('/register', validate(registerSchema), register);

// Get cooperative info (protected)
router.get('/cooperative', getCooperativeInfo);

module.exports = router;