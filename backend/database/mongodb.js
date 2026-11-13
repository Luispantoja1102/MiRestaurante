require('dotenv').config();
const { MongoClient, ObjectId } = require('mongodb');
const { createTenantDoc } = require('../models/tenant.model');
const { PLATFORM_ROLES } = require('../models/roles');

const _url = process.env.DATABASE_URI || 'mongodb://127.0.0.1:27017';
const _dbName = process.env.DATABASE_NAME || 'mirestaurante';

const connection = new MongoClient(_url);
let dbConnection = connection.db(_dbName);
let connected = false;

function withId(doc) {
  if (!doc) return doc;
  const { _id, ...rest } = doc;
  return { ...rest, id: String(_id), _id };
}

function withMesaId(doc) {
  return withId(doc);
}

function oidFilter(id, tenantId) {
  if (!ObjectId.isValid(id) || String(new ObjectId(id)) !== String(id)) return null;
  const filter = { _id: new ObjectId(id) };
  if (tenantId) filter.tenantId = tenantId;
  return filter;
}

let connecting = null;

// Comparte una sola conexión entre peticiones concurrentes (serverless en Vercel)
async function ensureConnection() {
  if (connected) return;
  if (!connecting) {
    connecting = (async () => {
      await connection.connect();
      dbConnection = connection.db(_dbName);
      await migrateLegacyTenant();
      await migrateLegacyRoles();
      await ensureIndexes();
      await ensurePlatformAdmin();
      connected = true;
      console.log(`MongoDB connected → ${_dbName}`);
    })().finally(() => {
      connecting = null;
    });
  }
  await connecting;
}

// Primer arranque: crea el platform_admin definido en .env (PLATFORM_ADMIN_*) si aún no existe ninguno.
// Nunca pisa una cuenta existente (para restablecer la contraseña: npm run seed:platform-admin).
async function ensurePlatformAdmin() {
  const email = (process.env.PLATFORM_ADMIN_EMAIL || '').trim().toLowerCase();
  const username = (process.env.PLATFORM_ADMIN_USERNAME || '').trim();
  const password = process.env.PLATFORM_ADMIN_PASSWORD || '';
  if (!email || !username || !password) return;
  try {
    const users = dbConnection.collection('users');
    if (await users.findOne({ role: 'platform_admin' })) return;
    if (await users.findOne({ $or: [{ email }, { username }] })) {
      console.warn(`[seed] platform admin no creado: ya existe un usuario con ese correo o usuario (${username})`);
      return;
    }
    const now = new Date();
    await users.insertOne({
      name: 'MiRestaurante',
      lastName: 'Platform',
      email,
      username,
      password: await require('../utils/bcrypt.utils').hashPassword(password),
      cellphone: '0000000000',
      role: 'platform_admin',
      tenantId: null,
      createdAt: now,
      updatedAt: now,
    });
    console.log(`[seed] platform admin creado: ${username} / ${email}`);
  } catch (err) {
    console.error('[seed] no se pudo crear el platform admin:', err.message);
  }
}

// Índices que el código necesita para ser correcto (no solo rápido). Idempotente: si ya existen no hace nada.
async function ensureIndexes() {
  try {
    // Una venta de mostrador no puede registrarse dos veces aunque el cliente reintente o haga doble clic.
    await dbConnection.collection('orders').createIndex(
      { tenantId: 1, clientRef: 1 },
      { unique: true, partialFilterExpression: { clientRef: { $type: 'string' } } }
    );
    await dbConnection.collection('support_tickets').createIndex({ tenantId: 1, updatedAt: -1 });
    await dbConnection.collection('support_tickets').createIndex({ status: 1, updatedAt: -1 });
  } catch (err) {
    console.error('[db] no se pudo crear un índice:', err.message);
  }
}

// 'hosstess' (typo) pasó a 'host'; actualiza usuarios e invitaciones existentes.
async function migrateLegacyRoles() {
  await dbConnection.collection('users').updateMany({ role: 'hosstess' }, { $set: { role: 'host' } });
  await dbConnection.collection('invites').updateMany({ role: 'hosstess' }, { $set: { role: 'host' } });
}

