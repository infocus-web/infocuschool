import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, CreditCard, Loader2, Sparkles } from 'lucide-react';
import { crearReserva, KITS_RESERVA, obtenerReservaPendiente, type KitReserva, type ReservaPendiente } from '../services/reservasService';
import { crearPreferenciaMercadoPagoMultiple } from '../services/mercadoPagoService';
import { crearIntencionPagoNaveMultiple } from '../services/naveService';

interface HijoReserva {
  id: string;
  nombreCompleto: string;
  codigoSeccion: string;
}

interface Props {
  hijos: HijoReserva[];
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
}

type Metodo = 'mercadopago' | 'nave' | 'transferencia';

/**
 * Pago anticipado (pedido de Pablo, 24/9: "muchos padres están acostumbrados a pagar por
 * adelantado"). Se muestra mientras el curso todavía no tiene fotos: la familia elige el kit de
 * cada hijo y lo paga ya; cuando se suben las fotos, las elige sin volver a pagar.
 */
export default function ReservaKitAnticipada({ hijos, tutorNombre, tutorEmail, tutorTelefono }: Props) {
  const [kits, setKits] = useState<Record<string, KitReserva | ''>>({});
  const [reservas, setReservas] = useState<Record<string, ReservaPendiente | null>>({});
  const [email, setEmail] = useState(tutorEmail);
  const [metodo, setMetodo] = useState<Metodo>('mercadopago');
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [transferencia, setTransferencia] = useState<{ total: number; pedidos: string[] } | null>(null);

  useEffect(() => setEmail((actual) => actual || tutorEmail), [tutorEmail]);

  // Clave estable: el portal re-renderiza seguido y arma un array nuevo cada vez.
  const claveHijos = hijos.map((h) => `${h.id}|${h.codigoSeccion}|${h.nombreCompleto}`).join(';');
  useEffect(() => {
    let cancelado = false;
    Promise.all(hijos.map(async (h) => [h.id, await obtenerReservaPendiente(h.codigoSeccion, h.nombreCompleto)] as const)).then((pares) => {
      if (cancelado) return;
      setReservas(Object.fromEntries(pares));
      setKits((prev) => {
        const nuevo = { ...prev };
        for (const [id, reserva] of pares) if (!reserva?.pagada && nuevo[id] === undefined) nuevo[id] = 'kit-clasico';
        return nuevo;
      });
    });
    return () => {
      cancelado = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [claveHijos]);

  // Reserva por transferencia todavía sin confirmar: se muestra como "esperando tu transferencia"
  // (para que no la paguen dos veces), con la opción de pagarla con otro medio.
  const [reabiertos, setReabiertos] = useState<Record<string, boolean>>({});
  const esperandoTransferencia = (id: string) => {
    const r = reservas[id];
    return Boolean(r && !r.pagada && r.metodoPago === 'transferencia' && !reabiertos[id]);
  };
  const hijosSinReservaPagada = hijos.filter((h) => !reservas[h.id]?.pagada && !esperandoTransferencia(h.id));
  const elegidos = hijosSinReservaPagada.filter((h) => kits[h.id]);
  const total = useMemo(
    () => elegidos.reduce((acc, h) => acc + (KITS_RESERVA.find((k) => k.id === kits[h.id])?.precio || 0), 0),
    [elegidos, kits]
  );

  const pagar = async () => {
    setError('');
    if (elegidos.length === 0) return setError('Elegí el kit de al menos uno de los chicos.');
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return setError('Ingresá un email válido para recibir la confirmación.');
    setEnviando(true);
    const reserva = await crearReserva({
      tutorNombre,
      tutorEmail: email.trim(),
      tutorTelefono,
      metodoPago: metodo,
      items: elegidos.map((h) => ({ codigoSeccion: h.codigoSeccion, alumnoNombre: h.nombreCompleto, kitId: kits[h.id] as KitReserva })),
    });
    if (!reserva.success || !reserva.grupoPagoId) {
      setEnviando(false);
      return setError(reserva.error || 'No se pudo registrar la reserva.');
    }
    if (metodo === 'transferencia') {
      setEnviando(false);
      setTransferencia({ total: reserva.total || total, pedidos: reserva.pedidoFriendlyIds || [] });
      return;
    }
    const datosPago = { grupoPagoId: reserva.grupoPagoId, items: [], tutorNombre, tutorEmail: email.trim(), tutorTelefono };
    const pago = metodo === 'nave' ? await crearIntencionPagoNaveMultiple(datosPago) : await crearPreferenciaMercadoPagoMultiple(datosPago);
    const url = 'checkoutUrl' in pago ? pago.checkoutUrl : 'initPoint' in pago ? pago.initPoint : undefined;
    if (pago.success && url) {
      window.location.href = url;
      return;
    }
    setEnviando(false);
    setError(pago.error || 'No se pudo iniciar el pago. Intentá de nuevo o elegí otro medio.');
  };

  if (transferencia) {
    return (
      <div className="mt-6 rounded-2xl border border-emerald-200 bg-white p-5 text-left shadow-xs">
        <p className="flex items-center gap-2 font-bold text-slate-900"><CheckCircle2 className="h-5 w-5 text-emerald-600" />¡Reserva registrada!</p>
        <p className="mt-2 text-sm text-slate-600">
          Transferí <strong>${transferencia.total.toLocaleString('es-AR')}</strong> y mandá el comprobante a{' '}
          <strong>fotos@retratoescolar.com.ar</strong> indicando {transferencia.pedidos.length > 1 ? 'los pedidos' : 'el pedido'}{' '}
          <strong>{transferencia.pedidos.join(', ')}</strong>. Cuando lo confirmemos te llega un email.
        </p>
        <div className="mt-3 space-y-0.5 rounded-xl bg-slate-50 p-3 text-xs text-slate-700">
          <p><strong>Titular:</strong> Alderete Pablo Gabriel</p>
          <p><strong>CUIT:</strong> 20-28306117-6</p>
          <p><strong>Alias:</strong> <span className="font-mono font-bold">RETRATO.ESCOLAR</span></p>
          <p><strong>CBU:</strong> <span className="font-mono">0070313830004052956749</span></p>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-amber-300 bg-white p-5 text-left shadow-xs">
      <p className="flex items-center gap-2 font-['Outfit'] text-base font-extrabold text-slate-900">
        <Sparkles className="h-5 w-5 text-amber-500" />
        ¿Querés dejarlo pago? Reservá tu kit ahora
      </p>
      <p className="mt-1 text-xs text-slate-600">
        Pagás hoy y, cuando estén las fotos, elegís las que más te gusten <strong>sin volver a pagar</strong>. Apenas las confirmes te llega la descarga en alta resolución.
      </p>

      <div className="mt-4 space-y-3">
        {hijos.map((h) => {
          const reserva = reservas[h.id];
          if (reserva && esperandoTransferencia(h.id)) {
            return (
              <div key={h.id} className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-950">
                <p>
                  <strong>{h.nombreCompleto}:</strong> tu reserva del {reserva.kitNombre} ({reserva.pedidoFriendlyId}) está registrada y
                  esperamos tu transferencia de <strong>${reserva.total.toLocaleString('es-AR')}</strong> (Alias RETRATO.ESCOLAR). Mandá el
                  comprobante a fotos@retratoescolar.com.ar indicando el número de pedido; cuando lo confirmemos te llega un email.
                </p>
                <button type="button" onClick={() => setReabiertos((r) => ({ ...r, [h.id]: true }))} className="mt-2 font-bold text-amber-800 underline">
                  Prefiero pagar con otro medio
                </button>
              </div>
            );
          }
          if (reserva?.pagada) {
            return (
              <div key={h.id} className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-xs text-emerald-900">
                <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600" />
                <span><strong>{h.nombreCompleto}:</strong> {reserva.kitNombre} ya pagado ({reserva.pedidoFriendlyId}). Vas a poder elegir sus fotos cuando estén disponibles.</span>
              </div>
            );
          }
          return (
            <div key={h.id} className="rounded-xl border border-slate-200 p-3">
              <p className="mb-2 text-xs font-bold text-slate-800">{h.nombreCompleto}</p>
              <div className="grid gap-2 sm:grid-cols-3">
                {/* Pedido de Pablo (25/9): "Ahora no" elegido casi no se distinguía del fondo. Toda
                    opción elegida lleva ahora borde grueso de color y un ✓ arriba a la derecha. */}
                {KITS_RESERVA.map((kit) => (
                  <label key={kit.id} className={`relative cursor-pointer rounded-lg border-2 p-2 text-xs ${kits[h.id] === kit.id ? 'border-amber-500 bg-amber-50 ring-2 ring-amber-200' : 'border-slate-200 hover:bg-slate-50'}`}>
                    <input type="radio" className="sr-only" name={`kit-${h.id}`} checked={kits[h.id] === kit.id} onChange={() => setKits((k) => ({ ...k, [h.id]: kit.id }))} />
                    {kits[h.id] === kit.id && <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-amber-600" aria-hidden="true" />}
                    <span className="block font-bold text-slate-900">{kit.nombre}</span>
                    <span className="block font-extrabold text-amber-700">${kit.precio.toLocaleString('es-AR')}</span>
                    <span className="block text-[10px] text-slate-500">{kit.detalle}</span>
                  </label>
                ))}
                <label className={`relative cursor-pointer rounded-lg border-2 p-2 text-xs ${kits[h.id] === '' ? 'border-slate-700 bg-slate-100 ring-2 ring-slate-300' : 'border-slate-200 hover:bg-slate-50'}`}>
                  <input type="radio" className="sr-only" name={`kit-${h.id}`} checked={kits[h.id] === ''} onChange={() => setKits((k) => ({ ...k, [h.id]: '' }))} />
                  {kits[h.id] === '' && <CheckCircle2 className="absolute right-2 top-2 h-4 w-4 text-slate-700" aria-hidden="true" />}
                  <span className={`block font-bold ${kits[h.id] === '' ? 'text-slate-900' : 'text-slate-700'}`}>Ahora no</span>
                  <span className="block text-[10px] text-slate-500">
                    {kits[h.id] === '' ? 'Elegido: pagás cuando estén las fotos' : 'Elijo y pago cuando estén las fotos'}
                  </span>
                </label>
              </div>
            </div>
          );
        })}
      </div>

      {hijosSinReservaPagada.length > 0 && (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold text-slate-700">
              Email para la confirmación
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-normal" placeholder="tu@email.com" />
            </label>
            <label className="text-xs font-semibold text-slate-700">
              Medio de pago
              <select value={metodo} onChange={(e) => setMetodo(e.target.value as Metodo)} className="mt-1 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-xs font-normal">
                <option value="mercadopago">Mercado Pago (tarjeta, débito o dinero en cuenta)</option>
                <option value="nave">Nave (tarjeta)</option>
                <option value="transferencia">Transferencia bancaria</option>
              </select>
            </label>
          </div>
          {error && <p className="mt-3 text-xs font-semibold text-red-600">{error}</p>}
          <button
            type="button"
            onClick={() => void pagar()}
            disabled={enviando || elegidos.length === 0}
            className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-400 px-5 py-3 text-sm font-bold text-slate-950 shadow-md hover:bg-amber-300 disabled:cursor-not-allowed disabled:opacity-50 sm:w-auto"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <CreditCard className="h-4 w-4" />}
            {elegidos.length === 0 ? 'Elegí un kit' : `Pagar reserva · $${total.toLocaleString('es-AR')}`}
          </button>
        </>
      )}
    </div>
  );
}
