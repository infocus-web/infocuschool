-- Número de pedido amigable (IFS-AAAA-NNNN) único a nivel base: dos compras simultáneas no pueden
-- quedar con el mismo número (el servidor reintenta con otro número si choca).
drop index if exists public.idx_pedidos_pedido_friendly_id;
create unique index if not exists pedidos_pedido_friendly_id_unico on public.pedidos (pedido_friendly_id) where pedido_friendly_id is not null;