async function migrateLegacyTenant() {
  const tenants = dbConnection.collection('tenants');
  let defaultTenant = await tenants.findOne({ slug: 'default' });
  if (!defaultTenant) {
    const needs =
      (await dbConnection.collection('users').countDocuments({ tenantId: { $exists: false } })) > 0 ||
      (await dbConnection.collection('settings').countDocuments({ tenantId: { $exists: false } })) > 0 ||
      (await dbConnection.collection('orders').countDocuments({ tenantId: { $exists: false } })) > 0 ||
      (await dbConnection.collection('mesas').countDocuments({ tenantId: { $exists: false } })) > 0;

    if (needs) {
      const insert = await tenants.insertOne({
        ...createTenantDoc('Negocio migrado'),
        slug: 'default',
      });
      defaultTenant = await tenants.findOne({ _id: insert.insertedId });

      const tenantId = String(defaultTenant._id);
      const collections = [
        'users', 'mesas', 'menus', 'foods', 'waiters', 'waitlist', 'settings', 'orders', 'invites',
      ];
      for (const name of collections) {
        await dbConnection.collection(name).updateMany(
          { tenantId: { $exists: false } },
          { $set: { tenantId } }
        );
      }
      console.log(`MongoDB migration: legacy docs → tenant ${tenantId}`);
    }
  }

  await migrateTenantBilling();
}

async function migrateTenantBilling() {
  const { trialEndsFrom } = require('../models/tenant.model');
  const now = new Date();
  const result = await dbConnection.collection('tenants').updateMany(
    { billingStatus: { $exists: false } },
    {
      $set: {
        plan: 'basic',
        billingStatus: 'trialing',
        trialEndsAt: trialEndsFrom(now),
        mpPreapprovalId: null,
        mpPayerEmail: null,
        currentPeriodEnd: null,
        suspendedAt: null,
        suspendedReason: null,
        updatedAt: now,
      },
    }
  );
  if (result.modifiedCount > 0) {
    console.log(`MongoDB migration: billing fields → ${result.modifiedCount} tenants`);
  }
}

ensureConnection().catch((err) => {
  console.error('MongoDB connection error:', err.message);
});

async function CreateTenant(data) {
  const result = await dbConnection.collection('tenants').insertOne(data);
  return withId(await dbConnection.collection('tenants').findOne({ _id: result.insertedId }));
}
async function GetTenantById(id) {
  if (!ObjectId.isValid(id)) return null;
  return withId(await dbConnection.collection('tenants').findOne({ _id: new ObjectId(id) }));
}
async function UpdateTenant(id, data) {
  if (!ObjectId.isValid(id)) return null;
  const clean = { ...data, updatedAt: new Date() };
  delete clean.id;
  delete clean._id;
  await dbConnection.collection('tenants').updateOne(
    { _id: new ObjectId(id) },
    { $set: clean }
  );
  return GetTenantById(id);
}
async function ListTenants() {
  const list = await dbConnection.collection('tenants').find({}).sort({ createdAt: -1 }).toArray();
  return list.map(withId);
}
async function CountUsersByTenant(tenantId) {
  return dbConnection.collection('users').countDocuments({ tenantId: String(tenantId) });
}
async function GetTenantByMpPreapprovalId(preapprovalId) {
  if (!preapprovalId) return null;
  return withId(
    await dbConnection.collection('tenants').findOne({ mpPreapprovalId: String(preapprovalId) })
  );
}

async function CreateUser(data) {
  return await dbConnection.collection('users').insertOne(data);
}
async function FindUserByEmail(email, tenantId = null) {
  const filter = { email };
  if (tenantId) filter.tenantId = tenantId;
  return await dbConnection.collection('users').findOne(filter);
}
async function FindUserByUsername(username, tenantId = null) {
  const filter = { username };
  if (tenantId) filter.tenantId = tenantId;
  return await dbConnection.collection('users').findOne(filter);
}
async function LoginUsuario(data) {
  let find = await FindUserByUsername(data);
  if (find) return find;
  find = await FindUserByEmail(data);
  if (find) return find;
  return null;
}
async function UpdateUserById(id, data) {
  if (!ObjectId.isValid(id)) return null;
  const clean = { ...data };
  delete clean.id;
  delete clean._id;
  await dbConnection.collection('users').updateOne({ _id: new ObjectId(id) }, { $set: clean });
  return await dbConnection.collection('users').findOne({ _id: new ObjectId(id) });
}
const USER_PUBLIC_FIELDS = { password: 0, resetToken: 0, resetExpires: 0 };

