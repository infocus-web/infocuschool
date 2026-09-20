/**
 * Servicio de integración con Mercado Pago Checkout Pro (Servidor y Webhook)
 */

export interface DatosPreferenciaMercadoPago {
  pedidoId: string;
  kitId: string;
  kitNombre: string;
  alumnoNombre: string;
  colegioNombre: string;
  cursoCodigo: string;
  // El servidor recalcula el monto real a partir de kitId + carpetasExtras (ver auditoría
  // 2026-09-09) — "total" ya no se usa para fijar el precio, solo queda por compatibilidad
  // de tipos con el resto del flujo local; el servidor lo ignora.
  total: number;
  carpetasExtras?: number;
  // Auditoría 2026-09-19: cantidad de "Otras Fotos" (fotos sueltas del evento) elegidas — el
  // servidor la usa para recalcular el total real (ver calcularTotalPedido en server.ts). Antes
  // no se mandaba y esas fotos se mostraban como cobradas en la UI pero nunca se cobraban.
  cantidadFotosSueltas?: number;
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
}

export interface RespuestaPreferenciaMP {
  success: boolean;
  preferenceId?: string;
  initPoint?: string;
  sandboxInitPoint?: string;
  notConfigured?: boolean;
  error?: string;
}

/**
 * Solicita al servidor Express la creación de una preferencia de pago en Mercado Pago
 */
export async function crearPreferenciaMercadoPago(
  datos: DatosPreferenciaMercadoPago
): Promise<RespuestaPreferenciaMP> {
  try {
    const res = await fetch('/api/mercadopago/crear-preferencia', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(datos),
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.error('Error al solicitar preferencia de Mercado Pago:', err);
    return {
      success: false,
      error: err?.message || 'Error de red al conectar con Mercado Pago',
    };
  }
}

export interface ItemPreferenciaMercadoPago {
  pedidoId: string;
  kitId: string;
  kitNombre: string;
  alumnoNombre: string;
  colegioNombre: string;
  carpetasExtras?: number;
  // Auditoría 2026-09-19: ver comentario equivalente en DatosPreferenciaMercadoPago.
  cantidadFotosSueltas?: number;
}

export interface DatosPreferenciaMercadoPagoMultiple {
  grupoPagoId: string;
  items: ItemPreferenciaMercadoPago[];
  tutorNombre: string;
  tutorEmail: string;
  tutorTelefono?: string;
}

/**
 * Auditoría 2026-09-16 (carrito multi-hijo, "un solo pago"): equivalente a
 * crearPreferenciaMercadoPago, pero pide UNA sola preferencia con un ítem de línea por cada
 * hijo del carrito — Mercado Pago cobra el total combinado en un único checkout. Ver
 * /api/mercadopago/crear-preferencia-multiple en el servidor.
 */
export async function crearPreferenciaMercadoPagoMultiple(
  datos: DatosPreferenciaMercadoPagoMultiple
): Promise<RespuestaPreferenciaMP> {
  try {
    const res = await fetch('/api/mercadopago/crear-preferencia-multiple', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(datos),
    });

    const data = await res.json();
    return data;
  } catch (err: any) {
    console.error('Error al solicitar preferencia combinada de Mercado Pago:', err);
    return {
      success: false,
      error: err?.message || 'Error de red al conectar con Mercado Pago',
    };
  }
}
