import { guardarLlavePedido } from '../utils/accesoPedido';
/**
 * Pago anticipado: la familia paga el kit antes de que estén las fotos de su curso y las elige
 * después, sin volver a pagar. Ver "PAGO ANTICIPADO" en server.ts.
 */

export type KitReserva = 'kit-clasico' | 'kit-digital';

export const KITS_RESERVA: { id: KitReserva; nombre: string; precio: number; detalle: string }[] = [
  { id: 'kit-clasico', nombre: 'Kit Impreso + Digital', precio: 30000, detalle: 'Carpeta con las 3 fotos impresas + las 3 en digital HD' },
  { id: 'kit-digital', nombre: 'Solo Digital HD', precio: 15000, detalle: 'Las 3 fotos en digital HD, sin impresión' },
];

export interface ReservaPendiente {
  id: string;
  pedidoFriendlyId: string;
  kitNombre: string;
  total: number;
  pagada: boolean;
  metodoPago?: string;
}

export async function crearReserva(datos: {
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
  metodoPago: 'mercadopago' | 'nave' | 'transferencia';
  items: { codigoSeccion: string; alumnoNombre: string; kitId: KitReserva }[];
  /** Sumar la reserva a una compra ya registrada (mismo pago), en vez de crear un pago aparte. */
  grupoPagoId?: string;
}): Promise<{ success: boolean; grupoPagoId?: string; total?: number; pedidoFriendlyIds?: string[]; error?: string }> {
  try {
    const res = await fetch('/api/reservas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await res.json();
    if (!res.ok || !data.success) return { success: false, error: data.error || 'No se pudo registrar la reserva.' };
    guardarLlavePedido([data.grupoPagoId], data.accesoToken);
    return data;
  } catch {
    return { success: false, error: 'Error de conexión. Revisá tu internet e intentá de nuevo.' };
  }
}

/** Reserva del alumno (si hay) y si su curso ya tiene fotos online (entonces no se puede reservar). */
export async function obtenerEstadoReserva(
  codigoSeccion: string,
  alumnoNombre: string
): Promise<{ ok: boolean; reserva: ReservaPendiente | null; fotosDisponibles: boolean; tienePedidoPagado: boolean }> {
  if (!codigoSeccion || !alumnoNombre) return { ok: false, reserva: null, fotosDisponibles: false, tienePedidoPagado: false };
  try {
    const params = new URLSearchParams({ codigo: codigoSeccion, alumnoNombre });
    const res = await fetch(`/api/reservas/pendiente?${params.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) return { ok: false, reserva: null, fotosDisponibles: false, tienePedidoPagado: false };
    return {
      ok: true,
      reserva: (data.reserva as ReservaPendiente) || null,
      fotosDisponibles: Boolean(data.fotosDisponibles),
      tienePedidoPagado: Boolean(data.tienePedidoPagado),
    };
  } catch {
    return { ok: false, reserva: null, fotosDisponibles: false, tienePedidoPagado: false };
  }
}

export async function obtenerReservaPendiente(codigoSeccion: string, alumnoNombre: string): Promise<ReservaPendiente | null> {
  return (await obtenerEstadoReserva(codigoSeccion, alumnoNombre)).reserva;
}

export async function elegirFotosDeReserva(
  reservaId: string,
  codigoSeccion: string,
  fotos: { grupalId: string; individualId: string; docenteId: string }
): Promise<{ success: boolean; pedidoFriendlyId?: string; error?: string }> {
  try {
    const res = await fetch(`/api/reservas/${encodeURIComponent(reservaId)}/elegir-fotos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: codigoSeccion, fotos }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) return { success: false, error: data.error || 'No se pudo guardar tu elección.' };
    return data;
  } catch {
    return { success: false, error: 'Error de conexión. Revisá tu internet e intentá de nuevo.' };
  }
}

/** Kit reservado que se suma a la compra de un hermano con fotos (se paga todo junto). */
export interface ReservaParaSumar {
  hijoId: string;
  nombreCompleto: string;
  codigoSeccion: string;
  kitId: KitReserva;
  kitNombre: string;
  precio: number;
}
