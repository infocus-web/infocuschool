-- Pago anticipado ("reservá tu kit ahora, elegí las fotos después"): un pedido que la familia paga
-- antes de que existan las fotos de su curso. Nace sin fotos elegidas y con seleccion_pendiente =
-- true; cuando se suben las fotos, la familia las elige desde el portal sin volver a pagar y recién
-- ahí se genera el .zip HD y el pedido pasa al laboratorio.
alter table public.pedidos
  add column if not exists seleccion_pendiente boolean not null default false;
