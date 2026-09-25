import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { fetchAdminAutenticado } from '../services/adminAuthService';

interface EstadoSalud {
  pagadosSinHD: number;
  pagadosSinEmail: number;
  transferenciasPendientes: number;
  consultasNuevas: number;
  tareas: { nombre: string; ultima_ejecucion: string; resultado: any }[];
}

function haceCuanto(iso?: string): { texto: string; minutos: number } {
  if (!iso) return { texto: 'nunca', minutos: Infinity };
  const minutos = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (minutos < 1) return { texto: 'recién', minutos };
  if (minutos < 60) return { texto: `hace ${minutos} min`, minutos };
  const horas = Math.round(minutos / 60);
  return { texto: `hace ${horas} h`, minutos };
}

/**
 * "Estado del sistema" (preparación temporada 25/9, ~1300 familias): una fila compacta arriba del
 * panel con lo que puede necesitar atención. Verde = todo bien; ámbar = hay algo para mirar.
 * Se actualiza sola cada minuto mientras el panel está abierto.
 */
export default function AdminEstadoSistema({ onIrA }: { onIrA?: (tab: 'pedidos' | 'laboratorio' | 'consultas') => void }) {
  const [estado, setEstado] = useState<EstadoSalud | null>(null);
  const [error, setError] = useState(false);
  const [cargando, setCargando] = useState(false);

  const cargar = useCallback(async () => {
    setCargando(true);
    try {
      const res = await fetchAdminAutenticado('/api/admin/salud');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error();
      // Defensivo: si falta algún campo, el panel no se cae (se muestra 0 / "nunca").
      setEstado({
        pagadosSinHD: Number(data.pagadosSinHD) || 0,
        pagadosSinEmail: Number(data.pagadosSinEmail) || 0,
        transferenciasPendientes: Number(data.transferenciasPendientes) || 0,
        consultasNuevas: Number(data.consultasNuevas) || 0,
        tareas: Array.isArray(data.tareas) ? data.tareas : [],
      });
      setError(false);
    } catch {
      setError(true);
    } finally {
      setCargando(false);
    }
  }, []);

  useEffect(() => {
    void cargar();
    const intervalo = window.setInterval(() => void cargar(), 60000);
    return () => window.clearInterval(intervalo);
  }, [cargar]);

  const tarea = (nombre: string) => estado?.tareas.find((t) => t.nombre === nombre);
  const conciliacion = haceCuanto(tarea('conciliar-pagos')?.ultima_ejecucion);
  const reintentoHD = haceCuanto(tarea('reintentar-hd')?.ultima_ejecucion);

  const items: { etiqueta: string; valor: string; ok: boolean; tab?: 'pedidos' | 'laboratorio' | 'consultas'; ayuda: string }[] = estado
    ? [
        { etiqueta: 'Pagos sin descarga HD', valor: String(estado.pagadosSinHD), ok: estado.pagadosSinHD === 0, tab: 'laboratorio', ayuda: 'Pedidos pagados cuyo .zip HD todavía no se armó. Se reintenta solo cada hora; si persiste, revisá que estén las fotos del curso.' },
        { etiqueta: 'Emails sin enviar', valor: String(estado.pagadosSinEmail), ok: estado.pagadosSinEmail === 0, tab: 'laboratorio', ayuda: 'Pedidos pagados cuyo email con las fotos no salió. Se reintenta solo cada hora.' },
        { etiqueta: 'Transferencias por aprobar', valor: String(estado.transferenciasPendientes), ok: estado.transferenciasPendientes === 0, tab: 'pedidos', ayuda: 'Pedidos por transferencia esperando que confirmes el comprobante con "Aprobar Pago".' },
        { etiqueta: 'Consultas nuevas', valor: String(estado.consultasNuevas), ok: estado.consultasNuevas === 0, tab: 'consultas', ayuda: 'Consultas de familias sin leer.' },
        { etiqueta: 'Control de pagos', valor: conciliacion.texto, ok: conciliacion.minutos <= 25, ayuda: 'Revisa cada 10 minutos con Mercado Pago y Nave que ningún pago se haya perdido.' },
        { etiqueta: 'Reintento HD', valor: reintentoHD.texto, ok: reintentoHD.minutos <= 90, ayuda: 'Cada hora vuelve a armar las descargas HD y los emails que hayan fallado.' },
      ]
    : [];

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-slate-200 bg-white px-3 py-2 text-left text-[11px]">
      <span className="flex items-center gap-1.5 font-bold text-slate-800">
        <Activity className="h-3.5 w-3.5 text-slate-500" />
        Estado del sistema
      </span>
      {error && <span className="font-semibold text-rose-700">No se pudo leer el estado.</span>}
      {items.map((item) => (
        <button
          key={item.etiqueta}
          type="button"
          title={item.ayuda}
          onClick={() => item.tab && onIrA?.(item.tab)}
          className={`rounded-full border px-2 py-0.5 font-semibold ${item.tab ? 'cursor-pointer' : 'cursor-default'} ${
            item.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {item.ok ? '✓' : '!'} {item.etiqueta}: {item.valor}
        </button>
      ))}
      <button type="button" onClick={() => void cargar()} disabled={cargando} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer" aria-label="Actualizar estado">
        <RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} />
      </button>
    </div>
  );
}
