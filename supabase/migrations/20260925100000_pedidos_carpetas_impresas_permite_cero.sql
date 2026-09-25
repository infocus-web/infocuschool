-- Caso real 25/9: desde el 24/9 el servidor guarda carpetas_impresas = 0 para el kit Solo Digital
-- (no lleva carpeta impresa), pero la restricción exigía >= 1 y TODA compra Solo Digital fallaba
-- al registrarse ("violates check constraint pedidos_carpetas_impresas_check").
alter table public.pedidos drop constraint if exists pedidos_carpetas_impresas_check;
alter table public.pedidos add constraint pedidos_carpetas_impresas_check check (carpetas_impresas >= 0);
