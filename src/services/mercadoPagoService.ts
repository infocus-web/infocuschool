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
  total: number;
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
