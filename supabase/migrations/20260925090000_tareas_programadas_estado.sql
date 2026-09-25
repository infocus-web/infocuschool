-- Última corrida de cada tarea programada (control de pagos, reintento HD), para el recuadro
-- "Estado del sistema" del panel.
create table if not exists public.tareas_programadas_estado (
  nombre text primary key,
  ultima_ejecucion timestamptz not null default now(),
  resultado jsonb
);
alter table public.tareas_programadas_estado enable row level security;
revoke all on public.tareas_programadas_estado from anon, authenticated;
