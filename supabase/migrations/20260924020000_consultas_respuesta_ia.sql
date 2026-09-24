-- Respuestas automáticas a consultas de familias: la web revisa los datos reales de la familia
-- (inscripción, nómina, código, fotos, pedidos), la IA redacta la respuesta y, si todo está OK y
-- la pregunta es sobre el funcionamiento de la página, se envía sola. Si no, queda como borrador.
alter table public.consultas_familias
  add column if not exists borrador_ia text,
  add column if not exists verificacion_ia jsonb,
  add column if not exists procesada_ia_at timestamptz;

alter table public.consultas_familias_mensajes
  add column if not exists automatica boolean not null default false;