async function GetUsersByTenant(tenantId) {
  const users = await dbConnection
    .collection('users')
    .find({ tenantId: String(tenantId) }, { projection: USER_PUBLIC_FIELDS })
    .sort({ createdAt: 1, name: 1 })
    .toArray();
  return users.map((u) => ({ ...u, id: String(u._id) }));
}
async function GetUserByIdAndTenant(id, tenantId) {
  if (!ObjectId.isValid(id)) return null;
  return await dbConnection
    .collection('users')
    .findOne({ _id: new ObjectId(id), tenantId: String(tenantId) });
}
async function CountUsersByRole(tenantId, role) {
  return dbConnection.collection('users').countDocuments({ tenantId: String(tenantId), role });
}
async function DeleteUserByIdAndTenant(id, tenantId) {
  if (!ObjectId.isValid(id)) return { deletedCount: 0 };
  return await dbConnection
    .collection('users')
    .deleteOne({ _id: new ObjectId(id), tenantId: String(tenantId) });
}
// ——— Plataforma (lecturas por lote, equipo y bitácora) ———
async function GetSettingsMany(tenantIds) {
  const ids = (tenantIds || []).map(String);
  if (!ids.length) return new Map();
  const rows = await dbConnection.collection('settings').find({ tenantId: { $in: ids } }).toArray();
  return new Map(rows.map((row) => [String(row.tenantId), row]));
}
async function ListUsersByTenants(tenantIds) {
  const ids = (tenantIds || []).map(String);
  const byTenant = new Map(ids.map((id) => [id, []]));
  if (!ids.length) return byTenant;
  const rows = await dbConnection
    .collection('users')
    .find({ tenantId: { $in: ids } }, { projection: USER_PUBLIC_FIELDS })
    .sort({ createdAt: 1 })
    .toArray();
  for (const row of rows) byTenant.get(String(row.tenantId)).push({ ...row, id: String(row._id) });
  return byTenant;
}
async function ListPlatformUsers() {
  const rows = await dbConnection
    .collection('users')
    .find({ role: { $in: PLATFORM_ROLES } }, { projection: USER_PUBLIC_FIELDS })
    .sort({ createdAt: 1 })
    .toArray();
  return rows.map((row) => ({ ...row, id: String(row._id) }));
}
async function CountPlatformAdmins() {
  return dbConnection.collection('users').countDocuments({ role: 'platform_admin' });
}
async function DeleteUserById(id) {
  if (!ObjectId.isValid(id)) return false;
  const result = await dbConnection.collection('users').deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}
