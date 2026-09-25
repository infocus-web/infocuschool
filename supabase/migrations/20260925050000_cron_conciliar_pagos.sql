-- Control automático de pagos cada 10 minutos (preparación temporada 25/9): pg_cron llama a
-- /api/cron/conciliar-pagos, que reconsulta a Mercado Pago / Nave los pedidos con link de pago que
-- siguen sin pagar y registra los pagos cuyo aviso se haya perdido. El secreto vive en una tabla
-- privada (sin permisos para anon/authenticated) y el servidor lo valida contra la base.
create extension if not exists pg_cron;
create extension if not exists pg_net;

create table if not exists public.tareas_programadas_secreto (
  id int primary key default 1 check (id = 1),
  secreto text not null
);
alter table public.tareas_programadas_secreto enable row level security;
revoke all on public.tareas_programadas_secreto from anon, authenticated;
insert into public.tareas_programadas_secreto (id, secreto)
values (1, encode(extensions.gen_random_bytes(32), 'hex'))
on conflict (id) do nothing;

select cron.unschedule('conciliar-pagos') where exists (select 1 from cron.job where jobname = 'conciliar-pagos');
select cron.schedule(
  'conciliar-pagos',
  '*/10 * * * *',
  $$select net.http_post(
      url := 'https://www.retratoescolar.com.ar/api/cron/conciliar-pagos',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select secreto from public.tareas_programadas_secreto where id = 1), 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    )$$
);
