/**
 * Acceso a datos de vendedores (referidos), sus comisiones y liquidaciones.
 * Colecciones: referrers, referral_commissions, referral_payouts. El negocio guarda referrerId/referralCode.
 */
const { ObjectId } = require('mongodb');
const mongo = require('./mongodb');

const oid = (id) => (ObjectId.isValid(String(id)) ? new ObjectId(String(id)) : null);
const out = (doc) => (doc ? { ...doc, id: String(doc._id) } : null);

let indexed = false;
async function col(name) {
  await mongo.ensureConnection();
  if (!indexed) {
    indexed = true;
    mongo.getCollection('referrers').createIndex({ code: 1 }, { unique: true }).catch(() => {});
    mongo.getCollection('referral_commissions').createIndex({ key: 1 }, { unique: true }).catch(() => {});
    mongo.getCollection('referral_commissions').createIndex({ referrerId: 1, status: 1, createdAt: -1 }).catch(() => {});
    mongo.getCollection('tenants').createIndex({ referrerId: 1 }, { sparse: true }).catch(() => {});
  }
  return mongo.getCollection(name);
}

// ───────── Vendedores ─────────
async function CreateReferrer(doc) {
  const r = await (await col('referrers')).insertOne(doc);
  return out({ ...doc, _id: r.insertedId });
}
async function GetReferrerById(id) {
  const o = oid(id);
  return o ? out(await (await col('referrers')).findOne({ _id: o })) : null;
}
const GetReferrerByCode = async (code) => out(await (await col('referrers')).findOne({ code: String(code) }));
const GetReferrerByEmail = async (email) => out(await (await col('referrers')).findOne({ email: String(email).toLowerCase() }));
/** El vendedor ligado a la cuenta de un admin de la plataforma (por el correo de la cuenta). */
const GetReferrerByOwnerEmail = async (email) => out(await (await col('referrers')).findOne({ ownerEmail: String(email).toLowerCase() }));
async function ListReferrers() {
  return (await (await col('referrers')).find({}).sort({ createdAt: -1 }).toArray()).map(out);
}
async function UpdateReferrer(id, patch) {
  const o = oid(id);
  if (!o) return null;
  const c = await col('referrers');
  await c.updateOne({ _id: o }, { $set: { ...patch, updatedAt: new Date() } });
  return out(await c.findOne({ _id: o }));
}
async function DeleteReferrer(id) {
  const o = oid(id);
  if (o) await (await col('referrers')).deleteOne({ _id: o });
}

// ───────── Negocios referidos ─────────
async function ListTenantsByReferrer(referrerId) {
  return (await (await col('tenants')).find({ referrerId: String(referrerId) }).sort({ referredAt: -1 }).toArray()).map(out);
}
async function ListReferredTenants() {
  return (await (await col('tenants')).find({ referrerId: { $exists: true, $ne: null } }).toArray()).map(out);
}

