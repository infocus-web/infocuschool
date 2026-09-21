import { useEffect, useState, FormEvent } from 'react';
import { Loader2, X, Printer, CheckCircle2, Check, PackageCheck, AlertTriangle } from 'lucide-react';
import {
  loginAdminConServidor,
  verificarSesionAdmin,
} from '../services/adminAuthService';
import {
  obtenerResumenPedidoEscaneo,
  ResumenPedidoEscaneo,
} from '../services/escaneoPedidoService';
import { enviarActualizacionPedidos, TipoActualizacionPedido } from '../services/emailService';
import { marcarPedidoRetirado } from '../services/pedidosLabService';

interface EscaneoPedidoModalProps {
  pedidoId: string;
  onClose: () => void;
}

/**
 * Auditoría 2026-09-21 (pedido de Pablo: "poder escanear el sobre con la cámara del celular al
 * volver del laboratorio, y que me salte el nombre del alumno para avisarle a la familia que
 * puede retirar el pedido"). Esta pantalla es a donde apunta el QR que se pega en cada sobre
 * físico (ver /api/admin/pedidos/:id/qr y el botón QR en AdminLaboratorioTab.tsx) — vive fuera
 * del panel completo a propósito, para que abrir un solo pedido desde el celular sea instantáneo
 * en vez de tener que cargar y filtrar la tabla entera de pedidos en una pantalla chica.
 *
 * Requiere sesión de admin (mismo PIN que el panel completo): si el celular todavía no tiene un
 * token guardado (o venció, dura 24hs), pide el PIN una sola vez — a partir de ahí el token queda
 * en localStorage de ese celular (ver adminAuthService.ts) y los escaneos siguientes ya entran
 * derecho, sin volver a pedirlo, hasta que venza o Pablo cierre sesión a mano.
 */
