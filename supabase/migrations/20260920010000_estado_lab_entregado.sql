-- Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo): el paso final del
-- pipeline de laboratorio ("la familia ya retiró su pedido en el colegio") no tenía ninguna
-- columna propia para registrarse. El único lugar que lo modelaba era el valor 'entregado' de la
-- columna de PAGO "estado" (pedidos_estado_check) — mezclando "¿se cobró?" con "¿se entregó
-- físicamente?" en el mismo campo. Además, ningún botón del panel llegó a escribir nunca ese
-- valor: es un estado que existía en el esquema pero que la aplicación jamás usaba.
--
-- Se formaliza "estado_lab" como la única fuente de verdad del pipeline físico
-- (null -> en_produccion -> listo_retiro -> entregado), separado de "estado" (que sigue
-- siendo pura y exclusivamente el estado del pago: pendiente_pago | pagado | cancelado).
--
-- Verificado antes de aplicar (2026-09-20): no hay ninguna fila con estado = 'entregado' en
-- producción todavía, así que no hace falta backfill de datos existentes.

alter table public.pedidos
  drop constraint if exists pedidos_estado_lab_check;

alter table public.pedidos
  add constraint pedidos_estado_lab_check
  check (estado_lab is null or estado_lab = any (array['en_produccion'::text, 'listo_retiro'::text, 'entregado'::text]));

alter table public.pedidos
  add column if not exists fecha_entregado timestamptz null;

comment on column public.pedidos.fecha_entregado is 'Fecha en que se confirmó que la familia retiró el pedido en el colegio (estado_lab = entregado). Se graba una sola vez, no se pisa en reenvíos.';