// ───────── Comisiones ─────────
/** Inserta la comisión. Devuelve null si ya existía esa clave (el mismo cobro llegó dos veces). */
async function InsertCommission(doc) {
  try {
    const r = await (await col('referral_commissions')).insertOne(doc);
    return out({ ...doc, _id: r.insertedId });
  } catch (err) {
    if (err && err.code === 11000) return null;
    throw err;
  }
}
async function GetCommission(id) {
  const o = oid(id);
  return o ? out(await (await col('referral_commissions')).findOne({ _id: o })) : null;
}
const FindCommissionByKey = async (key) => out(await (await col('referral_commissions')).findOne({ key: String(key) }));
async function ListCommissions({ referrerId, tenantId, status, limit = 200 } = {}) {
  const filter = {};
  if (referrerId) filter.referrerId = String(referrerId);
  if (tenantId) filter.tenantId = String(tenantId);
  if (status) filter.status = status;
  const rows = await (await col('referral_commissions'))
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(1000, Math.max(1, Number(limit) || 200)))
    .toArray();
  return rows.map(out);
}
/** Cambia una comisión; con `onlyIfStatus` solo si sigue en ese estado (evita pisar un pago). */
async function UpdateCommission(id, patch, onlyIfStatus) {
  const o = oid(id);
  if (!o) return null;
  const filter = { _id: o, ...(onlyIfStatus ? { status: onlyIfStatus } : {}) };
  const c = await col('referral_commissions');
  const result = await c.updateOne(filter, { $set: patch });
  return result.matchedCount ? out(await c.findOne({ _id: o })) : null;
}
/** Negocios distintos del vendedor con al menos un cobro que cuenta. */
async function ListPayingTenantIds(referrerId) {
  return (await col('referral_commissions')).distinct('tenantId', { referrerId: String(referrerId), status: { $ne: 'void' } });
}
async function CountClosedTenants(referrerId) {
  return (await ListPayingTenantIds(referrerId)).length;
}
/** Totales por vendedor y estado: [{ referrerId, status, total, count }] */
async function SumCommissions() {
  const rows = await (await col('referral_commissions'))
    .aggregate([{ $group: { _id: { referrerId: '$referrerId', status: '$status' }, total: { $sum: '$commission' }, count: { $sum: 1 } } }])
    .toArray();
  return rows.map((r) => ({ referrerId: r._id.referrerId, status: r._id.status, total: r.total, count: r.count }));
}
/** Comisiones del rango (sin las anuladas), por vendedor: pendientes, pagadas y cuántas. */
async function SumCommissionsByReferrerBetween(from, to) {
  const rows = await (await col('referral_commissions'))
    .aggregate([
      { $match: { status: { $ne: 'void' }, createdAt: { $gte: from, $lte: to } } },
      { $group: { _id: { referrerId: '$referrerId', status: '$status' }, total: { $sum: '$commission' }, count: { $sum: 1 } } },
    ])
    .toArray();
  const byId = new Map();
  for (const r of rows) {
    const cur = byId.get(r._id.referrerId) || { referrerId: r._id.referrerId, pending: 0, paid: 0, count: 0 };
    if (r._id.status === 'paid') cur.paid += r.total;
    else cur.pending += r.total;
    cur.count += r.count;
    byId.set(r._id.referrerId, cur);
  }
  return [...byId.values()];
}

// ───────── Liquidaciones ─────────
async function CreatePayout(doc) {
  const r = await (await col('referral_payouts')).insertOne(doc);
  return out({ ...doc, _id: doc._id || r.insertedId });
}
async function ListPayouts(referrerId, limit = 50) {
  return (await (await col('referral_payouts')).find({ referrerId: String(referrerId) }).sort({ paidAt: -1 }).limit(limit).toArray()).map(out);
}
/** Marca como pagadas las comisiones pendientes del vendedor. Devuelve las que pasaron a pagadas. */
async function MarkPendingPaid(referrerId, payoutId, paidAt) {
  const c = await col('referral_commissions');
  const pending = await c.find({ referrerId: String(referrerId), status: 'pending' }).toArray();
  const done = [];
  for (const row of pending) {
    // Si otra petición la anuló o pagó entre la lectura y ahora, no se toca
    const r = await c.updateOne({ _id: row._id, status: 'pending' }, { $set: { status: 'paid', paidAt, payoutId: String(payoutId) } });
    if (r.matchedCount) done.push(out({ ...row, status: 'paid', paidAt, payoutId: String(payoutId) }));
  }
  return done;
}

module.exports = {
  CreateReferrer, DeleteReferrer, GetReferrerById, GetReferrerByCode, GetReferrerByEmail, GetReferrerByOwnerEmail, ListReferrers, UpdateReferrer,
  ListTenantsByReferrer, ListReferredTenants,
  InsertCommission, GetCommission, FindCommissionByKey, ListCommissions, UpdateCommission,
  CountClosedTenants, ListPayingTenantIds, SumCommissions, SumCommissionsByReferrerBetween,
  CreatePayout, ListPayouts, MarkPendingPaid,
};
