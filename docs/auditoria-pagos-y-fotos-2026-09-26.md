# Auditoría — Pagos y selección/administración de fotos (Retrato Escolar)

Fecha: 26/09/2026 · Código revisado: `D:\PROYECTOS\infocuschool\infocuschool` (server.ts, servicios y componentes de pagos/fotos, migraciones) + base Supabase en vivo (solo lectura).

Qué está bien: los montos siempre salen de la base (nunca del navegador), el webhook de Mercado Pago verifica firma y reconsulta el pago, el marcado "pagado" es idempotente, el bucket `fotos-hd` es privado, las políticas públicas de `pedidos` y `fotos` están cerradas en la base real, y los crons de conciliación y reintento HD están corriendo.

---

## CRÍTICO

### C1. Nave en sandbox sigue aceptando cobros "de mentira" como reales
- `/api/nave/crear-intencion` y `/crear-intencion-multiple` (server.ts ~8256 y ~8361) no chequean el entorno. `/api/pagos/medios` solo **esconde** el botón en sandbox, pero el endpoint sigue vivo.
- Con `NAVE_ENVIRONMENT=sandbox` y credenciales cargadas (lo que indican los comentarios del 25/9), cualquiera puede llamar al endpoint, pagar con una tarjeta de prueba de Nave y el webhook/conciliación marca el pedido **pagado de verdad** → recibe el HD gratis y el kit impreso entra al laboratorio.
- **Arreglo:** en los dos endpoints de creación, en el webhook y en `conciliarPagoPendiente`, rechazar todo si `getNaveEntorno() !== 'production'` (o una variable `NAVE_HABILITADO=true` explícita).

### C2. El link de fotos HD de cualquier chico se obtiene sabiendo su nombre y curso
- `GET /api/pedidos/existente` (~9199) es público y solo pide colegio + grado/turno/división + nombre del alumno (datos que cualquier compañero conoce). Devuelve `pedidoUuid`.
- Con ese UUID, `GET /api/pedidos/:id/status` (~9018) devuelve `linkDescargaHD` refirmado por 90 días.
- **Arreglo:** exigir el código de sección (como `/api/reservas/pendiente`) en `/existente` y no devolver el UUID; y en `/status` no devolver el link (que llegue solo por email) o exigir código/DNI.

### C3. Nave: se puede pagar menos de lo que vale el grupo (conciliación sin control de monto)
- `conciliarPagoPendiente` llama `marcarReferenciaComoPagada(..., NaN, ...)` para Nave (~8938) → `montoCubrePedidos` con NaN **omite el control de monto**.
- `/api/reservas/crear` acepta sumar reservas a un `grupoPagoId` existente (~7943) aunque ya tenga intención de pago creada.
- Secuencia: carrito de $15.000 → crear intención Nave → sumar N reservas al grupo → pagar los $15.000 → el polling de `/status` marca **todas** las filas pagadas.
- **Arreglo:** leer el monto real de la intención (`intencion.transactions[0].amount.value`) y pasarlo; tratar monto ilegible como "no pagar"; no permitir sumar filas a un grupo con `mp_preference_id` o `nave_payment_request_id` ya generado (o invalidarlos y regenerar).

## ALTO

### A1. Webhook de Nave confía en el cuerpo del POST para saber qué pedido pagar
- `pedidoId = pago.external_payment_id || req.body.external_payment_id` (~8515). Si la respuesta de Nave no trae ese campo, un aviso falso con un `payment_id` real aprobado puede marcar pagado otro pedido (y si el monto no se lee, sin control de monto). Tampoco se verifica que ese `payment_id` no se haya usado ya en otro pedido.
- **Arreglo:** sin fallback al body; validar que la intención del pago coincida con `nave_payment_request_id` guardado; índice único en `nave_payment_id` / `mp_payment_id`.

### A2. Búsqueda por número de pedido enumerable
- `/api/pedidos/buscar` (~9292) devuelve alumno, colegio, tutor y **link HD** con solo `IFS-2026-XXXX` (≈9.000 combinaciones). El límite de 40 intentos / 30 min es por IP y por instancia de Vercel.
- **Arreglo:** pedir número + email/DNI, o no devolver nunca el link acá.

