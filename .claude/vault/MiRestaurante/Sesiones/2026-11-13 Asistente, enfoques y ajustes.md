# Sesión 2026-11-13 (asistente, enfoques y ajustes)

- **Qué se pidió:** al crear una cuenta, abrir un asistente como el de MiTiendita con tres enfoques para elegir uno (solo delivery o para llevar; delivery con meseros; delivery con meseros, anfitrión y cocina); varias personas por rol, cada una con su cuenta y el rol que le dé el dueño; y un menú de Ajustes como el de MiTiendita.
- **Qué se hizo:**
  - Enfoque de servicio (ver [[MiRestaurante/Decisiones/2026-11-13 Enfoque de servicio]]): `backend/models/venueMode.js`, `serviceFocus` en el esquema de ajustes y en `SaveSettings`, mensajes por enfoque en equipo e invitaciones.
  - Asistente de 5 pasos con el paso «Enfoque» (`components/FocusPicker.vue`, reutilizado en Ajustes). No deja continuar sin elegir.
  - Pantallas por enfoque en `frontend/src/roles.js` (`focuses` en `SCREENS`, `canAccessScreen(name, role, mode, focus)`): Mostrador solo en «para llevar»; Mesas y Meseros desde «con meseros»; Cocina y Lista de espera solo en «completo».
  - Ajustes con menú lateral agrupado: Datos y logo, Cómo trabajas, Invitaciones, Cuentas y roles (enlace a `/team`), Apariencia, Contraseña, Soporte, Cerrar sesión. En celular primero el menú y luego la sección.
  - Nuevo `PUT /usuarios/password` para que cada cuenta cambie su contraseña (pide la actual).
  - `TeamView`: sin tope de personas; muestra el enfoque y sus roles.
- **Cómo se probó:** 200 pruebas del backend (`venue-mode`, `roles`, `password`); compila (`vite build` a carpeta temporal); en el navegador, con base temporal: registro → asistente → «con meseros» (barra Mesas/Pedido/Caja), dos meseros, rechazo al pasar a «para llevar» con meseros, cambio a «para llevar» (Mostrador/Caja) y a «completo» (con Cocina), vista de celular y cambio de contraseña.
- **Pendiente / dudas:** el flujo de pedidos a domicilio (cliente, dirección, repartidor, estado) no existe todavía: es el siguiente paso natural. Cambiar la contraseña no cierra otras sesiones abiertas (los tokens duran 24 h). Siguen pendientes de antes: seguridad del Platform admin (token fresco, límite de intentos, contraseña de ejemplo) y los pagos de Mercado Pago.
