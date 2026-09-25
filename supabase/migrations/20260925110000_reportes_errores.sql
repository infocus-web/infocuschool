-- Reportes de error enviados desde la web con el botón "Avisar al equipo técnico" (pedido 25/9).
-- Solo se accede con la Service Role Key desde el servidor: RLS activo y sin políticas públicas.
create table if not exists public.reportes_errores (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  codigo text not null,
  origen text not null default 'familia' check (origen in ('familia','admin')),
  mensaje text not null,
  detalle jsonb not null default '{}'::jsonb,
  url text,
  user_agent text,
  email_contacto text,
  estado text not null default 'nuevo' check (estado in ('nuevo','resuelto')),
  resuelto_at timestamptz
);
create index if not exists reportes_errores_estado_created_idx on public.reportes_errores (estado, created_at desc);
alter table public.reportes_errores enable row level security;
revoke all on public.reportes_errores from anon, authenticated;
