create table if not exists public.consultas_familias_mensajes (
  id uuid primary key default gen_random_uuid(),
  consulta_id uuid not null references public.consultas_familias(id) on delete cascade,
  direccion text not null check (direccion in ('saliente', 'entrante')),
  remitente text not null,
  destinatario text not null,
  asunto text,
  contenido text not null check (char_length(contenido) between 1 and 10000),
  resend_email_id text unique,
  created_at timestamptz not null default now()
);

create index if not exists consultas_familias_mensajes_consulta_created_at_idx
  on public.consultas_familias_mensajes (consulta_id, created_at asc);

alter table public.consultas_familias_mensajes enable row level security;

revoke all on table public.consultas_familias_mensajes from public, anon, authenticated;
grant all on table public.consultas_familias_mensajes to service_role;

comment on table public.consultas_familias_mensajes is
  'Historial privado de respuestas enviadas y recibidas para consultas de familias.';
