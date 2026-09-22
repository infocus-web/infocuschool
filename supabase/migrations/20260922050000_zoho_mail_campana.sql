-- Integración con Zoho Mail (OAuth2) para la campaña de prospección a colegios desde el
-- Panel de Fotógrafos, agregada el 22/9/2026 después de que el Mail Merge nativo de la
-- interfaz web de Zoho fallara ("Disculpas: Algo salió mal") tanto con la cuenta principal
-- (ventas@contacto.retratoescolar.com.ar) como con el alias colegios@ — el bloqueo resultó
-- ser de toda la cuenta, no de un alias puntual, así que la campaña se manda por la API REST
-- de Zoho Mail en vez de por esa función de la interfaz.

-- Fila única con los tokens OAuth de la cuenta de Zoho conectada. El truco "id boolean
-- primary key default true" + el check de abajo garantiza que nunca pueda haber más de una
-- fila (solo existe el valor `true` como clave posible), que es justo lo que necesitamos:
-- una sola cuenta de Zoho conectada a la vez.
create table if not exists public.zoho_oauth_tokens (
  id boolean primary key default true,
  access_token text not null,
  refresh_token text not null,
  account_id text not null,
  api_domain text not null default 'https://mail.zoho.com',
  cuenta_email text,
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint zoho_oauth_tokens_singleton check (id)
);

alter table public.zoho_oauth_tokens enable row level security;
revoke all on table public.zoho_oauth_tokens from public, anon, authenticated;
grant all on table public.zoho_oauth_tokens to service_role;

comment on table public.zoho_oauth_tokens is
  'Tokens OAuth2 de la cuenta de Zoho Mail conectada para la campaña de prospección a colegios. Fila única (id siempre true). Solo se lee/escribe desde el servidor con la service role key.';

-- Registro de cada correo de la campaña (de prueba o real) — sirve tanto de bitácora/auditoría
-- como de mecanismo de "no duplicar": antes de mandarle un correo real a una institución se
-- chequea acá si ya se le mandó uno exitoso, para no reescribir a la misma escuela dos veces
-- si Pablo corta y repite el envío a mitad de camino.
create table if not exists public.zoho_campana_envios (
  id uuid primary key default gen_random_uuid(),
  destinatario_email text not null,
  institucion text,
  asunto text not null,
  tipo text not null check (tipo in ('prueba', 'real')),
  estado text not null check (estado in ('enviado', 'error')),
  zoho_message_id text,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists zoho_campana_envios_destinatario_idx
  on public.zoho_campana_envios (destinatario_email, tipo, estado);

create index if not exists zoho_campana_envios_created_at_idx
  on public.zoho_campana_envios (created_at desc);

alter table public.zoho_campana_envios enable row level security;
revoke all on table public.zoho_campana_envios from public, anon, authenticated;
grant all on table public.zoho_campana_envios to service_role;

comment on table public.zoho_campana_envios is
  'Bitácora de correos enviados (de prueba o reales) por la campaña de prospección a colegios vía la API de Zoho Mail. Se usa también para no reenviar dos veces a la misma institución.';
