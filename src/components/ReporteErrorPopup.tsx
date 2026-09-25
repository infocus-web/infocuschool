import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, CheckCircle2, Loader2, Send, X } from 'lucide-react';
import {
  PedidoDeReporte,
  emailConocidoParaReporte,
  enviarReporteDeError,
  escucharPedidosDeReporte,
  esPanelAdminAbierto,
} from '../services/reporteErrores';

// Después de cerrar un aviso, no se vuelve a abrir otro enseguida (un error que se repite en cada
// consulta automática no debe tapar la pantalla una y otra vez).
const PAUSA_TRAS_CERRAR_MS = 60_000;

/**
 * Aviso "Algo no salió bien" con el botón "Avisar al equipo técnico" (ver reporteErrores.ts).
 * Va montado una sola vez en App, por encima de todos los modales.
 */
export default function ReporteErrorPopup() {
  const [pedido, setPedido] = useState<PedidoDeReporte | null>(null);
  const [email, setEmail] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [codigo, setCodigo] = useState<string | null>(null);
  const [errorEnvio, setErrorEnvio] = useState<string | null>(null);
  const cerradoEnRef = useRef(0);

  useEffect(
    () =>
      escucharPedidosDeReporte((nuevo) => {
        setPedido((actual) => {
          if (actual) return actual; // ya hay uno abierto: se queda ese (el detalle viaja igual en "eventos")
          if (Date.now() - cerradoEnRef.current < PAUSA_TRAS_CERRAR_MS) return null;
          setEmail(emailConocidoParaReporte());
          setCodigo(null);
          setErrorEnvio(null);
          return nuevo;
        });
      }),
    []
  );

  if (!pedido) return null;

  const cerrar = () => {
    cerradoEnRef.current = Date.now();
    setPedido(null);
  };

  const enviar = async () => {
    setEnviando(true);
    setErrorEnvio(null);
    const res = await enviarReporteDeError({ mensaje: pedido.mensaje, detalle: pedido.detalle, email: email.trim() });
    setEnviando(false);
    if (res.success) setCodigo(res.codigo || 'enviado');
    else setErrorEnvio('No pudimos mandar el aviso. Revisá tu conexión y probá de nuevo.');
  };

  return (
    <div role="alertdialog" aria-modal="true" aria-labelledby="reporte-error-titulo" className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="relative w-full max-w-sm rounded-2xl bg-white p-5 text-left shadow-2xl">
        <button type="button" onClick={cerrar} aria-label="Cerrar" className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700 cursor-pointer">
          <X className="h-4 w-4" />
        </button>

        {codigo ? (
          <div className="space-y-3 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <h2 id="reporte-error-titulo" className="text-lg font-extrabold text-slate-900">¡Gracias por avisar!</h2>
            <p className="text-sm text-slate-600">
              Nuestro equipo técnico ya recibió el aviso con todos los datos del problema y lo está revisando.
              {email.trim() ? ' Te escribimos apenas esté resuelto.' : ''}
            </p>
            <p className="text-xs text-slate-400">Número de aviso: {codigo}</p>
            <button type="button" onClick={cerrar} className="w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 cursor-pointer">
              Cerrar
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <AlertTriangle className="h-6 w-6 shrink-0 text-amber-500" />
              <h2 id="reporte-error-titulo" className="text-lg font-extrabold text-slate-900">{pedido.titulo || 'Algo no salió bien'}</h2>
            </div>
            {esPanelAdminAbierto() ? (
              <>
                <p className="text-sm text-slate-600">El servidor respondió con un error. Mandá el aviso y queda registrado con todo el detalle.</p>
                <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500">{pedido.mensaje}</p>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                Hubo un problema de nuestro lado. Tocá el botón y le avisamos a nuestro equipo técnico con todos los datos para solucionarlo.
              </p>
            )}
            {!emailConocidoParaReporte() && (
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Tu email (opcional, para avisarte)"
                className="w-full rounded-xl border border-slate-300 px-3 py-2 text-sm"
              />
            )}
            {errorEnvio && <p className="text-xs font-semibold text-rose-700">{errorEnvio}</p>}
            <button
              type="button"
              onClick={() => void enviar()}
              disabled={enviando}
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-4 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-300 disabled:opacity-60 cursor-pointer"
            >
              {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {enviando ? 'Enviando…' : 'Avisar al equipo técnico'}
            </button>
            <button type="button" onClick={cerrar} className="w-full text-center text-xs font-semibold text-slate-500 hover:text-slate-800 cursor-pointer">
              Ahora no
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