// Cuánto usa un negocio la plataforma (ficha del cliente)
async function CountTenantUsage(tenantId) {
  const tid = String(tenantId);
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const count = (name, extra = {}) => dbConnection.collection(name).countDocuments({ tenantId: tid, ...extra });
  const [tables, foods, ingredients, orders30d] = await Promise.all([
    count('mesas'),
    count('foods'),
    count('ingredients'),
    count('orders', { createdAt: { $gte: since } }),
  ]);
  return { tables, foods, ingredients, orders30d };
}
// Cobros: un evento por pago recibido (hoy, los que registra el equipo a mano)
async function CreateBillingEvent(data) {
  const doc = { ...data, tenantId: String(data.tenantId), at: data.at || new Date() };
  const result = await dbConnection.collection('billing_events').insertOne(doc);
  return withId({ ...doc, _id: result.insertedId });
}
async function ListBillingEvents(tenantId, limit = 40) {
  const rows = await dbConnection
    .collection('billing_events')
    .find({ tenantId: String(tenantId) })
    .sort({ at: -1 })
    .limit(limit)
    .toArray();
  return rows.map(withId);
}
async function ListPaymentsBetween(from, to) {
  const rows = await dbConnection
    .collection('billing_events')
    .find({ type: 'payment', at: { $gte: from, $lte: to } })
    .sort({ at: -1 })
    .toArray();
  return rows.map(withId);
}
async function CreatePlatformExpense(data) {
  const result = await dbConnection.collection('platform_expenses').insertOne(data);
  return withId({ ...data, _id: result.insertedId });
}
async function DeletePlatformExpense(id) {
  if (!ObjectId.isValid(id)) return false;
  const result = await dbConnection.collection('platform_expenses').deleteOne({ _id: new ObjectId(id) });
  return result.deletedCount > 0;
}
// Gastos desde un mes («AAAA-MM») en adelante; las claves de mes ordenan bien como texto
async function ListPlatformExpensesSince(month) {
  const rows = await dbConnection
    .collection('platform_expenses')
    .find({ month: { $gte: month } })
    .sort({ createdAt: -1 })
    .toArray();
  return rows.map(withId);
}
// ——— Soporte: un ticket por conversación, con sus mensajes dentro ———
async function CreateSupportTicket(data) {
  const result = await dbConnection.collection('support_tickets').insertOne(data);
  return withId({ ...data, _id: result.insertedId });
}
async function GetSupportTicket(id) {
  if (!ObjectId.isValid(id)) return null;
  return withId(await dbConnection.collection('support_tickets').findOne({ _id: new ObjectId(id) }));
}
async function ListSupportTickets({ tenantId, status, limit = 300 } = {}) {
  const filter = {};
  if (tenantId) filter.tenantId = String(tenantId);
  if (status) filter.status = status;
  const rows = await dbConnection
    .collection('support_tickets')
    .find(filter)
    .sort({ updatedAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 300, 1), 1000))
    .toArray();
  return rows.map(withId);
}
/** Agrega un mensaje al ticket y cambia su estado en una sola operación (no se pierden mensajes si dos personas escriben a la vez). */
async function AppendSupportMessage(id, message, patch = {}) {
  if (!ObjectId.isValid(id)) return null;
  const result = await dbConnection
    .collection('support_tickets')
    .findOneAndUpdate(
      { _id: new ObjectId(id) },
      { $push: { messages: message }, $set: { ...patch, updatedAt: message.at } },
      { returnDocument: 'after' }
    );
  const doc = result && Object.prototype.hasOwnProperty.call(result, 'value') ? result.value : result;
  return withId(doc);
}
async function UpdateSupportTicket(id, patch) {
  if (!ObjectId.isValid(id)) return null;
  await dbConnection.collection('support_tickets').updateOne({ _id: new ObjectId(id) }, { $set: { ...patch, updatedAt: new Date() } });
  return GetSupportTicket(id);
}
async function CreatePlatformAudit(data) {
  await dbConnection.collection('platform_audit').insertOne(data);
}
async function ListPlatformAudit({ tenantId = null, limit = 60 } = {}) {
  const filter = tenantId ? { tenantId: String(tenantId) } : {};
  const rows = await dbConnection
    .collection('platform_audit')
    .find(filter)
    .sort({ createdAt: -1 })
    .limit(Math.min(Math.max(Number(limit) || 60, 1), 200))
    .toArray();
  return rows.map(withId);
}

async function FindUserByResetToken(token) {
  return await dbConnection.collection('users').findOne({
    resetToken: token,
    resetExpires: { $gt: new Date() },
  });
}

// ——— Sincronización en vivo ———
// Un contador por canal y por negocio. Cada escritura de pedidos, mesas o lista de espera
// lo incrementa; las pantallas consultan GET /sync (una sola lectura barata) y recargan
// solo lo que cambió. Un fallo aquí nunca debe romper la operación que lo originó.
async function touchSync(tenantId, ...channels) {
  if (!tenantId || !channels.length) return;
  try {
    await dbConnection.collection('sync').updateOne(
      { _id: String(tenantId) },
      { $inc: Object.fromEntries(channels.map((c) => [c, 1])), $set: { updatedAt: new Date() } },
      { upsert: true }
    );
  } catch (err) {
    console.error('[sync] no se pudo registrar el cambio:', err.message);
  }
}
async function GetSyncVersions(tenantId) {
  const doc = await dbConnection
    .collection('sync')
    .findOne({ _id: String(tenantId) }, { projection: { _id: 0, orders: 1, tables: 1, waitlist: 1, inventory: 1 } });
  return { orders: doc?.orders || 0, tables: doc?.tables || 0, waitlist: doc?.waitlist || 0, inventory: doc?.inventory || 0 };
}

