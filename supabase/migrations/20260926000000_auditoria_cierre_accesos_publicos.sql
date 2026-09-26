-- ==============================================================================
-- Auditoría 2026-09-26 — cierre de accesos públicos (hallazgos A3 y listado de fotos-web)
--
-- 1) `colegios` y `eventos` seguían legibles COMPLETOS con la clave pública del sitio: la migración
--    20260924000000_cerrar_lectura_publica_colegios.sql nunca se había aplicado en la base real.
--    Con eso se leía `colegios.codigo_padron` (el código secreto del link de autocarga del padrón)
--    → cualquiera podía cargarse en el padrón → aprobación automática → código del curso → galería.
--    La web no lee estas tablas desde el navegador (usa GET /api/colegios con la Service Role Key).
--
-- 2) Los roles públicos (anon/authenticated) tenían privilegios de sobra (INSERT/UPDATE/DELETE/
--    TRUNCATE) sobre varias tablas. Hoy RLS los frenaba, pero era la ÚNICA barrera: una política
--    mal creada en el futuro los habilitaba de golpe. El navegador sólo necesita LEER
--    `configuracion` (WhatsApp de contacto); todo lo demás pasa por el servidor.
--
-- 3) La política "Permitir lectura publica fotos-web" (SELECT en storage.objects) permitía LISTAR
--    todos los archivos del bucket público con la clave pública: los nombres con sufijo al azar no
--    servían de nada, se podían bajar todas las muestras y miniaturas de todos los cursos sin
--    ningún código. Un bucket público sirve sus archivos por URL SIN necesitar esa política, así que
--    se borra: la galería sigue funcionando igual (usa las URLs que devuelve /api/fotos).
-- ==============================================================================

-- 1) colegios / eventos
DROP POLICY IF EXISTS "colegios_public_select" ON public.colegios;
DROP POLICY IF EXISTS "eventos_public_select" ON public.eventos;
ALTER TABLE IF EXISTS public.colegios ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.eventos ENABLE ROW LEVEL SECURITY;

-- 2) Privilegios mínimos para los roles públicos
DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('REVOKE ALL ON public.%I FROM anon, authenticated', t.tablename);
  END LOOP;
END $$;
GRANT SELECT ON public.configuracion TO anon, authenticated;

-- Tablas que se creen en el futuro tampoco nacen con permisos para los roles públicos.
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES FROM anon, authenticated;

-- 3) fotos-web: sin listado público (las URLs públicas siguen funcionando)
DROP POLICY IF EXISTS "Permitir lectura publica fotos-web" ON storage.objects;

-- Bucket viejo "fotos" (vacío, sin uso): deja de ser público.
UPDATE storage.buckets SET public = false WHERE id = 'fotos';

-- 4) Registro de aprobaciones manuales de pago desde el panel (hallazgo B2)
ALTER TABLE public.pedidos ADD COLUMN IF NOT EXISTS aprobado_manual_at timestamptz;
