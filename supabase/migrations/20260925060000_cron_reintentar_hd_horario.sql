-- Reintento de .zip HD + correo cada hora (antes sólo una vez por día con el cron de Vercel).
select cron.unschedule('reintentar-hd') where exists (select 1 from cron.job where jobname = 'reintentar-hd');
select cron.schedule(
  'reintentar-hd',
  '5 * * * *',
  $$select net.http_post(
      url := 'https://www.retratoescolar.com.ar/api/cron/reintentar-hd',
      headers := jsonb_build_object('Authorization', 'Bearer ' || (select secreto from public.tareas_programadas_secreto where id = 1), 'Content-Type', 'application/json'),
      body := '{}'::jsonb,
      timeout_milliseconds := 55000
    )$$
);
