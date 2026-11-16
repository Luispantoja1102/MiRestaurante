const crypto = require('crypto');

const orderStatuses = ['pending', 'preparing', 'ready', 'served', 'cancelled'];
const paymentMethods = ['cash', 'card', 'transfer', 'other', 'platform'];
// De dónde llegó el pedido. En las apps de reparto la plataforma cobra al cliente y paga después al negocio.
const channelLabels = { local: 'Local', phone: 'Teléfono', uber: 'Uber Eats', rappi: 'Rappi', didi: 'DiDi Food' };
const channels = Object.keys(channelLabels);
const PLATFORM_CHANNELS = ['uber', 'rappi', 'didi'];
const isPlatform = (channel) => PLATFORM_CHANNELS.includes(channel);
const modalities = ['dine-in', 'takeaway', 'delivery'];
const DELIVERY_FEE = 50;

// Datos de entrega de un pedido a domicilio. Devuelve { value } o { error }.
function normalizeDelivery(raw, platform = false) {
  const clean = (v, max) => String(v ?? '').trim().slice(0, max);
  const value = {
    name: clean(raw?.name, 40),
    phone: clean(raw?.phone, 20),
    address: clean(raw?.address, 160),
    reference: clean(raw?.reference, 80),
  };
  if (!value.name) return { error: 'Escribe el nombre de quien recibe' };
  // Las apps de reparto no siempre muestran teléfono y dirección: ahí solo hace falta el nombre
  if (!platform && value.phone.replace(/\D/g, '').length < 7) return { error: 'Escribe un teléfono válido' };
  if (!platform && value.address.length < 5) return { error: 'Escribe la dirección de entrega' };
  return { value };
}

function normalizeOrder(body = {}) {
  const items = Array.isArray(body.items)
    ? body.items.map((item) => ({
        foodId: item.foodId || item.food || item.id || null,
        name: item.name || 'Producto',
        price: Number(item.price || 0),
        quantity: Number(item.quantity || 1),
        notes: item.notes || '',
      }))
    : [];

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0);
  const taxRate = 0.08;
  const channel = channels.includes(body.channel) ? body.channel : 'local';
  // El envío de una app de reparto lo cobra la plataforma, no el negocio
  const deliveryFee = body.modality === 'delivery' && !isPlatform(channel) ? DELIVERY_FEE : 0;
  const tax = Number((subtotal * taxRate).toFixed(2));
  const total = Number((subtotal + tax + deliveryFee).toFixed(2));

  return {
    tableId: body.tableId || null,
    tableName: body.tableName || body.mesa || 'Sin mesa',
    items,
    channel,
    modality: modalities.includes(body.modality) ? body.modality : 'dine-in',
    status: orderStatuses.includes(body.status) ? body.status : 'pending',
    paymentStatus: body.paymentStatus === 'paid' ? 'paid' : 'unpaid',
    paymentMethod: paymentMethods.includes(body.paymentMethod) ? body.paymentMethod : null,
    subtotal,
    tax,
    deliveryFee,
    total,
    notes: body.notes || body.description || '',
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

module.exports = {
  orderStatuses,
  paymentMethods,
  DELIVERY_FEE,
  channels,
  channelLabels,
  isPlatform,
  normalizeDelivery,
  normalizeOrder,
  newToken: () => crypto.randomBytes(24).toString('hex'),
};