### A3. `colegios` sigue legible completo con la clave pública (verificado en la base)
- La migración `20260924000000_cerrar_lectura_publica_colegios.sql` **no está aplicada**: la política `colegios_public_select` existe y `anon` tiene SELECT. Se lee `codigo_padron` → autocarga en el padrón → aprobación automática → código de sección → galería completa del curso. Lo mismo para `eventos`.
- **Arreglo:** aplicar esa migración (y de paso `REVOKE TRUNCATE, UPDATE, DELETE, INSERT` de anon/authenticated en todas las tablas: hoy anon tiene privilegios de sobra en `alumnos`, `codigos_seccion`, `colegios`, `configuracion`, `eventos`, `solicitudes_codigo`; RLS los frena hoy, pero es la única barrera).

### A4. Link HD sigue vivo después de cancelar / contracargo / reembolso
- `/status` y `/buscar` refirman `link_descarga_hd` sin mirar `estado` (~9074, ~9347). Un pedido cancelado por contracargo (Nave) o reembolsado (MP no maneja `refunded`/`charged_back`) sigue descargando 90 días renovables. `generar-zip-hd` del panel también arma el zip de un pedido **no pagado**.
- **Arreglo:** devolver/refirmar el link solo si `estado ∈ (pagado, entregado)`; manejar `refunded`/`charged_back` en el webhook de MP; exigir pago en `generar-zip-hd`.

## MEDIO

- **M1. Pago doble posible.** Un pedido puede tener a la vez link de MP y de Nave activos (y seguir pagable por MP después de aprobarse la transferencia). El segundo pago no se detecta: `marcarReferenciaComoPagada` devuelve `[]` y nadie se entera. Poner vencimiento a la preferencia (`expiration_date_to`), y si llega un pago aprobado sobre un pedido ya pagado con otro id → registrar y avisar para reembolsar.
- **M2. Pagos con monto insuficiente quedan en silencio.** `montoCubrePedidos` solo hace `console.error`. La familia pagó y no recibe nada; el cron lo reintenta cada 10 min sin avisar. Guardar un flag (`pago_observado`) y mostrarlo en "Estado del sistema".
- **M3. Cambiar medio de pago borra los ids del intento anterior** (~9164). Si la familia termina pagando el link viejo y se pierde el webhook, la conciliación ya no lo encuentra. Guardar historial de intentos en vez de pisarlos.
- **M4. Webhook MP "rejected" cancela sin mirar otros intentos.** Un rechazo tardío cancela un pedido que tiene un pago en efectivo pendiente o que cambió a transferencia (y después no deja subir comprobante porque filtra `cancelado`). Aplicar el mismo criterio de "último intento" que ya usa la conciliación.
- **M5. La selección de fotos no se valida al crear el pedido.** `/api/pedidos/crear` y `/crear-multiple` guardan `fotos_seleccionadas` sin verificar que los ids existan, sean del curso y de la categoría correcta, ni que el kit esté completo. Se cobra y después el zip falla o sale incompleto. Validar como ya hace `/api/reservas/:id/elegir-fotos`.
- **M6. Cualquier familia del curso puede ver y comprar el retrato individual de otro chico.** `/api/fotos` devuelve todas las individuales del curso y el portal no filtra por alumno; basta el código de sección (que se difunde por WhatsApp), sin nombre/DNI. Decisión de negocio/privacidad: filtrar individuales por `alumno_nombre` o, como mínimo, no aceptar en el pedido una individual etiquetada con otro nombre.
- **M7. Miniaturas limpias (sin marca) de 500 px en bucket público.** `fotos-web/.../miniaturas/` es la foto del chico sin marca de agua, accesible por URL. Bajar a ~300 px o aplicarles marca suave.
- **M8. Borrar una foto deja la copia pública.** `eliminarFotoActivaAdmin` borra `thumb_path` y el HD pero **no** `preview_path` (muestras/muestras-v2). En la base: 18 fotos en catálogo vs 669 archivos en `fotos-web` y 292 en `fotos-hd` (huérfanos). Además 19 zips para 1 pedido real (restos de pruebas con links firmados de hasta 90 días). Borrar las 3 rutas en el servidor y limpiar huérfanos antes de la temporada.
- **M9. Borrar una foto no chequea si está en un pedido pagado.** Rompe el zip HD de esa familia y el cron lo reintenta para siempre. Bloquear o avisar.
- **M10. Carga masiva que se corta.** Si el navegador no puede decodificar un archivo (HEIC en Chrome/Windows), `dataUrlABlob` recibe un `blob:` y `atob` tira excepción: el lote se corta a la mitad, con HD ya subidos y sin registrar. Filtrar tipos y envolver en try/catch por foto.

