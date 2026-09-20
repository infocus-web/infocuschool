/**
 * Servicio de integración con Nave (Banco Galicia) — Checkout de pago
 */

export interface DatosIntencionNave {
  pedidoId: string;
  kitId: string;
  kitNombre: string;
  alumnoNombre: string;
  colegioNombre: string;
  // El servidor recalcula el monto real a partir de kitId + carpetasExtras
  // (mismo criterio que Mercado Pago) — nunca se confía en un monto del cliente.
  carpetasExtras?: number;
  // Auditoría 2026-09-19: ver comentario equivalente en mercadoPagoService.ts
  // (DatosPreferenciaMercadoPago) — mismo criterio, servidor recalcula el total.
  cantidadFotosSueltas?: number;
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
}

export interface RespuestaIntencionNave {
  success: boolean;
  checkoutUrl?: string;
  qrData?: string;
  naveId?: string;
  notConfigured?: boolean;
  error?: string;
}

/**
 * Solicita al servidor Express la creación de una intención de pago en Nave
 */
export async function crearIntencionPagoNave(
  datos: DatosIntencionNave
): Promise<RespuestaIntencionNave> {
  try {
    const res = await fetch('/api/nave/crear-intencion', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(datos),
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.error('Error al solicitar intención de pago de Nave:', err);
    return {
      success: false,
      error: err?.message || 'Error de red al conectar con Nave',
    };
  }
}

export interface ItemIntencionNave {
  pedidoId: string;
  kitId: string;
  kitNombre: string;
  alumnoNombre: string;
  colegioNombre: string;
  carpetasExtras?: number;
  // Auditoría 2026-09-19: ver comentario equivalente en DatosIntencionNave.
  cantidadFotosSueltas?: number;
}

export interface DatosIntencionNaveMultiple {
  grupoPagoId: string;
  items: ItemIntencionNave[];
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
}

/**
 * Auditoría 2026-09-16 (carrito multi-hijo, "un solo pago"): equivalente a
 * crearIntencionPagoNave, pero pide UNA sola intención con un producto de línea por cada hijo
 * del carrito, dentro de la misma transacción — Nave cobra el total combinado en un único
 * checkout. Ver /api/nave/crear-intencion-multiple en el servidor.
 */
export async function crearIntencionPagoNaveMultiple(
  datos: DatosIntencionNaveMultiple
): Promise<RespuestaIntencionNave> {
  try {
    const res = await fetch('/api/nave/crear-intencion-multiple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(datos),
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.error('Error al solicitar intención de pago combinada de Nave:', err);
    return {
      success: false,
      error: err?.message || 'Error de red al conectar con Nave',
    };
  }
}
