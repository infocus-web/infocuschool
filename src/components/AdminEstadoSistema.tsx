import { useCallback, useEffect, useState } from 'react';
import { Activity, RefreshCw } from 'lucide-react';
import { fetchAdminAutenticado } from '../services/adminAuthService';

interface EstadoSalud {
  pagadosSinHD: number;
  pagadosSinEmail: number;
  transferenciasPendientes: number;
  consultasNuevas: number;
  erroresNuevos: number;
  tareas: { nombre: string; ultima_ejecucion: string; resultado: any }[];
}

interface ReporteError {
  id: string;
  codigo: string;
  created_at: string;
  origen: string;
  mensaje: string;
  email_contacto: string | null;
  url: string | null;
  detalle: any;
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
  const [verErrores, setVerErrores] = useState(false);
  // Auditoría 2026-09-26 ("reducirlo al mínimo"): si todo está en orden se muestra UNA sola pastilla;
  // las 7 se ven sólo si algo requiere atención o si se tocan para desplegarlas.
  const [verTodo, setVerTodo] = useState(false);
  const [reportes, setReportes] = useState<ReporteError[]>([]);
  const [reporteAbierto, setReporteAbierto] = useState<string | null>(null);

  const cargarReportes = useCallback(async () => {
    try {
      const res = await fetchAdminAutenticado('/api/admin/errores');
      const data = await res.json();
      if (res.ok && data.success) setReportes(Array.isArray(data.reportes) ? data.reportes : []);
    } catch {
      /* se reintenta con el botón de actualizar */
    }
  }, []);

  const resolver = async (id: string) => {
    try {
      const res = await fetchAdminAutenticado(`/api/admin/errores/${encodeURIComponent(id)}/resolver`, { method: 'POST' });
      if (res.ok) {
        setReportes((prev) => prev.filter((r) => r.id !== id));
        setEstado((prev) => (prev ? { ...prev, erroresNuevos: Math.max(0, prev.erroresNuevos - 1) } : prev));
      }
    } catch {
      /* sin conexión: queda como estaba */
    }
  };

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
        erroresNuevos: Number(data.erroresNuevos) || 0,
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
        { etiqueta: 'Comprobantes por revisar', valor: String(estado.transferenciasPendientes), ok: estado.transferenciasPendientes === 0, tab: 'pedidos', ayuda: 'Transferencias con comprobante subido por la familia, esperando que lo revises ("Ver comprobante") y toques "Aprobar Pago".' },
        { etiqueta: 'Errores reportados', valor: String(estado.erroresNuevos), ok: estado.erroresNuevos === 0, ayuda: 'Avisos que mandaron familias (o vos) con el botón "Avisar al equipo técnico". Tocá para ver el detalle.' },
        { etiqueta: 'Consultas nuevas', valor: String(estado.consultasNuevas), ok: estado.consultasNuevas === 0, tab: 'consultas', ayuda: 'Consultas de familias sin leer.' },
        { etiqueta: 'Control de pagos', valor: conciliacion.texto, ok: conciliacion.minutos <= 25, ayuda: 'Revisa cada 10 minutos con Mercado Pago y Nave que ningún pago se haya perdido.' },
        { etiqueta: 'Reintento HD', valor: reintentoHD.texto, ok: reintentoHD.minutos <= 90, ayuda: 'Cada hora vuelve a armar las descargas HD y los emails que hayan fallado.' },
      ]
    : [];

  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-left text-[11px]">
      <span className="flex items-center gap-1.5 font-bold text-slate-800">
        <Activity className="h-3.5 w-3.5 text-slate-500" />
        Estado del sistema
      </span>
      {error && <span className="font-semibold text-rose-700">No se pudo leer el estado.</span>}
      {estado && !verTodo && items.every((item) => item.ok) && (
        <button
          type="button"
          onClick={() => setVerTodo(true)}
          title={items.map((item) => `${item.etiqueta}: ${item.valor}`).join(' · ')}
          className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-800 cursor-pointer"
        >
          ✓ Todo en orden
        </button>
      )}
      {items.filter((item) => verTodo || !items.every((i) => i.ok) ? verTodo || !item.ok : false).map((item) => (
        <button
          key={item.etiqueta}
          type="button"
          title={item.ayuda}
          onClick={() => {
            if (item.etiqueta === 'Errores reportados') {
              setVerErrores((v) => !v);
              void cargarReportes();
            } else if (item.tab) onIrA?.(item.tab);
          }}
          className={`rounded-full border px-2 py-0.5 font-semibold ${item.tab || item.etiqueta === 'Errores reportados' ? 'cursor-pointer' : 'cursor-default'} ${
            item.ok ? 'border-emerald-200 bg-emerald-50 text-emerald-800' : 'border-amber-300 bg-amber-50 text-amber-900'
          }`}
        >
          {item.ok ? '✓' : '!'} {item.etiqueta}: {item.valor}
        </button>
      ))}
      {estado && (verTodo || !items.every((item) => item.ok)) && (
        <button type="button" onClick={() => setVerTodo((v) => !v)} className="font-semibold text-slate-400 hover:text-slate-700 hover:underline cursor-pointer">
          {verTodo ? 'ocultar' : 'ver todo'}
        </button>
      )}
      <button type="button" onClick={() => { void cargar(); if (verErrores) void cargarReportes(); }} disabled={cargando} className="ml-auto rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer" aria-label="Actualizar estado">
        <RefreshCw className={`h-3.5 w-3.5 ${cargando ? 'animate-spin' : ''}`} />
      </button>
      {verErrores && (
        <div className="basis-full space-y-1.5 border-t border-slate-100 pt-2">
          {reportes.length === 0 ? (
            <p className="text-slate-500">No hay errores reportados sin resolver.</p>
          ) : (
            reportes.map((r) => (
              <div key={r.id} className="rounded-xl border border-amber-200 bg-amber-50/60 px-2.5 py-1.5">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono font-bold text-slate-800">{r.codigo}</span>
                  <span className="text-slate-500">{haceCuanto(r.created_at).texto} · {r.origen === 'admin' ? 'panel' : 'familia'}{r.email_contacto ? ` · ${r.email_contacto}` : ''}</span>
                  <span className="basis-full text-slate-800">{r.mensaje}</span>
                  <button type="button" onClick={() => setReporteAbierto((a) => (a === r.id ? null : r.id))} className="font-semibold text-sky-700 hover:underline cursor-pointer">
                    {reporteAbierto === r.id ? 'Ocultar detalle' : 'Ver detalle'}
                  </button>
                  <button type="button" onClick={() => void resolver(r.id)} className="font-semibold text-emerald-700 hover:underline cursor-pointer">
                    Marcar resuelto
                  </button>
                </div>
                {reporteAbierto === r.id && (
                  <pre className="mt-1.5 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg bg-white p-2 text-[10px] text-slate-700">
                    {JSON.stringify({ url: r.url, ...r.detalle }, null, 2)}
                  </pre>
                )}
              </div>
            ))
          )}
          <p className="text-[10px] text-slate-400">Pasale el código a Claude para que lo revise: el detalle ya trae la pantalla, el pedido y la respuesta del servidor.</p>
        </div>
      )}
    </div>
  );
}