async function AddMesa(data) {
  const result = await dbConnection.collection('mesas').insertOne(data);
  await touchSync(data.tenantId, 'tables');
  return withMesaId(await dbConnection.collection('mesas').findOne({ _id: result.insertedId }));
}
async function UpdateStatusMesa(id, data, tenantId) {
  const clean = { ...data };
  delete clean.id;
  delete clean._id;
  let filter = oidFilter(id, tenantId);
  if (!filter) {
    filter = { numero: parseInt(id, 10), ...(tenantId ? { tenantId } : {}) };
  }
  let result = await dbConnection.collection('mesas').updateOne(filter, { $set: clean });
  if (result.matchedCount === 0 && tenantId) {
    result = await dbConnection.collection('mesas').updateOne(
      { nombre: String(id), tenantId },
      { $set: clean }
    );
  }
  if (result.matchedCount) await touchSync(tenantId, 'tables');
  return result;
}
async function Getmesas(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return (await dbConnection.collection('mesas').find(filter).toArray()).map(withMesaId);
}
async function GetMesaById(id, tenantId) {
  const byOid = oidFilter(id, tenantId);
  if (byOid) {
    const doc = await dbConnection.collection('mesas').findOne(byOid);
    if (doc) return withMesaId(doc);
  }
  const base = tenantId ? { tenantId } : {};
  let result = await dbConnection.collection('mesas').findOne({ ...base, nombre: id });
  if (!result) {
    result = await dbConnection.collection('mesas').findOne({ ...base, numero: parseInt(id, 10) });
  }
  return withMesaId(result);
}
async function GetNextMesaNumero(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  const last = await dbConnection.collection('mesas').find(filter).sort({ numero: -1 }).limit(1).toArray();
  return last.length ? (last[0].numero || 0) + 1 : 1;
}
async function GetMesaFreeWaiter(tenantId) {
  const filter = { disponible: true, ...(tenantId ? { tenantId } : {}) };
  return (await dbConnection.collection('mesas').find(filter).toArray()).map(withMesaId);
}
async function DeleteMesa(id, tenantId) {
  const byOid = oidFilter(id, tenantId);
  if (byOid) {
    const byOidRes = await dbConnection.collection('mesas').deleteOne(byOid);
    if (byOidRes.deletedCount) {
      await touchSync(tenantId, 'tables');
      return byOidRes;
    }
  }
  const result = await dbConnection.collection('mesas').deleteOne({
    numero: parseInt(id, 10),
    ...(tenantId ? { tenantId } : {}),
  });
  if (result.deletedCount) await touchSync(tenantId, 'tables');
  return result;
}
async function CloseMesas(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  const result = await dbConnection.collection('mesas').updateMany(filter, { $set: { disponible: false, personaTitular: null } });
  await touchSync(tenantId, 'tables');
  return result;
}

// ——— Inventario ———
// Las existencias admiten decimales; se redondean al leer para no mostrar 0.30000000000000004.
const stockRound = (n) => Math.round((Number(n) + Number.EPSILON) * 1000) / 1000;
const withStock = (doc) => (doc ? { ...withId(doc), stock: stockRound(doc.stock), minStock: stockRound(doc.minStock) } : doc);

async function GetIngredients(tenantId) {
  const rows = await dbConnection.collection('ingredients').find({ tenantId: String(tenantId) }).sort({ name: 1 }).toArray();
  return rows.map(withStock);
}
async function GetIngredientById(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  return withStock(await dbConnection.collection('ingredients').findOne(filter));
}
async function CreateIngredient(data) {
  const result = await dbConnection.collection('ingredients').insertOne(data);
  await touchSync(data.tenantId, 'inventory');
  return withStock(await dbConnection.collection('ingredients').findOne({ _id: result.insertedId }));
}
async function UpdateIngredient(id, data, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const clean = { ...data };
  delete clean.id; delete clean._id; delete clean.tenantId; delete clean.stock;
  await dbConnection.collection('ingredients').updateOne(filter, { $set: clean });
  await touchSync(tenantId, 'inventory');
  return GetIngredientById(id, tenantId);
}
async function DeleteIngredient(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return { deletedCount: 0 };
  const result = await dbConnection.collection('ingredients').deleteOne(filter);
  if (result.deletedCount) await touchSync(tenantId, 'inventory');
  return result;
}
// ¿En cuántos platillos entra este ingrediente (en la receta o como extra)?
async function CountFoodsUsingIngredient(id, tenantId) {
  const ingredientId = String(id);
  return dbConnection.collection('foods').countDocuments({
    tenantId: String(tenantId),
    $or: [{ 'recipe.ingredientId': ingredientId }, { 'extras.ingredientId': ingredientId }],
  });
}

