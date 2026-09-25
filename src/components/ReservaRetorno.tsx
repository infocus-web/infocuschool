import { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Loader2, X, XCircle } from 'lucide-react';
import { volvioSinPagar } from '../utils/pagoRetorno';

interface Props {
  grupoPagoId: string;
  onCerrar: () => void;
  /** Reabre el portal para volver a intentar el pago. */
  onReintentar?: () => void;
}

type Estado = 'consultando' | 'aprobado' | 'pendiente' | 'rechazado' | 'error';

/**
 * Pantalla de vuelta de Mercado Pago / Nave después de pagar un kit por adelantado. Consulta el
 * estado real del pago en el servidor (unas cuantas veces, porque la confirmación de la pasarela
 * puede demorar unos segundos) y le explica a la familia qué sigue.
 */
export default function ReservaRetorno({ grupoPagoId, onCerrar, onReintentar }: Props) {
  const [estado, setEstado] = useState<Estado>('consultando');
  // Volvió de Mercado Pago sin pagar ("Volver a la tienda"): se consulta una sola vez por las dudas
  // y, si no está aprobado, se dice claramente que el pago no se hizo (antes esperaba 1 minuto y
  // mostraba "Tu pago se está procesando", aunque no hubiera ningún pago).
  const [sinPago] = useState(() => (typeof window !== 'undefined' ? volvioSinPagar(window.location.search) : false));
  const [pedido, setPedido] = useState('');

  useEffect(() => {
    let cancelado = false;
    let intentos = 0;
    const consultar = async () => {
      intentos += 1;
      try {
        const res = await fetch(`/api/pedidos/${encodeURIComponent(grupoPagoId)}/status`);
        const data = await res.json();
        if (cancelado) return;
        if (data?.pedidoFriendlyId) setPedido(data.pedidoFriendlyId);
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
        <div className="mt-5 flex flex-col-reverse sm:flex-row justify-center gap-2">
          <button type="button" onClick={onCerrar} className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-bold text-white hover:bg-slate-800">
            {estado === 'consultando' || estado === 'aprobado' ? 'Entendido' : 'Cerrar'}
          </button>
          {onReintentar && (estado === 'rechazado' || estado === 'pendiente' || estado === 'error') && (
            <button type="button" onClick={onReintentar} className="rounded-xl bg-amber-400 px-5 py-2.5 text-sm font-bold text-slate-950 hover:bg-amber-300">
              Volver a intentar
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
