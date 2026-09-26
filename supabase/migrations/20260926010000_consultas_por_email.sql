-- Consultas de familias que llegan por email (pedido 26/9): id del correo en Resend para no
-- registrar dos veces el mismo correo si Resend reintenta el aviso.
alter table public.consultas_familias add column if not exists resend_email_id text;
create unique index if not exists consultas_familias_resend_email_id_unico on public.consultas_familias (resend_email_id) where resend_email_id is not null;
