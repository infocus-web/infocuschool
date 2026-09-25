-- Organización de pedidos desde el panel (pedido de Pablo, 25/9):
-- "archivado": el pedido sale de las listas del panel y del laboratorio, pero no se borra (se
--   puede desarchivar). Para pedidos viejos, de prueba o reembolsados.
-- "en_espera" + "nota_espera": el pedido queda visible con una etiqueta y una nota, pero no pasa
--   a producción ni se cuenta para revelado mientras esté en espera.
-- Ninguno de los dos cambia lo que la familia ve en el portal.
alter table public.pedidos
  add column if not exists archivado boolean not null default false,
  add column if not exists en_espera boolean not null default false,
  add column if not exists nota_espera text;
