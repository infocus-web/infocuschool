-- Consultas de familias: nuevo estado "archivada" para sacar de la bandeja las conversaciones
-- terminadas sin borrarlas (como "Archivar" en Gmail). Si la familia vuelve a responder, el
-- webhook de Resend la pasa a "nueva" y reaparece en la bandeja.
alter table public.consultas_familias drop constraint if exists consultas_familias_estado_check;
alter table public.consultas_familias
  add constraint consultas_familias_estado_check
  check (estado = any (array['nueva'::text, 'en_proceso'::text, 'resuelta'::text, 'archivada'::text]));
