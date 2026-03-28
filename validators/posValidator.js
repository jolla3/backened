const Joi = require('joi');

const milkTransactionSchema = Joi.object({
  farmer_code: Joi.string().required(),
  litres: Joi.number().positive().required(),
  porter_id: Joi.string().optional().allow(null),
  zone: Joi.string().optional(),
  device_seq_num: Joi.number().integer().min(0).required(),
  timestamp_local: Joi.date().iso().optional(),
  cooperativeId: Joi.string().required()   // ✅ Added
});

const farmerCodeSchema = Joi.object({
  farmer_code: Joi.string().required()
});

module.exports = {
  milkTransactionSchema,
  farmerCodeSchema
};