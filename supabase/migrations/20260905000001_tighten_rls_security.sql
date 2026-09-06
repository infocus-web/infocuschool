-- ==============================================================================
-- MIGRACIÓN SUPABASE: BLINDAJE ROW LEVEL SECURITY (RLS)
-- Fecha: 2026-09-05
-- Propósito:
--   1. pedidos y pedido_fotos: revocar UPDATE y DELETE para el rol public / anon.
--   2. fotos: revocar INSERT, UPDATE y DELETE para el rol public / anon.
--   3. familias: restringir SELECT público para NO exponer teléfonos / WhatsApp.
-- ==============================================================================

-- 1. HABILITAR ROW LEVEL SECURITY EN TODAS LAS TABLAS
ALTER TABLE IF EXISTS public.pedidos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.pedido_fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.fotos ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.familias ENABLE ROW LEVEL SECURITY;
ALTER TABLE IF EXISTS public.alumnos ENABLE ROW LEVEL SECURITY;

-- 2. LIMPIEZA DE POLÍTICAS ANTERIORES PERMISIVAS
DROP POLICY IF EXISTS "pedidos_public_update" ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_public_delete" ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_public_insert" ON public.pedidos;
DROP POLICY IF EXISTS "pedidos_public_select" ON public.pedidos;
DROP POLICY IF EXISTS "Public full access pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Permitir todo en pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "Enable all for all users" ON public.pedidos;
DROP POLICY IF EXISTS "familias_insert_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "familias_select_propio_pedido" ON public.pedidos;
DROP POLICY IF EXISTS "public_insert_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "public_select_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "service_role_all_pedidos" ON public.pedidos;
DROP POLICY IF EXISTS "service_role_pedidos_all" ON public.pedidos;

DROP POLICY IF EXISTS "pedido_fotos_public_update" ON public.pedido_fotos;
DROP POLICY IF EXISTS "pedido_fotos_public_delete" ON public.pedido_fotos;
DROP POLICY IF EXISTS "pedido_fotos_public_insert" ON public.pedido_fotos;
DROP POLICY IF EXISTS "pedido_fotos_public_select" ON public.pedido_fotos;
DROP POLICY IF EXISTS "Public full access pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "Permitir todo en pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "Enable all for all users" ON public.pedido_fotos;
DROP POLICY IF EXISTS "familias_insert_pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "familias_select_pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "public_insert_pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "public_select_pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "service_role_all_pedido_fotos" ON public.pedido_fotos;
DROP POLICY IF EXISTS "service_role_pedido_fotos_all" ON public.pedido_fotos;

DROP POLICY IF EXISTS "fotos_public_delete" ON public.fotos;
DROP POLICY IF EXISTS "fotos_public_update" ON public.fotos;
DROP POLICY IF EXISTS "fotos_public_insert" ON public.fotos;
DROP POLICY IF EXISTS "fotos_public_select" ON public.fotos;
DROP POLICY IF EXISTS "Public full access fotos" ON public.fotos;
DROP POLICY IF EXISTS "Permitir todo en fotos" ON public.fotos;
DROP POLICY IF EXISTS "Enable all for all users" ON public.fotos;
DROP POLICY IF EXISTS "familias_select_fotos" ON public.fotos;
DROP POLICY IF EXISTS "public_select_fotos" ON public.fotos;
DROP POLICY IF EXISTS "service_role_all_fotos" ON public.fotos;
DROP POLICY IF EXISTS "service_role_fotos_all" ON public.fotos;

DROP POLICY IF EXISTS "familias_public_update" ON public.familias;
DROP POLICY IF EXISTS "familias_public_delete" ON public.familias;
DROP POLICY IF EXISTS "familias_public_insert" ON public.familias;
DROP POLICY IF EXISTS "familias_public_select" ON public.familias;
DROP POLICY IF EXISTS "Public full access familias" ON public.familias;
DROP POLICY IF EXISTS "Permitir todo en familias" ON public.familias;
DROP POLICY IF EXISTS "Enable all for all users" ON public.familias;
DROP POLICY IF EXISTS "familias_insert_registro" ON public.familias;
DROP POLICY IF EXISTS "public_insert_familias" ON public.familias;
DROP POLICY IF EXISTS "public_select_familias_safe" ON public.familias;
DROP POLICY IF EXISTS "service_role_all_familias" ON public.familias;
DROP POLICY IF EXISTS "service_role_familias_all" ON public.familias;

-- ==============================================================================
-- 3. TABLA 'pedidos'
-- - Revocar UPDATE y DELETE para roles públicos
-- - Permitir solo INSERT (familias comprando) y SELECT (ver estado propio)
-- - UPDATE y DELETE reservados exclusivamente a service_role (servidor backend)
-- ==============================================================================
REVOKE UPDATE, DELETE ON public.pedidos FROM anon, authenticated, public;

CREATE POLICY "pedidos_insert_public"
ON public.pedidos
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "pedidos_select_public"
ON public.pedidos
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "pedidos_all_service_role"
ON public.pedidos
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ==============================================================================
-- 4. TABLA 'pedido_fotos'
-- - Revocar UPDATE y DELETE para roles públicos
-- - Permitir solo INSERT (vincular fotos al pedido) y SELECT
-- - UPDATE y DELETE reservados a service_role
-- ==============================================================================
REVOKE UPDATE, DELETE ON public.pedido_fotos FROM anon, authenticated, public;

CREATE POLICY "pedido_fotos_insert_public"
ON public.pedido_fotos
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "pedido_fotos_select_public"
ON public.pedido_fotos
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "pedido_fotos_all_service_role"
ON public.pedido_fotos
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ==============================================================================
-- 5. TABLA 'fotos'
-- - Revocar INSERT, UPDATE y DELETE para roles públicos
-- - Permitir únicamente SELECT público para visualizar muestras
-- - Subida y edición de fotos reservadas a service_role
-- ==============================================================================
REVOKE INSERT, UPDATE, DELETE ON public.fotos FROM anon, authenticated, public;

CREATE POLICY "fotos_select_public"
ON public.fotos
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "fotos_all_service_role"
ON public.fotos
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);

-- ==============================================================================
-- 6. TABLA 'familias'
-- - Proteger datos de contacto (columna whatsapp / teléfono)
-- - Permitir INSERT público para registrar nuevas familias desde el portal
-- - Permitir SELECT únicamente sobre columnas no sensibles (id, colegio_id, nombre, created_at)
-- - La columna 'whatsapp' queda bloqueada para consultas anónimas o públicas
-- ==============================================================================
REVOKE ALL ON public.familias FROM anon, authenticated, public;

-- Permisos granulares de columna para anon y authenticated
GRANT INSERT ON public.familias TO anon, authenticated;
GRANT SELECT (id, colegio_id, nombre, created_at) ON public.familias TO anon, authenticated;

-- El service_role del backend retiene acceso total con WhatsApp para administración
GRANT ALL ON public.familias TO service_role;

CREATE POLICY "familias_insert_public"
ON public.familias
FOR INSERT
TO anon, authenticated
WITH CHECK (true);

CREATE POLICY "familias_select_safe_public"
ON public.familias
FOR SELECT
TO anon, authenticated
USING (true);

CREATE POLICY "familias_all_service_role"
ON public.familias
FOR ALL
TO service_role
USING (true)
WITH CHECK (true);