async function logMovement(tenantId, ingredient, delta, stockAfter, meta = {}) {
  await dbConnection.collection('stock_movements').insertOne({
    tenantId: String(tenantId),
    ingredientId: String(ingredient._id),
    ingredientName: ingredient.name,
    unit: ingredient.unit,
    type: meta.type,
    delta: stockRound(delta),
    stockAfter: stockRound(stockAfter),
    orderId: meta.orderId || null,
    note: meta.note || '',
    by: meta.by || null,
    at: new Date(),
  });
}

/**
 * Suma (o resta, si delta es negativo) existencias de forma atómica y deja registro del movimiento.
 * El stock PUEDE quedar en negativo: una venta nunca se bloquea por un conteo desactualizado.
 */
async function AdjustStock(tenantId, ingredientId, delta, meta = {}) {
  if (!ObjectId.isValid(ingredientId)) return null;
  const doc = await dbConnection.collection('ingredients').findOneAndUpdate(
    { _id: new ObjectId(ingredientId), tenantId: String(tenantId) },
    { $inc: { stock: stockRound(delta) }, $set: { updatedAt: new Date() } },
    { returnDocument: 'after' }
  );
  if (!doc) return null;
  await logMovement(tenantId, doc, delta, doc.stock, meta);
  await touchSync(tenantId, 'inventory');
  return withStock(doc);
}

/** Fija la existencia contada (inventario físico). El movimiento registra la diferencia real. */
async function SetStock(tenantId, ingredientId, counted, meta = {}) {
  if (!ObjectId.isValid(ingredientId)) return null;
  const before = await dbConnection.collection('ingredients').findOneAndUpdate(
    { _id: new ObjectId(ingredientId), tenantId: String(tenantId) },
    { $set: { stock: stockRound(counted), updatedAt: new Date() } },
    { returnDocument: 'before' }
  );
  if (!before) return null;
  await logMovement(tenantId, before, stockRound(counted) - stockRound(before.stock), counted, { ...meta, type: 'adjust' });
  await touchSync(tenantId, 'inventory');
  return withStock({ ...before, stock: counted });
}

async function GetStockMovements(tenantId, { ingredientId, limit = 50 } = {}) {
  const filter = { tenantId: String(tenantId), ...(ingredientId ? { ingredientId: String(ingredientId) } : {}) };
  const rows = await dbConnection.collection('stock_movements').find(filter).sort({ at: -1 }).limit(limit).toArray();
  return rows.map(withId);
}

async function GetMenus(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return (await dbConnection.collection('menus').find(filter).toArray()).map(withId);
}
async function GetMenuById(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const menu = await dbConnection.collection('menus').findOne(filter);
  if (!menu) return null;
  const foodFilter = { menuId: String(id), ...(tenantId ? { tenantId } : {}) };
  const foods = await dbConnection.collection('foods').find(foodFilter).toArray();
  return { ...withId(menu), foods: foods.map(withId) };
}
async function CreateMenu(data) {
  const result = await dbConnection.collection('menus').insertOne(data);
  return withId(await dbConnection.collection('menus').findOne({ _id: result.insertedId }));
}
async function UpdateMenu(id, data, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const clean = { ...data };
  delete clean.id; delete clean._id; delete clean.foods;
  await dbConnection.collection('menus').updateOne(filter, { $set: clean });
  return GetMenuById(id, tenantId);
}
async function DeleteMenu(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return { deletedCount: 0 };
  await dbConnection.collection('foods').deleteMany({ menuId: String(id), ...(tenantId ? { tenantId } : {}) });
  return await dbConnection.collection('menus').deleteOne(filter);
}
async function GetFoods(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return (await dbConnection.collection('foods').find(filter).toArray()).map(withId);
}
async function GetFoodById(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  return withId(await dbConnection.collection('foods').findOne(filter));
}
async function CreateFood(data) {
  const result = await dbConnection.collection('foods').insertOne(data);
  return withId(await dbConnection.collection('foods').findOne({ _id: result.insertedId }));
}
async function UpdateFood(id, data, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const clean = { ...data };
  delete clean.id; delete clean._id; delete clean.tenantId; // un platillo nunca cambia de negocio
  await dbConnection.collection('foods').updateOne(filter, { $set: clean });
  return GetFoodById(id, tenantId);
}
async function DeleteFood(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return { deletedCount: 0 };
  return await dbConnection.collection('foods').deleteOne(filter);
}

