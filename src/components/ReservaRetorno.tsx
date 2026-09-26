import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, X, XCircle } from 'lucide-react';
import { volvioSinPagar } from '../utils/pagoRetorno';
import { crearPreferenciaMercadoPagoMultiple } from '../services/mercadoPagoService';
import { crearIntencionPagoNaveMultiple } from '../services/naveService';
import { urlEstadoPedido } from '../utils/accesoPedido';

interface Props {
  grupoPagoId: string;
  onCerrar: () => void;
  /** Reabre el portal (reserva) para elegir otro medio de pago. */
  onElegirOtroMedio?: () => void;
}

type Estado = 'consultando' | 'aprobado' | 'pendiente' | 'rechazado' | 'error';

/**
 * Pantalla de vuelta de Mercado Pago / Nave después de pagar un kit por adelantado. Consulta el
 * estado real del pago en el servidor (unas cuantas veces, porque la confirmación de la pasarela
 * puede demorar unos segundos) y le explica a la familia qué sigue.
 */
export default function ReservaRetorno({ grupoPagoId, onCerrar, onElegirOtroMedio }: Props) {
  const [estado, setEstado] = useState<Estado>('consultando');
  // Volvió de Mercado Pago sin pagar ("Volver a la tienda"): se consulta una sola vez por las dudas
  // y, si no está aprobado, se dice claramente que el pago no se hizo (antes esperaba 1 minuto y
  // mostraba "Tu pago se está procesando", aunque no hubiera ningún pago).
  const [sinPago] = useState(() => (typeof window !== 'undefined' ? volvioSinPagar(window.location.search) : false));
  const [pedido, setPedido] = useState('');
  const [metodoPago, setMetodoPago] = useState<string>('');
  const [reintentando, setReintentando] = useState(false);
  const [errorReintento, setErrorReintento] = useState('');

  // "Volver a intentar": vuelve directo a la pasarela con el mismo medio de pago. El servidor cobra
  // lo registrado para este grupo, así que alcanza con el grupoPagoId.
  const reintentar = async () => {
    setReintentando(true);
    setErrorReintento('');
    const datos = { grupoPagoId, items: [], tutorNombre: '', tutorEmail: '' };
    const pago = metodoPago === 'nave' ? await crearIntencionPagoNaveMultiple(datos) : await crearPreferenciaMercadoPagoMultiple(datos);
    const url = 'checkoutUrl' in pago ? pago.checkoutUrl : 'initPoint' in pago ? pago.initPoint : undefined;
    if (pago.success && url) {
      window.location.href = url;
      return;
    }
    setReintentando(false);
    setErrorReintento(pago.error || 'No se pudo volver a abrir el pago. Probá con otro medio.');
  };

  useEffect(() => {
    let cancelado = false;
    let intentos = 0;
    const consultar = async () => {
      intentos += 1;
      try {
        const res = await fetch(urlEstadoPedido(grupoPagoId));
        const data = await res.json();
        if (cancelado) return;
        if (data?.pedidoFriendlyId) setPedido(data.pedidoFriendlyId);
        if (data?.metodoPago) setMetodoPago(data.metodoPago);
        if (data?.estadoPago === 'aprobado') return setEstado('aprobado');
        if (data?.estadoPago === 'rechazado' || sinPago) return setEstado('rechazado');
        if (intentos >= 12) return setEstado('pendiente');
      } catch {
        if (intentos >= 12) return setEstado('error');
      }
      setTimeout(() => {
        if (!cancelado) void consultar();
      }, 5000);
    };
    void consultar();
    return () => {
      cancelado = true;
    };
  }, [grupoPagoId, sinPago]);

  return (
    <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4">
      <div className="relative w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-xl">
        <button type="button" onClick={onCerrar} className="absolute right-3 top-3 rounded-lg p-1 text-slate-400 hover:bg-slate-100" aria-label="Cerrar">
          <X className="h-5 w-5" />
        </button>
        {estado === 'consultando' && (
          <>
            <Loader2 className="mx-auto h-10 w-10 animate-spin text-amber-500" />
            <p className="mt-3 font-bold text-slate-900">Confirmando tu pago…</p>
            <p className="mt-1 text-sm text-slate-500">Esto puede tardar unos segundos.</p>
          </>
        )}
        {estado === 'aprobado' && (
          <>
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <p className="mt-3 text-lg font-extrabold text-slate-900">¡Reserva confirmada!</p>
            <p className="mt-2 text-sm text-slate-600">
              Tu kit {pedido ? <>(pedido <strong>{pedido}</strong>) </> : null}ya está pagado. Te mandamos la confirmación por email.
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Cuando estén las fotos, entrá a <strong>Acceder a las Fotos</strong>, elegí las 3 que más te gusten y tocá <strong>Confirmar mis fotos</strong>. No vas a tener que volver a pagar.
            </p>
          </>
        )}
        {(estado === 'pendiente' || estado === 'error') && (
          <>
            <Clock className="mx-auto h-12 w-12 text-amber-500" />
            <p className="mt-3 text-lg font-extrabold text-slate-900">Todavía no vemos tu pago</p>
            <p className="mt-2 text-sm text-slate-600">Si lo completaste, puede tardar unos minutos: apenas se acredite te llega un email con la confirmación de tu reserva. Si no llegaste a pagar, podés volver a intentarlo.</p>
          </>
        )}
        {estado === 'rechazado' && (
          <>
            <XCircle className="mx-auto h-12 w-12 text-red-500" />
            <p className="mt-3 text-lg font-extrabold text-slate-900">El pago no se completó</p>
            <p className="mt-2 text-sm text-slate-600">No se te cobró nada. Podés volver a intentarlo cuando quieras, con el mismo u otro medio de pago.</p>
          </>
        )}
        {errorReintento && <p className="mt-3 text-xs font-semibold text-red-600">{errorReintento}</p>}
        {estado === 'rechazado' || estado === 'pendiente' || estado === 'error' ? (
          <div className="mt-5 flex flex-col gap-2">
            {metodoPago !== 'transferencia' && (
              <button
                type="button"
                onClick={() => void reintentar()}
                disabled={reintentando}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300 disabled:opacity-60"
              >
                {reintentando && <Loader2 className="h-4 w-4 animate-spin" />}
                Volver a intentar{metodoPago === 'nave' ? ' con Nave' : metodoPago === 'mercadopago' ? ' con Mercado Pago' : ''}
              </button>
            )}
            {onElegirOtroMedio && (
              <button type="button" onClick={onElegirOtroMedio} disabled={reintentando} className="rounded-xl border border-slate-300 bg-white px-5 py-2.5 text-sm font-bold text-slate-800 hover:bg-slate-50">
                Elegir otro medio de pago
              </button>
            )}
            <button type="button" onClick={onCerrar} disabled={reintentando} className="rounded-xl px-5 py-2 text-sm font-semibold text-slate-500 hover:text-slate-800">
              Cerrar
            </button>
          </div>
        ) : (
          <button type="button" onClick={onCerrar} className="mt-5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
            Entendido
          </button>
        )}
      </div>
    </div>
  );
}
