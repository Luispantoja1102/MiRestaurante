# 2026-11-21 Fotos de platillos (también en Uber Eats) y registro de Uber solo con cuenta

## Qué se pidió
Subir fotos de los platillos como en MiTiendita (tarjetas de tamaño fijo), que esas fotos también lleguen a Uber Eats, comprimirlas a un formato ligero, y quitar la opción de vincular Uber con el número de tienda (Store ID).

## Qué se hizo
- **Recorte y compresión**: `frontend/src/components/PhotoCropDialog.vue`, copiado de MiTiendita y adaptado: marco 3:2, salida 1200×800 **JPEG** (Uber lo acepta seguro; WebP sin confirmar), calidad 0.85→0.55 y luego tamaño ×0.85 hasta ≤ 250 000 caracteres (~185 KB). Se usa en `ProductWizard.vue` con «Tomar foto», «Galería» y «Quitar».
- **Alojamiento**: la foto se guarda en MongoDB, colección `food_images` (`database/mongodb.js`), y el platillo guarda en `imgUrl` una dirección pública `API_PUBLIC_URL/foods/:id/image?v=…`. Ruta **sin sesión** (Uber la descarga) en `routers/foods.router.js`; el servidor acepta `data:image/(jpeg|webp|png)` en `imgUrl` al crear o editar (máx. 300 KB) y la convierte (`controllers/menus.controller.js`). `imgUrl: ''` borra la foto. Borrar platillo o categoría borra sus fotos.
- **Uber**: sin cambios en `uber.menu.service.js`; ya mandaba `image_url` si era https.
- **Tarjetas 3:2** en Menú (`MenuComponent.vue`, antes 4:3) y Caja (`CounterView.vue`, antes altura fija).
- **Sin Store ID**: se quitó el bloque «Vincular con el Store ID (avanzado)», `linkUber` y `apiService.uberLink` de Ajustes. Queda solo «Conectar con Uber Eats» (OAuth).

## Cómo se probó
- `backend/tests/food-images.test.js` (subir, descargar sin sesión, reemplazar, quitar, https normal, foto enorme). `npm test` en backend: 336 pasan. `vite build` compila.
- Compresión probada en Chromium con una imagen de ruido 4000×3000 (peor caso): sale JPEG de 867×578 ≈ 237 000 caracteres.

## Pendiente / dudas
- **No confirmado**: tamaño mínimo y formatos que exige Uber (se asumió ≥ 1080×720 y JPEG). Verificar en el sandbox.
- Las fotos ya existentes con URL externa siguen funcionando, pero no se re-alojan.
- La ruta `PUT /integrations/uber` (vincular por Store ID) sigue en el backend sin pantalla; se dejó sin tocar.
- `npm run lint` del backend ya tenía 5 errores previos (mesa, platform, escpos test, point test, jwt).
- No se vio la pantalla real (necesita MongoDB y sesión): falta revisar a ojo el diálogo de recorte y las tarjetas.

## Actualización (misma fecha): revisión de la documentación de Uber
- Documentación revisada: referencia «Upload Menu» y guía de integración de menús. `image_url`: JPG, WEBP o PNG, < 25 MB, 320–6000 px por lado; las imágenes pueden tardar hasta unas horas en procesarse. **Se descartó el supuesto de 1080×720**: no existe en la API.
- Foto en **WebP** 1200×800 (con respaldo a JPEG si el navegador no lo crea), ≤ 250 000 caracteres.
- Menú: una sola traducción `es_mx` (la doc pide una) y `price_info` con `in_store_price` e `in_store_discounted_price` iguales al precio. ⚠️ Esto último se tomó de un resumen de la doc: confirmar en el sandbox.
- Sin dato en la doc: largo máximo de títulos, URL pública de la foto, duración mínima del horario.

## Actualización: ruta de Store ID eliminada
- Se borró `PUT /integrations/uber` (`uberLink`) del backend. Ahora la tienda solo se vincula con «Conectar con Uber Eats» (OAuth). Contradicción visible: la nota [[MiRestaurante/Sesiones/2026-11-16 Integración Uber Eats]] y la guía de salida a producción hablan de pegar el Store ID; manda el código.
- Se conserva la lógica de vínculos `linkedVia: 'manual'` ya guardados (negocios que vincularon antes): se pueden desvincular y no se apagan en Uber.
- Pruebas: las que vinculaban por la ruta ahora siembran la integración directo; 335 pasan.

## Revisión en pantalla (2026-11-21)
- Con el frontend real y la API simulada en el navegador (sin MongoDB: este entorno no tiene el daemon de Docker): tarjetas 3:2 en Menú y Caja (mostrador), las que no tienen foto quedan compactas; diálogo de recorte 3:2; con una foto de 3000×2000 el asistente guarda un WebP de 1200×800 de ~45 000 caracteres y la vista previa 3:2 se ve bien.
- Sin probar: subir la foto contra el servidor real y que Uber la descargue (solo en el sandbox de Uber).
