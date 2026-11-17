const settingsSchema = require('../models/settings.model');
const db = require('../database/mongodb');
const { limitsFor, teamFitError } = require('../models/venueMode');
const { rateOf } = require('../utils/tax');

async function GetSettings(req, res) {
  try {
    const settings = await db.GetSettings(req.tenantId);
    if (!settings) {
      return res.status(404).send({ setupCompleted: false });
    }
    return res.status(200).send(settings);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Error al obtener la configuración');
  }
}

async function SaveSettings(req, res) {
  try {
    const { error, value } = settingsSchema.validate(req.body, {
      abortEarly: false,
      stripUnknown: true,
    });
    if (error) {
      return res.status(400).send(error.details.map((d) => d.message).join(', '));
    }

    const existing = await db.GetSettings(req.tenantId);

    // Si no mandan el enfoque se conserva el que ya tenía (o el que deduce su tipo de negocio); queda guardado explícito.
    const focused = { ...value, serviceFocus: value.serviceFocus ?? existing?.serviceFocus };
    const limits = limitsFor(focused);

    // Cambiar a un enfoque con menos roles con un equipo que no cabe dejaría gente sin pantallas: se pide arreglarlo antes.
    const fitError = teamFitError(limits, await db.GetUsersByTenant(req.tenantId));
    if (fitError) return res.status(400).send(fitError);

    const payload = {
      ...value,
      // Si quien guarda no manda la tasa (p. ej. solo cambia el logo) se conserva la que ya tenía
      taxRate: rateOf(value.taxRate ?? existing?.taxRate),
      serviceFocus: limits.focus,
      tenantId: req.tenantId,
      setupCompleted: true,
      updatedAt: new Date(),
    };

    if (!existing) {
      payload.createdAt = new Date();
      const created = await db.CreateSettings(payload);
      return res.status(201).send(created);
    }

    const updated = await db.UpdateSettings(payload, req.tenantId);
    return res.status(200).send(updated);
  } catch (error) {
    console.error(error);
    return res.status(500).send('Error al guardar la configuración');
  }
}

module.exports = {
  GetSettings,
  SaveSettings,
};
