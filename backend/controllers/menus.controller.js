const Joi = require('joi');
const db = require('../database/mongodb');
const { normalizeRecipe, RecipeError } = require('../models/inventory');
const uberMenu = require('../services/uber.menu.service');
const { handle } = require('../utils/handle');

// Si el negocio ya publicó su menú en Uber, un cambio aquí se manda solo (sin esperar y sin estorbar)
const menuChanged = (req) => uberMenu.onMenuChanged(req.tenantId);

const listMenus = handle('Error al listar menús', async (req, res) => {
  return res.status(200).json(await db.GetMenus(req.tenantId));
});

const getMenu = handle('Error al obtener menú', async (req, res) => {
  const menu = await db.GetMenuById(req.params.id, req.tenantId);
  if (!menu) return res.status(404).send('Menú no encontrado');
  return res.status(200).json(menu);
});

const createMenu = handle('Error al crear menú', async (req, res) => {
  const { name, description } = req.body || {};
  if (!name) return res.status(400).send('name es requerido');
  const created = await db.CreateMenu({
    name,
    description: description || '',
    tenantId: req.tenantId,
  });
  menuChanged(req);
  return res.status(201).json(created);
});

const updateMenu = handle('Error al actualizar menú', async (req, res) => {
  const updated = await db.UpdateMenu(req.params.id, req.body || {}, req.tenantId);
  if (!updated) return res.status(404).send('Menú no encontrado');
  menuChanged(req);
  return res.status(200).json(updated);
});

const deleteMenu = handle('Error al eliminar menú', async (req, res) => {
  const result = await db.DeleteMenu(req.params.id, req.tenantId);
  if (!result || result.deletedCount === 0) {
    return res.status(404).send('Menú no encontrado');
  }
  menuChanged(req);
  return res.status(200).json({ ok: true });
});

const listFoods = handle('Error al listar platillos', async (req, res) => {
  return res.status(200).json(await db.GetFoods(req.tenantId));
});

const getFood = handle('Error al obtener platillo', async (req, res) => {
  const food = await db.GetFoodById(req.params.id, req.tenantId);
  if (!food) return res.status(404).send('Platillo no encontrado');
  return res.status(200).json(food);
});

// La foto llega ya reducida desde el navegador (JPEG). Se guarda aparte y el platillo apunta a una dirección https pública,
// que es lo único que Uber Eats acepta como `image_url`.
const IMAGE_DATA = /^data:image\/(jpeg|webp|png);base64,([A-Za-z0-9+/]+=*)$/;
const MAX_IMAGE_BYTES = 300 * 1024;

function parseImage(imgUrl) {
  const m = IMAGE_DATA.exec(imgUrl);
  if (!m) return null;
  const data = Buffer.from(m[2], 'base64');
  if (data.length > MAX_IMAGE_BYTES) throw new RecipeError('La foto pesa demasiado; elige una más sencilla');
  return { mime: `image/${m[1]}`, data };
}

const imageUrl = (req, id) => `${(process.env.API_PUBLIC_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '')}/foods/${id}/image?v=${Date.now()}`;

