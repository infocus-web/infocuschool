-- Registro de envíos de campañas por email a familias (p. ej. el aviso de pago anticipado del 25/9):
-- una fila por campaña y email, para que ningún envío se repita. Sólo la usa el servidor.
create table if not exists public.envios_campana_familias (
  campana text not null,
  email text not null,
  enviado_at timestamptz not null default now(),
  primary key (campana, email)
);
alter table public.envios_campana_familias enable row level security;
revoke all on public.envios_campana_familias from anon, authenticated;
