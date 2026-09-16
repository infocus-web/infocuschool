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
