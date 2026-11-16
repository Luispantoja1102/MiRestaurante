// El .env vive en la raíz del monorepo; `npm run back:dev` corre desde backend/, así que se carga por ruta.
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
require('dotenv').config();
const express = require('express');
const app = express();
const bodyParser = require('body-parser');
const cors = require('cors');
const compression = require('compression');
const server = require('http').createServer(app);

app.set('trust proxy', 1);
app.disable('x-powered-by');
// En Vercel el backend vive bajo /api: quita el prefijo antes de enrutar
app.use((req, _res, next) => {
  if (req.url === '/api') req.url = '/';
  else if (req.url.startsWith('/api/')) req.url = req.url.slice(4) || '/';
  next();
});
// El webhook de Uber se firma sobre el cuerpo exacto: se guarda el original para verificarlo
app.use(bodyParser.json({
  limit: '10mb',
  verify: (req, _res, buf) => {
    if (req.url.startsWith('/integrations/uber/webhook')) req.rawBody = buf;
  },
}));
app.use(bodyParser.urlencoded({ limit: '10mb', extended: true }));
app.use(compression());
let corsoptions = require('./configurations/cors.configuration');
app.use(cors(corsoptions));

const { ensureConnection } = require('./database/mongodb');
app.use(async (_req, _res, next) => {
  try { await ensureConnection(); } catch (err) {
    console.error('[db] reconnect failed:', err.message);
  }
  next();
});

app.use('/usuarios', require('./routers/usuarios.router'));
app.use('/team', require('./routers/team.router'));
app.use('/sync', require('./routers/sync.router'));
app.use('/ingredients', require('./routers/ingredients.router'));
app.use('/mesas', require('./routers/tables.router'));
app.use('/tables', require('./routers/tables.router'));
app.use('/menus', require('./routers/menus.router'));
app.use('/foods', require('./routers/foods.router'));
app.use('/waiters', require('./routers/meseros.router'));
app.use('/settings', require('./routers/settings.router'));
app.use('/orders', require('./routers/orders.router'));
app.use('/invites', require('./routers/invites.router'));
app.use('/cash', require('./routers/cash.router'));
app.use('/billing', require('./routers/billing.router'));
app.use('/platform', require('./routers/platform.router'));
app.use('/partner', require('./routers/partner.router'));
app.use('/support', require('./routers/support.router'));
app.use('/integrations', require('./routers/integrations.router'));
app.use('/point', require('./routers/point.router'));

if (!process.env.VERCEL) {
  server.listen(process.env.PORT, () => {
    console.log(`Server listening on port ${process.env.PORT}`);
  });
}

module.exports = app;
