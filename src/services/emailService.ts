/**
 * Servicio de envío automático de correos con enlaces HD y comprobantes vía Resend
 */

export interface DatosEnvioFotosHD {
  to: string;
  tutorNombre?: string;
  alumnoNombre: string;
  colegioNombre: string;
  cursoCodigo: string;
  pedidoId: string;
  kitNombre: string;
  total: number;
  linkDescargaHD: string;
  whatsappContacto?: string;
  esImpreso?: boolean;
}

// Alias para compatibilidad
export type EnviarFotosEmailParams = DatosEnvioFotosHD;

export interface RespuestaEnvioEmail {
  success: boolean;
  messageId?: string;
  from?: string;
  warning?: string;
  error?: string;
  simulated?: boolean;
}

export interface EstadoResend {
  configured: boolean;
  fromEmail: string;
  maskedKey: string | null;
  domain: string;
}

/**
 * Consulta el estado de configuración de Resend en el servidor
 */
export async function consultarEstadoResend(): Promise<EstadoResend> {
  try {
    const res = await fetch('/api/resend/status');
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }
    return await res.json();
  } catch {
    return {
      configured: false,
      fromEmail: 'Retrato Escolar <fotos@retratoescolar.com.ar>',
      maskedKey: null,
      domain: 'retratoescolar.com.ar'
    };
  }
}

/**
 * Envía automáticamente las fotografías en HD y el comprobante por correo a la familia
 */
export async function enviarFotosPorEmail(datos: DatosEnvioFotosHD): Promise<RespuestaEnvioEmail> {
  try {
    if (!datos.to || !datos.to.includes('@')) {
      return { success: false, error: 'Email inválido o vacío' };
    }

    const res = await fetch('/api/enviar-fotos-hd', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(datos)
    });

    const data = await res.json();
    return data;
  } catch (error: any) {
    console.warn('Fallo al contactar el servicio de email:', error);
    return {
      success: false,
      error: error?.message || 'Error de red al intentar enviar el correo'
    };
  }
}

/**
 * Envía un correo de prueba a una casilla para verificar que el dominio retratoescolar.com.ar funcione
 */
export async function enviarEmailPruebaResend(emailDestino: string): Promise<RespuestaEnvioEmail> {
  try {
    const res = await fetch('/api/resend/test', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ to: emailDestino })
    });

    const data = await res.json();
    return data;
  } catch (error: any) {
    return {
      success: false,
      error: error?.message || 'Error al conectar con el servidor de pruebas'
    };
  }
}
