const Joi = require('joi');

const settingsSchema = Joi.object({
  businessName: Joi.string().min(2).max(80).required(),
  businessType: Joi.string()
    .valid('restaurant', 'cafe', 'bar', 'hotel', 'other')
    .default('restaurant'),
  // Cómo trabaja el negocio (decide sus roles y pantallas). Sin valor se conserva el que ya tenía.
  serviceFocus: Joi.string().valid('takeaway', 'waiters', 'full').optional(),
  address: Joi.string().allow('').max(200).optional(),
  phone: Joi.string().allow('').max(30).optional(),
  logoUrl: Joi.string().allow('').max(8_000_000).optional(),
  primaryColor: Joi.string()
    .pattern(/^#([0-9A-Fa-f]{6})$/)
    .default('#D0371F'),
  accentColor: Joi.string()
    .pattern(/^#([0-9A-Fa-f]{6})$/)
    .default('#E8A020'),
  timezone: Joi.string().default('America/Mexico_City'),
  initialTables: Joi.number().integer().min(0).max(100).default(0),
  setupCompleted: Joi.boolean().default(true),
  updatedAt: Joi.date().optional(),
  createdAt: Joi.date().optional(),
});

module.exports = settingsSchema;
