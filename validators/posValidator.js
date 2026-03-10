const Joi = require('joi');

const milkTransactionSchema = Joi.object({
  farmer_code: Joi.string().required().min(3).max(6),
  litres: Joi.number().min(1).max(100).required(),
  porter_id: Joi.string().hex().length(24).required(),
  zone: Joi.string().required(),
  device_seq_num: Joi.number().required(),
  timestamp_local: Joi.date().optional()
});

const farmerCodeSchema = Joi.object({
  farmer_code: Joi.string().required().min(3).max(6)
});

module.exports = {
  milkTransactionSchema,
  farmerCodeSchema
};