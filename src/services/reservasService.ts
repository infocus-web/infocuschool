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
}

export async function crearReserva(datos: {
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
  metodoPago: 'mercadopago' | 'nave' | 'transferencia';
  items: { codigoSeccion: string; alumnoNombre: string; kitId: KitReserva }[];
}): Promise<{ success: boolean; grupoPagoId?: string; total?: number; pedidoFriendlyIds?: string[]; error?: string }> {
  try {
    const res = await fetch('/api/reservas/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await res.json();
    if (!res.ok || !data.success) return { success: false, error: data.error || 'No se pudo registrar la reserva.' };
    return data;
  } catch {
    return { success: false, error: 'Error de conexión. Revisá tu internet e intentá de nuevo.' };
  }
}

export async function obtenerReservaPendiente(codigoSeccion: string, alumnoNombre: string): Promise<ReservaPendiente | null> {
  if (!codigoSeccion || !alumnoNombre) return null;
  try {
    const params = new URLSearchParams({ codigo: codigoSeccion, alumnoNombre });
    const res = await fetch(`/api/reservas/pendiente?${params.toString()}`);
    const data = await res.json();
    return res.ok && data.success && data.reserva ? (data.reserva as ReservaPendiente) : null;
  } catch {
    return null;
  }
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