async function AddWaiter(data) {
  return await dbConnection.collection('waiters').insertOne(data);
}
async function GetWaiters(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return await dbConnection.collection('waiters').find(filter).toArray();
}
async function GetWaiterByCellphone(id, tenantId) {
  return await dbConnection.collection('waiters').findOne({ cellphone: id, ...(tenantId ? { tenantId } : {}) });
}
async function GetWaiterByDisponibility(disponibility, tenantId) {
  return await dbConnection.collection('waiters').findOne({ status: disponibility, ...(tenantId ? { tenantId } : {}) });
}
async function DeleteWaiter(id, tenantId) {
  return await dbConnection.collection('waiters').deleteOne({ cellphone: id, ...(tenantId ? { tenantId } : {}) });
}
async function UpdateWaiter(id, data, tenantId) {
  return await dbConnection.collection('waiters').updateOne({ cellphone: id, ...(tenantId ? { tenantId } : {}) }, { $set: data });
}

async function AddWaitList(data) {
  const result = await dbConnection.collection('waitlist').insertOne(data);
  await touchSync(data.tenantId, 'waitlist');
  return result;
}
async function GetWaitList(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return await dbConnection.collection('waitlist').find(filter).toArray();
}
async function GetWaitListByNumber(number, tenantId) {
  return await dbConnection.collection('waitlist').findOne({ cellphone: parseInt(number, 10), ...(tenantId ? { tenantId } : {}) });
}
async function DeleteWaitList(id, tenantId) {
  const result = await dbConnection.collection('waitlist').deleteOne({ telefono: id, ...(tenantId ? { tenantId } : {}) });
  if (result.deletedCount) await touchSync(tenantId, 'waitlist');
  return result;
}

async function GetSettings(tenantId) {
  if (!tenantId) return await dbConnection.collection('settings').findOne({});
  return await dbConnection.collection('settings').findOne({ tenantId });
}
async function CreateSettings(data) {
  await dbConnection.collection('settings').insertOne(data);
  return await GetSettings(data.tenantId);
}
async function UpdateSettings(data, tenantId) {
  const tid = tenantId || data.tenantId;
  await dbConnection.collection('settings').updateOne({ tenantId: tid }, { $set: data }, { upsert: true });
  return await GetSettings(tid);
}

async function GetOrders(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return (await dbConnection.collection('orders').find(filter).sort({ createdAt: -1 }).toArray()).map(withId);
}
async function GetOrderById(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  return withId(await dbConnection.collection('orders').findOne(filter));
}
async function CreateOrder(data) {
  const result = await dbConnection.collection('orders').insertOne(data);
  await touchSync(data.tenantId, 'orders');
  return withId(await dbConnection.collection('orders').findOne({ _id: result.insertedId }));
}
async function GetOrderByClientRef(tenantId, clientRef) {
  if (!tenantId || !clientRef) return null;
  return withId(await dbConnection.collection('orders').findOne({ tenantId: String(tenantId), clientRef }));
}
// Contador atómico (p. ej. el turno del día en el mostrador). Devuelve el número que le tocó.
async function NextCounter(tenantId, key) {
  const doc = await dbConnection
    .collection('counters')
    .findOneAndUpdate({ _id: `${tenantId}:${key}` }, { $inc: { n: 1 } }, { upsert: true, returnDocument: 'after' });
  return doc?.n ?? doc?.value?.n;
}
async function UpdateOrder(id, data, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const clean = { ...data };
  delete clean.id; delete clean._id;
  await dbConnection.collection('orders').updateOne(filter, { $set: clean });
  await touchSync(tenantId, 'orders');
  return GetOrderById(id, tenantId);
}
async function GetOrdersByCashSession(sessionId, tenantId) {
  return (await dbConnection.collection('orders').find({ cashSessionId: sessionId, ...(tenantId ? { tenantId } : {}) }).toArray()).map(withId);
}

