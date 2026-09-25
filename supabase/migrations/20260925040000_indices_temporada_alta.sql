-- Preparación para la temporada (25/9, ~1300 familias): índices para las búsquedas más frecuentes
-- (pedidos por curso, reservas pendientes, pagos por id de pasarela, fotos por curso).
create index if not exists idx_pedidos_colegio_curso on public.pedidos (colegio_id, curso_codigo);
create index if not exists idx_pedidos_created_at on public.pedidos (created_at desc);
create index if not exists idx_pedidos_mp_preference on public.pedidos (mp_preference_id) where mp_preference_id is not null;
create index if not exists idx_pedidos_mp_payment on public.pedidos (mp_payment_id) where mp_payment_id is not null;
create index if not exists idx_pedidos_nave_request on public.pedidos (nave_payment_request_id) where nave_payment_request_id is not null;
create index if not exists idx_pedidos_pendientes_reserva on public.pedidos (colegio_id, curso_codigo) where seleccion_pendiente = true;
create index if not exists idx_fotos_colegio_curso on public.fotos (colegio_id, codigo_curso);
create index if not exists idx_inscripciones_estado_colegio on public.inscripciones (estado, colegio_id);
create index if not exists idx_familias_email on public.familias (lower(email));
