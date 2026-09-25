-- Comprobante de transferencia subido por la familia desde la web (pedido de Pablo 25/9).
alter table public.pedidos add column if not exists comprobante_path text;
alter table public.pedidos add column if not exists comprobante_subido_at timestamptz;
-- Bucket privado: solo el servidor (Service Role) sube y genera links temporales para el panel.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('comprobantes', 'comprobantes', false, 8388608, array['image/jpeg','image/png','image/webp','image/heic','image/heif','application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
