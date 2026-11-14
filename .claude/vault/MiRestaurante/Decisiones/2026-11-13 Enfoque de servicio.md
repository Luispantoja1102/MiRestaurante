# Decisión: el enfoque de servicio reemplaza al modo Café

- **Contexto:** el único «modo» era el café (mostrador, hasta 2 personas), activado por el tipo de negocio. El cliente pidió que al crear la cuenta se elija entre tres enfoques (solo delivery o para llevar; delivery con meseros; delivery con meseros, anfitrión y cocina) y que cada rol pueda tener varias personas con su propia cuenta.
- **Decisión:** `settings.serviceFocus` = `takeaway` | `waiters` | `full`. Decide los roles permitidos (`takeaway`: Administrador y Caja; `waiters`: + Mesero; `full`: todos) y las pantallas. `takeaway` reutiliza el mostrador del café. Sin tope de personas. `venueMode.js` (backend) y `roles.js` (frontend) son espejos y `tests/roles.test.js` los compara.
- **Consecuencias:**
  - Negocios antiguos sin enfoque guardado: los cafés pasan a `takeaway` y el resto a `full`; el enfoque queda guardado explícito al primer guardado de ajustes.
  - Cambiar a un enfoque con menos roles se rechaza mientras haya cuentas de roles que ya no existen.
  - «Con meseros» funciona sin cocina porque cobrar no exige que Cocina marque el pedido como listo.
  - El domicilio es una modalidad de pedido, no un enfoque: ver [[MiRestaurante/Sesiones/2026-11-13 Pedidos a domicilio]].