/** Foto pública de un platillo (sin sesión: la descarga Uber Eats). */
async function foodImage(req, res) {
  try {
    const img = await db.GetFoodImage(req.params.id);
    if (!img) return res.status(404).send('Sin foto');
    res.set({ 'Content-Type': img.mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
    return res.status(200).send(Buffer.isBuffer(img.data) ? img.data : img.data.buffer); // Mongo la devuelve como Binary
  } catch (err) {
    console.error(err);
    return res.status(500).send('Error al obtener la foto');
  }
}

const foodSchema = Joi.object({
  name: Joi.string().trim().min(1).max(80).required().messages({ 'any.required': 'El nombre es obligatorio', 'string.empty': 'El nombre es obligatorio', 'string.max': 'El nombre es demasiado largo (máximo 80 caracteres)' }),
  price: Joi.number().min(0).max(1e6).required().messages({ 'any.required': 'El precio es obligatorio', 'number.base': 'El precio debe ser un número', 'number.min': 'El precio no puede ser negativo' }),
  // ¿El precio ya incluye el IVA? (lo que paga el cliente). Sin dato sí lo incluye.
  priceIncludesTax: Joi.boolean().default(true),
  description: Joi.string().trim().max(300).allow('').default(''),
  imgUrl: Joi.string().trim().max(450000).allow('').default(''),
  menuId: Joi.string().required().messages({ 'any.required': 'Falta la categoría (menuId)' }),
}).options({ stripUnknown: true });

// Para editar: solo se tocan los campos que llegan (y nunca tenantId ni id).
const foodUpdateSchema = foodSchema.fork(['name', 'price', 'menuId'], (f) => f.optional()).options({ stripUnknown: true });

/** Ingredientes activos del negocio por id, para validar recetas y extras. */
async function ingredientsMap(tenantId) {
  return new Map((await db.GetIngredients(tenantId)).map((i) => [String(i.id), i]));
}

const createFood = handle('Error al crear platillo', async (req, res) => {
  const body = req.body || {};
  const { error, value } = foodSchema.validate(body);
  if (error) return res.status(400).send(error.details[0].message);
  if (!(await db.GetMenuById(value.menuId, req.tenantId))) {
    return res.status(400).send('La categoría no existe');
  }

  const extra = {};
  if (body.recipe !== undefined || body.extras !== undefined) {
    Object.assign(extra, normalizeRecipe({ recipe: body.recipe, extras: body.extras }, await ingredientsMap(req.tenantId)));
  }
  const image = parseImage(value.imgUrl);
  let created = await db.CreateFood({
    ...value,
    imgUrl: image ? '' : value.imgUrl,
    recipe: extra.recipe || [],
    extras: extra.extras || [],
    tenantId: req.tenantId,
  });
  if (image) {
    await db.SaveFoodImage(created.id, req.tenantId, image);
    created = await db.UpdateFood(created.id, { imgUrl: imageUrl(req, created.id) }, req.tenantId);
  }
  menuChanged(req);
  return res.status(201).json(created);
}, { statusOf: (err) => (err instanceof RecipeError ? 400 : undefined) });

const updateFood = handle('Error al actualizar platillo', async (req, res) => {
  const body = req.body || {};
  const { error, value } = foodUpdateSchema.validate(body);
  if (error) return res.status(400).send(error.details[0].message);
  if (value.menuId && !(await db.GetMenuById(value.menuId, req.tenantId))) {
    return res.status(400).send('La categoría no existe');
  }

  const patch = {};
  for (const key of ['name', 'price', 'priceIncludesTax', 'description', 'imgUrl', 'menuId']) {
    if (body[key] !== undefined) patch[key] = value[key];
  }
  if (body.recipe !== undefined || body.extras !== undefined) {
    Object.assign(patch, normalizeRecipe({ recipe: body.recipe, extras: body.extras }, await ingredientsMap(req.tenantId)));
  }
  const image = patch.imgUrl ? parseImage(patch.imgUrl) : null;
  if (image || patch.imgUrl === '') {
    if (!(await db.GetFoodById(req.params.id, req.tenantId))) return res.status(404).send('Platillo no encontrado');
    if (image) {
      await db.SaveFoodImage(req.params.id, req.tenantId, image);
      patch.imgUrl = imageUrl(req, req.params.id);
    } else {
      await db.DeleteFoodImage(req.params.id, req.tenantId); // «Quitar foto»
    }
  }
  const updated = await db.UpdateFood(req.params.id, patch, req.tenantId);
  if (!updated) return res.status(404).send('Platillo no encontrado');
  menuChanged(req);
  return res.status(200).json(updated);
}, { statusOf: (err) => (err instanceof RecipeError ? 400 : undefined) });

const deleteFood = handle('Error al eliminar platillo', async (req, res) => {
  const result = await db.DeleteFood(req.params.id, req.tenantId);
  if (!result || result.deletedCount === 0) {
    return res.status(404).send('Platillo no encontrado');
  }
  menuChanged(req);
  return res.status(200).json({ ok: true });
});

module.exports = {
  listMenus,
  getMenu,
  createMenu,
  updateMenu,
  deleteMenu,
  listFoods,
  getFood,
  createFood,
  updateFood,
  deleteFood,
  foodImage,
};
