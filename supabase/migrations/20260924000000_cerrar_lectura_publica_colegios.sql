-- ==============================================================================
-- MIGRACIÓN SUPABASE: cerrar la lectura pública de `colegios` y `eventos`
-- Fecha: 2026-09-24 (auditoría de código previa al lanzamiento)
--
-- Problema: la política `colegios_public_select` (USING true) deja que cualquiera con la clave
-- pública del sitio (la "publishable key", que viaja dentro del JavaScript de la web) lea la
-- tabla `colegios` COMPLETA vía la API REST de Supabase — incluida la columna `codigo_padron`,
-- el código secreto del link de autocarga del padrón (/padron.html?c=CODIGO). Con ese código
-- cualquiera puede cargarse a sí mismo en `padres_autorizados` sin haber recibido nunca el link.
--
-- La web NO lee `colegios` ni `eventos` directo desde el navegador: la lista pública de colegios
-- sale de GET /api/colegios (server.ts), que usa la Service Role Key (ignora RLS) y ya filtra
-- las columnas que expone. Por eso se pueden cerrar sin romper nada. `configuracion` se deja
-- pública a propósito: el navegador sí la lee para mostrar el WhatsApp de contacto.
-- ==============================================================================

DROP POLICY IF EXISTS "colegios_public_select" ON public.colegios;
DROP POLICY IF EXISTS "eventos_public_select" ON public.eventos;

-- Sin políticas para anon/authenticated y con RLS activo, esos roles no ven ninguna fila.
ALTER TABLE IF EXISTS public.colegios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eventos ENABLE ROW LEVEL SECURITY;

-- Defensa adicional: aunque en el futuro alguien vuelva a crear una política pública de lectura
-- sobre `colegios`, el código secreto del padrón no queda legible para los roles públicos.
REVOKE SELECT ON public.colegios FROM anon, authenticated;
