const support = require('../services/support.service');
const db = require('../database/mongodb');

function fail(res, err) {
  if (err instanceof support.SupportError) return res.status(err.status).send(err.message);
  console.error('[soporte]', err);
  return res.status(500).send('No pude completar la acción. Intenta de nuevo.');
}

const handle = (fn) => async (req, res) => {
  try {
    return await fn(req, res);
  } catch (err) {
    return fail(res, err);
  }
};

// Quien escribe: el token solo trae el usuario; el nombre y el correo salen de su cuenta
const author = (req) => db.FindUserByUsername(req.user.username, req.tenantId);

const list = handle(async (req, res) => res.status(200).json(await support.listForTenant(req.tenantId)));
const get = handle(async (req, res) => res.status(200).json(await support.getForTenant(req.tenantId, req.params.id)));
const create = handle(async (req, res) =>
  res.status(201).json(await support.openByClient({ tenantId: req.tenantId, user: await author(req), subject: req.body?.subject, message: req.body?.message }))
);
const reply = handle(async (req, res) =>
  res.status(201).json(await support.replyByClient({ tenantId: req.tenantId, user: await author(req), id: req.params.id, message: req.body?.message }))
);

module.exports = { list, get, create, reply };
