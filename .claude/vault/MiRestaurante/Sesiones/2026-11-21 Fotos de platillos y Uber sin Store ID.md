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
