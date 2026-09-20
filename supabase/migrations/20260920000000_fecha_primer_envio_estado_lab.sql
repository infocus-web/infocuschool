-- Auditoría 2026-09-20 (pedido de Pablo): guarda por separado la fecha del PRIMER envío de cada
-- aviso de laboratorio ("En producción" / "Listo para retirar"), sin pisarla en reenvíos.
-- estado_lab ya existía y sigue reflejando el último aviso mandado; estas dos columnas nuevas son
-- sólo para mostrar "enviado por primera vez el DD/MM" en el panel de Laboratorio, incluso si
-- después se reenvía el mismo aviso. Ver /api/admin/pedidos/notificar-estado en server.ts.
alter table public.pedidos
  add column if not exists fecha_envio_produccion timestamptz,
  add column if not exists fecha_envio_listo_retiro timestamptz;
