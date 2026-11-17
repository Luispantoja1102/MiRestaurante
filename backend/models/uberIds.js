/**
 * Ids que MiRestaurante le pone a las cosas en el menú de Uber. Al llegar un pedido, el mismo id sirve para saber
 * qué producto y qué extras eligió el cliente (y así descontar sus ingredientes).
 */

/** Un extra del producto es un ítem propio en el menú de Uber: producto + ingrediente. */
const extraItemId = (food, extra) => `${food.id}_${extra.ingredientId}`;

module.exports = { extraItemId };
