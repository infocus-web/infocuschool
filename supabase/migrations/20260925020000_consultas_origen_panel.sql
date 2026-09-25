-- "Escribir a esta familia" desde el panel: conversaciones que inicia el fotógrafo (origen "panel").
alter table public.consultas_familias drop constraint if exists consultas_familias_origen_check;
alter table public.consultas_familias add constraint consultas_familias_origen_check check (origen = any (array['web'::text, 'email'::text, 'panel'::text]));