export default function EscaneoPedidoModal({ pedidoId, onClose }: EscaneoPedidoModalProps) {
  const [verificandoSesion, setVerificandoSesion] = useState(true);
  const [autenticado, setAutenticado] = useState(false);
  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  const [cargando, setCargando] = useState(false);
  const [pedido, setPedido] = useState<ResumenPedidoEscaneo | null>(null);
  const [errorCarga, setErrorCarga] = useState<string | null>(null);

  const [enviando, setEnviando] = useState(false);
  const [mensaje, setMensaje] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const cargarPedido = async () => {
    setCargando(true);
    setErrorCarga(null);
    const resultado = await obtenerResumenPedidoEscaneo(pedidoId);
    setCargando(false);
    if (resultado.requiereLogin) {
      setAutenticado(false);
      return;
    }
    if (!resultado.success || !resultado.pedido) {
      setErrorCarga(resultado.error || 'No se pudo cargar el pedido.');
      return;
    }
    setPedido(resultado.pedido);
  };

  useEffect(() => {
    verificarSesionAdmin().then((valida) => {
      setVerificandoSesion(false);
      setAutenticado(valida);
      if (valida) cargarPedido();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pedidoId]);

  const handleLogin = async (e: FormEvent) => {
    e.preventDefault();
    const clean = pin.trim();
    if (!clean) {
      setPinError('Ingresá el PIN de acceso.');
      return;
    }
    setIsLoggingIn(true);
    setPinError('');
    const res = await loginAdminConServidor(clean);
    setIsLoggingIn(false);
    if (res.success) {
      setPin('');
      setAutenticado(true);
      cargarPedido();
    } else {
      setPinError(res.error || 'PIN incorrecto.');
    }
  };

  const handleAvisar = async (tipo: TipoActualizacionPedido) => {
    if (!pedido) return;
    if (!pedido.tutorEmail?.includes('@')) {
      setMensaje({ tipo: 'error', texto: 'Este pedido no tiene un email válido cargado — avisá manualmente desde el panel completo.' });
      return;
    }
    setEnviando(true);
    setMensaje(null);
    const resultado = await enviarActualizacionPedidos(tipo, [{
      pedidoId: pedido.id,
      pedidoFriendlyId: pedido.pedidoFriendlyId || undefined,
      to: pedido.tutorEmail,
      tutorNombre: pedido.tutorNombre || '',
      alumnoNombre: pedido.alumnoNombre || '',
      colegioNombre: pedido.colegioNombre || '',
    }]);
    setEnviando(false);
    if (resultado.success && resultado.enviados > 0) {
      setMensaje({ tipo: 'ok', texto: tipo === 'listo_retiro' ? '✅ Aviso de "Listo para retirar" enviado.' : '✅ Aviso de "En producción" enviado.' });
      setPedido({ ...pedido, estadoLab: tipo });
    } else {
      setMensaje({ tipo: 'error', texto: resultado.error || resultado.errores?.[0] || 'No se pudo enviar el aviso.' });
    }
  };

  const handleMarcarRetirado = async () => {
    if (!pedido) return;
    setEnviando(true);
    setMensaje(null);
    const resultado = await marcarPedidoRetirado(pedido.id);
    setEnviando(false);
    if (resultado.success) {
      setMensaje({ tipo: 'ok', texto: '✅ Marcado como retirado.' });
      setPedido({ ...pedido, estadoLab: 'entregado', fechaEntregado: resultado.fechaEntregado || pedido.fechaEntregado });
    } else {
      setMensaje({ tipo: 'error', texto: resultado.error || 'No se pudo marcar el pedido como retirado.' });
    }
  };

  return (
    <div className="fixed inset-0 z-[100] bg-slate-950 flex flex-col">
      <div className="flex items-center justify-between px-4 py-3 border-b border-slate-800">
        <p className="text-white font-bold text-sm">Escaneo de pedido</p>
        <button type="button" onClick={onClose} className="text-slate-400 hover:text-white p-1 cursor-pointer">
          <X className="w-6 h-6" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-5 flex flex-col items-center justify-center">
        {verificandoSesion ? (
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        ) : !autenticado ? (
          <form onSubmit={handleLogin} className="w-full max-w-xs bg-slate-900 rounded-2xl p-5 border border-slate-800">
            <p className="text-white font-bold text-sm mb-1">Ingresá tu PIN</p>
            <p className="text-slate-400 text-xs mb-4">Hace falta una sola vez por celular — después queda logueado.</p>
            <input
              type="password"
              inputMode="numeric"
              autoFocus
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              placeholder="PIN de fotógrafo"
              className="w-full px-3 py-3 rounded-xl bg-slate-800 border border-slate-700 text-white text-center text-lg tracking-widest mb-2"
            />
            {pinError && <p className="text-xs text-rose-400 font-semibold mb-2">{pinError}</p>}
            <button
              type="submit"
              disabled={isLoggingIn}
              className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
            >
              {isLoggingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : null}
              Entrar
            </button>
          </form>
        ) : cargando ? (
          <Loader2 className="w-8 h-8 text-slate-500 animate-spin" />
        ) : errorCarga ? (
          <div className="text-center max-w-xs">
            <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto mb-2" />
            <p className="text-white font-semibold text-sm">{errorCarga}</p>
          </div>
        ) : pedido ? (
          <div className="w-full max-w-xs bg-slate-900 rounded-2xl p-5 border border-slate-800 text-center">
            <p className="text-white font-extrabold text-lg leading-tight">{pedido.alumnoNombre}</p>
            <p className="text-slate-400 text-xs mt-0.5">{pedido.colegioNombre}</p>
            <p className="text-slate-500 text-xs">{pedido.grado} "{pedido.division}" · Turno {pedido.turno}</p>
            {pedido.pedidoFriendlyId && (
              <p className="text-slate-600 text-[10px] font-mono mt-1">{pedido.pedidoFriendlyId}</p>
            )}

            <div className="my-4 h-px bg-slate-800" />

            {mensaje && (
              <p className={`text-xs font-semibold mb-3 ${mensaje.tipo === 'ok' ? 'text-emerald-400' : 'text-rose-400'}`}>
                {mensaje.texto}
              </p>
            )}

            {pedido.estadoLab === 'entregado' ? (
              <div className="flex flex-col items-center gap-1.5 text-emerald-400">
                <PackageCheck className="w-8 h-8" />
                <p className="text-sm font-bold">Ya fue retirado</p>
                {pedido.fechaEntregado && <p className="text-[11px] text-slate-500">{pedido.fechaEntregado.split('T')[0]}</p>}
              </div>
            ) : pedido.estadoLab === 'listo_retiro' ? (
              <button
                type="button"
                onClick={handleMarcarRetirado}
                disabled={enviando}
                className="w-full py-3.5 rounded-xl bg-slate-900 border-2 border-emerald-600 hover:bg-emerald-950 disabled:opacity-50 text-emerald-400 font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
                Marcar retirado
              </button>
            ) : pedido.estadoLab === 'en_produccion' ? (
              <button
                type="button"
                onClick={() => handleAvisar('listo_retiro')}
                disabled={enviando}
                className="w-full py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                Avisar "Listo para retirar"
              </button>
            ) : (
              <button
                type="button"
                onClick={() => handleAvisar('en_produccion')}
                disabled={enviando}
                className="w-full py-3.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold text-sm flex items-center justify-center gap-2 cursor-pointer"
              >
                {enviando ? <Loader2 className="w-4 h-4 animate-spin" /> : <Printer className="w-4 h-4" />}
                Avisar "En producción"
              </button>
            )}
          </div>
        ) : null}
      </div>
    </div>
  );
}
