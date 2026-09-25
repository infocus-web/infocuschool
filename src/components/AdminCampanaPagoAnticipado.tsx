import { useState } from 'react';
import { CalendarCheck, Eye, Loader2, Send, X } from 'lucide-react';
import { fetchAdminAutenticado } from '../services/adminAuthService';

interface VistaPrevia {
  pendientes: number;
  yaEnviados: number;
  asunto: string;
  html: string;
}

/**
 * Pedido de Pablo (25/9): un único email a las familias ya inscriptas cuyos hijos están en cursos
 * que todavía no tienen fotos, contándoles que pueden dejar el kit pago por adelantado. Primero se
 * ve cuántas familias lo recibirían y el email de ejemplo; se envía sólo al confirmar. El servidor
 * registra a quién ya se le mandó, así nunca se repite (ver /api/admin/campanas/pago-anticipado).
 */
export default function AdminCampanaPagoAnticipado() {
  const [vista, setVista] = useState<VistaPrevia | null>(null);
  const [cargando, setCargando] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cargarVistaPrevia = async () => {
    setCargando(true);
    setMensaje(null);
    try {
      const res = await fetchAdminAutenticado('/api/admin/campanas/pago-anticipado');
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo armar la vista previa.');
      setVista({ pendientes: data.pendientes, yaEnviados: data.yaEnviados, asunto: data.asunto, html: data.html });
    } catch (e: any) {
      setMensaje({ tipo: 'error', texto: e?.message || 'Error de conexión.' });
    } finally {
      setCargando(false);
    }
  };

  const enviar = async () => {
    if (!vista || vista.pendientes === 0) return;
    if (!window.confirm(`¿Enviar el aviso de pago anticipado a ${vista.pendientes} familia${vista.pendientes === 1 ? '' : 's'}?\n\nSe manda una sola vez a cada una.`)) return;
    setEnviando(true);
    setMensaje(null);
    try {
      const res = await fetchAdminAutenticado('/api/admin/campanas/pago-anticipado/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirmar: true }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'No se pudo enviar.');
      setMensaje({
        tipo: data.fallidos > 0 ? 'error' : 'ok',
        texto: `Enviados: ${data.enviados}.${data.fallidos > 0 ? ` Fallaron ${data.fallidos} (podés volver a tocar "Enviar": sólo se reintentan esos).` : ''}`,
      });
      setVista(null);
    } catch (e: any) {
      setMensaje({ tipo: 'error', texto: e?.message || 'Error de conexión.' });
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div className="mb-4 p-4 rounded-2xl border border-amber-300 bg-amber-50/70 text-left">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5">
          <CalendarCheck className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-bold text-slate-900">Avisar a las familias que pueden pagar por adelantado</p>
            <p className="text-[11px] text-slate-600">
              Un único email a las familias inscriptas cuyos hijos todavía no tienen fotos online (salteando a quienes ya reservaron). Primero lo revisás; no sale nada hasta que confirmes.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => void cargarVistaPrevia()}
          disabled={cargando || enviando}
          className="inline-flex items-center justify-center gap-1.5 px-3.5 py-2 rounded-xl bg-white border border-amber-300 hover:bg-amber-100 text-amber-900 text-xs font-bold disabled:opacity-50 cursor-pointer shrink-0"
        >
          {cargando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
          Ver email y destinatarios
        </button>
      </div>

      {mensaje && (
        <p className={`mt-3 text-xs font-semibold ${mensaje.tipo === 'ok' ? 'text-emerald-700' : 'text-rose-700'}`}>{mensaje.texto}</p>
      )}

      {vista && (
        <div className="mt-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-slate-700">
              Lo recibirían <strong>{vista.pendientes}</strong> familia{vista.pendientes === 1 ? '' : 's'}
              {vista.yaEnviados > 0 && <> · ya se les envió a {vista.yaEnviados}</>}
              . Asunto de ejemplo: <em>{vista.asunto}</em>
            </p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => setVista(null)} className="p-2 rounded-lg text-slate-500 hover:bg-white cursor-pointer" aria-label="Cerrar vista previa">
                <X className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => void enviar()}
                disabled={enviando || vista.pendientes === 0}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-extrabold disabled:opacity-50 cursor-pointer"
              >
                {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {vista.pendientes === 0 ? 'No hay familias pendientes' : `Enviar a ${vista.pendientes} familias`}
              </button>
            </div>
          </div>
          <iframe title="Vista previa del email" srcDoc={vista.html} sandbox="" className="w-full h-[520px] rounded-xl border border-slate-200 bg-white" />
        </div>
      )}
    </div>
  );
}