## BAJO

- **B1.** `/status` hace una búsqueda en la API de MP en cada poll (cada ~4 s por familia pendiente) y reescribe la fila en cada refirma: en pico puede chocar con límites de MP. Cachear 30–60 s.
- **B2.** Aprobación manual de un pedido de un grupo solo aprueba esa fila (`.eq('id')`); confirmar que el panel apruebe todo el grupo. No queda registro de quién/cuándo aprobó manualmente.
- **B3.** Comprobante: el tipo MIME lo declara el cliente (no se valida el contenido) y cada subida manda un mail con adjunto (30 por 10 min por IP).
- **B4.** Rate limiting en memoria por instancia: útil contra lo casual, no contra enumeración distribuida (ver A2).
- **B5.** `getServerSupabase` cae a la clave anónima si falta la service role: falla silenciosa rara. Mejor cortar con error.
- **B6.** Signed upload URL del admin permite `upsert` en cualquier ruta de `fotos-hd`, incluido `zips-pedidos/` (solo admin).

---

## Orden sugerido
1. C1 (cortar Nave fuera de producción) y C2 (cerrar `/existente` + `/status`): cambios chicos, hoy mismo.
2. C3 + A1 (control de monto y referencia en Nave).
3. A3 (aplicar migración de `colegios` y revocar privilegios sobrantes).
4. A2, A4.
5. M1–M10 antes del pico de la temporada; limpieza de huérfanos (M8).

---

## Estado de los arreglos (26/09/2026)

Todo lo de arriba quedó corregido en el código, salvo B4 (el límite de intentos sigue siendo por instancia; con A2 ya no protege nada crítico). Typecheck, tests (20/20, 7 nuevos) y build OK.

**Aplicado en la base (Supabase, ya en vivo):** migración `20260926000000_auditoria_cierre_accesos_publicos.sql` — `colegios`/`eventos` cerradas, roles públicos sólo pueden leer `configuracion`, se borró la política que permitía listar `fotos-web` (las fotos siguen cargando por URL), columna `pedidos.aprobado_manual_at`. Verificado desde afuera con la clave pública.

**En el código (se publica al hacer push):**
- C1: Nave rechaza todo fuera de producción (crear intención, webhook, conciliación).
- C2: `/api/pedidos/existente` exige el código del curso; `/status` sólo da el link HD con la llave del pedido (`&t=`), que recibe únicamente quien lo creó (nuevo `src/utils/accesoPedido.ts`).
- C3: monto ilegible ya no da el pago por bueno; la conciliación de Nave lee el monto real; no se pueden sumar reservas a un grupo con link de pago generado.
- A1: webhook de Nave sin fallback al cuerpo del POST; un mismo id de pago no puede pagar dos pedidos.
- A2: el buscador no devuelve el link; botón "Enviarme el link por email" (va sólo al email del pedido).
- A4: link HD sólo si está pagado; reembolsos/contracargos de MP y Nave cancelan y avisan; `generar-zip-hd` exige pago.
- M1/M2: preferencias de MP vencen a los 3 días; pagos dobles, montos insuficientes y reembolsos generan alerta en "Estado del sistema → Errores reportados" + email.
- M3/M4: cambiar de medio de pago ya no borra el intento anterior; un rechazo sólo cancela si el pedido sigue siendo de esa pasarela y no hay otro intento vivo.
- M5/M6: la selección de fotos se valida al crear el pedido; una individual etiquetada con otro alumno no se muestra ni se puede comprar.
- M7: miniaturas limpias a 320 px (las ya subidas quedan a 500 px).
- M8/M9: borrar una foto borra sus 3 archivos desde el servidor y avisa si está en pedidos pagados; nuevo botón "Limpiar Archivos Huérfanos" (primero cuenta, después pide confirmación).
- M10: una foto que el navegador no puede abrir se marca con error y no corta el lote.
- B1: se consulta a la pasarela como mucho cada 30 s por pedido; el link HD se refirma sólo cuando le quedan < 30 días.
- B2: queda la fecha de aprobación manual. B3: se valida el contenido real del comprobante y hay 2 min entre subidas. B5: el servidor exige la Service Role Key. B6: el panel sólo sube/borra rutas de fotos.

**Pendiente para Pablo:** push; después, en el panel, "Limpiar Archivos Huérfanos". Cuando se active Nave en producción, probar un pago real chico y revisar que no aparezca la alerta de "monto ilegible".
