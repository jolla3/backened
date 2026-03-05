const Joi = require('joi');

const validateLitres = (litres) => {
  return Joi.number().min(0).required();
};

const validatePhone = (phone) => {
  return Joi.string().pattern(/^\+?[1-9]\d{1,14}$/).required();
};

module.exports = { validateLitres, validatePhone };