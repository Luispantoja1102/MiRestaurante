/**
 * Envoltorios de controladores async: lo inesperado se registra y se responde, sin repetir try/catch en cada uno.
 *
 * `handle(fallback, controller, { statusOf })`: error → 500 con el mensaje del error (o `fallback`).
 *
 *   const crear = handle('Error al crear el pedido', async (req, res) => {
 *     ...
 *     return res.status(201).json(creado);
 *   });
 *
 * `statusOf(err)` (opcional) devuelve el código con el que se responde un error esperado del servicio (p. ej. uno con
 * `err.status`); si devuelve algo, se responde con ese código y el mensaje del error, sin registrarlo como fallo.
 *
 *   handle('Error al publicar', fn, { statusOf: (err) => err.status })
 *
 * `handleWith(onError)`: igual, pero con su propia respuesta de error completa (errores de dominio con su código de estado).
 *
 *   const handle = handleWith((res, err) => (err instanceof MiError ? res.status(err.status).send(err.message) : res.status(500).send('…')));
 *   const lista = handle(async (req, res) => res.status(200).json(await servicio.lista()));
 *
 * Los casos esperados dentro del controlador (datos inválidos, «no encontrado», sin permiso) se responden ahí mismo con su
 * código; esto es solo la red de seguridad. Si la respuesta ya salió, solo se registra el error.
 */
const handleWith = (onError) => (controller) =>
  async function handler(req, res, next) {
    try {
      return await controller(req, res, next);
    } catch (err) {
      if (res.headersSent) {
        console.error(err);
        return undefined;
      }
      return onError(res, err);
    }
  };

function handle(fallback, controller, { statusOf } = {}) {
  return handleWith((res, err) => {
    const status = statusOf?.(err);
    if (status) return res.status(status).send(err.message);
    console.error(err);
    return res.status(500).send(err.message || fallback);
  })(controller);
}

module.exports = { handle, handleWith };
