const milkTransactionSchema = Joi.object({
  farmer_code: Joi.string().required(),
  litres: Joi.number().min(0.1).max(1000).required(),
  porter_id: Joi.string().required(),
  zone: Joi.string().required(),
  device_seq_num: Joi.string().required(),
  timestamp_local: Joi.date(),
  // ✅ NO rate_version_id - auto-selected by service
  cooperativeId: Joi.string().required() // Add this if not present
});