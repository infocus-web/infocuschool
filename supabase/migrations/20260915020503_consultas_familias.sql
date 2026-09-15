create table if not exists public.consultas_familias (
  id uuid primary key default gen_random_uuid(),
  nombre text not null check (char_length(nombre) between 2 and 120),
  email text not null check (char_length(email) between 5 and 254),
  telefono text,
  colegio text,
  numero_pedido text,
  asunto text not null check (char_length(asunto) between 2 and 160),
  mensaje text not null check (char_length(mensaje) between 5 and 3000),
  estado text not null default 'nueva' check (estado in ('nueva', 'en_proceso', 'resuelta')),
  origen text not null default 'web' check (origen in ('web', 'email')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists consultas_familias_estado_created_at_idx
  on public.consultas_familias (estado, created_at desc);

alter table public.consultas_familias enable row level security;

revoke all on table public.consultas_familias from public, anon, authenticated;
grant all on table public.consultas_familias to service_role;

comment on table public.consultas_familias is
  'Consultas recibidas desde la web y, en una etapa posterior, desde Resend Inbound.';