async function GetInvites(tenantId) {
  const filter = tenantId ? { tenantId } : {};
  return (await dbConnection.collection('invites').find(filter).sort({ createdAt: -1 }).toArray()).map(withId);
}
async function GetInviteByToken(token) {
  return withId(await dbConnection.collection('invites').findOne({ token }));
}
async function CreateInvite(data) {
  const result = await dbConnection.collection('invites').insertOne(data);
  return withId(await dbConnection.collection('invites').findOne({ _id: result.insertedId }));
}
async function UpdateInvite(id, data, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const clean = { ...data };
  delete clean.id; delete clean._id;
  await dbConnection.collection('invites').updateOne(filter, { $set: clean });
  return withId(await dbConnection.collection('invites').findOne(filter));
}
async function DeleteInvite(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return { deletedCount: 0 };
  return await dbConnection.collection('invites').deleteOne(filter);
}

async function GetOpenCashSession(tenantId) {
  return withId(await dbConnection.collection('cash_sessions').findOne({ tenantId, status: 'open' }));
}
async function GetCashSessionById(id, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  return withId(await dbConnection.collection('cash_sessions').findOne(filter));
}
async function CreateCashSession(data) {
  const result = await dbConnection.collection('cash_sessions').insertOne(data);
  await touchSync(data.tenantId, 'orders');
  return withId(await dbConnection.collection('cash_sessions').findOne({ _id: result.insertedId }));
}
async function UpdateCashSession(id, data, tenantId) {
  const filter = oidFilter(id, tenantId);
  if (!filter) return null;
  const clean = { ...data };
  delete clean.id; delete clean._id;
  await dbConnection.collection('cash_sessions').updateOne(filter, { $set: clean });
  await touchSync(tenantId, 'orders');
  return GetCashSessionById(id, tenantId);
}

// Para los módulos de datos que viven aparte (referidos y socios)
const getCollection = (name) => dbConnection.collection(name);

module.exports = {
  ensureConnection,
  getCollection,
  CreateTenant, GetTenantById, UpdateTenant, ListTenants, CountUsersByTenant, GetTenantByMpPreapprovalId,
  CreateUser, FindUserByEmail, LoginUsuario, FindUserByUsername, UpdateUserById, FindUserByResetToken,
  touchSync, GetSyncVersions,
  GetIngredients, GetIngredientById, CreateIngredient, UpdateIngredient, DeleteIngredient, CountFoodsUsingIngredient,
  AdjustStock, SetStock, GetStockMovements,
  GetUsersByTenant, GetUserByIdAndTenant, CountUsersByRole, DeleteUserByIdAndTenant,
  GetSettingsMany, ListUsersByTenants, ListPlatformUsers, CountPlatformAdmins, DeleteUserById,
  CreatePlatformAudit, ListPlatformAudit, CountTenantUsage,
  CreateSupportTicket, GetSupportTicket, ListSupportTickets, AppendSupportMessage, UpdateSupportTicket,
  CreateBillingEvent, ListBillingEvents, ListPaymentsBetween,
  CreatePlatformExpense, DeletePlatformExpense, ListPlatformExpensesSince,
  AddMesa, UpdateStatusMesa, Getmesas, GetMesaFreeWaiter, GetMesaById, DeleteMesa, CloseMesas, GetNextMesaNumero,
  AddWaiter, GetWaiters, GetWaiterByCellphone, GetWaiterByDisponibility, DeleteWaiter, UpdateWaiter,
  AddWaitList, GetWaitList, GetWaitListByNumber, DeleteWaitList,
  GetSettings, CreateSettings, UpdateSettings,
  GetMenus, GetMenuById, CreateMenu, UpdateMenu, DeleteMenu,
  GetFoods, GetFoodById, CreateFood, UpdateFood, DeleteFood,
  GetOrders, GetOrderById, CreateOrder, UpdateOrder, GetOrdersByCashSession, GetOrderByClientRef, NextCounter,
  GetInvites, GetInviteByToken, CreateInvite, UpdateInvite, DeleteInvite,
  GetOpenCashSession, GetCashSessionById, CreateCashSession, UpdateCashSession,
};
