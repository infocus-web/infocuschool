/**
 * Servicio de envío automático de correos con enlaces HD y comprobantes vía Resend
 */
import { fetchAdminAutenticado } from './adminAuthService';

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

export type TipoActualizacionPedido = 'en_produccion' | 'listo_retiro';

export interface DestinatarioActualizacionPedido {
  // Auditoría 2026-09-18 (reporte de Pablo): "pedidoId" tiene que seguir siendo el UUID real de
  // Supabase porque el servidor lo usa para encontrar la fila (.eq('id', pedidoId)) — pero ese
  // mismo valor se estaba mostrando tal cual en el email al cliente ("Pedido: ef97bafb-6f4b-..."),
  // en vez del número de pedido legible (IFS-2026-XXXX) que se usa en todos los demás correos.
  // Se agrega "pedidoFriendlyId" aparte, solo para mostrar, sin tocar el que usa la búsqueda.
  pedidoId: string;
  pedidoFriendlyId?: string;
  to: string;
  tutorNombre: string;
  alumnoNombre: string;
  colegioNombre: string;
}

export interface ResultadoActualizacionPedidos {
  success: boolean;
  enviados: number;
  fallidos: number;
  errores?: string[];
  error?: string;
}

export async function enviarActualizacionPedidos(
  tipo: TipoActualizacionPedido,
  destinatarios: DestinatarioActualizacionPedido[]
): Promise<ResultadoActualizacionPedidos> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/pedidos/notificar-estado', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ tipo, destinatarios }),
    });
    const data = await res.json();
    if (!res.ok) {
      return { success: false, enviados: 0, fallidos: destinatarios.length, error: data.error || 'No se pudieron enviar los emails.' };
    }
    return data;
  } catch (error: any) {
    return { success: false, enviados: 0, fallidos: destinatarios.length, error: error?.message || 'Error de red al enviar los emails.' };
  }
}

/**
 * Consulta el estado de configuración de Resend en el servidor. Requiere sesión de
 * administrador desde la auditoría 2026-09-09 (revisión a fondo): esta ruta devolvía un
 * fragmento real de la clave de Resend a cualquier visitante, sin pedir ningún login.
 */
export async function consultarEstadoResend(): Promise<EstadoResend> {
  try {
    const res = await fetchAdminAutenticado('/api/resend/status');
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

    // Requiere sesión de administrador desde este momento (ver server.ts): esta ruta solo la
    // usa el panel admin para reenviar el correo de fotos HD manualmente.
    const res = await fetchAdminAutenticado('/api/enviar-fotos-hd', {
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
    // Requiere sesión de administrador desde este momento (ver server.ts): es una herramienta
    // de diagnóstico del panel, no algo que deba poder disparar cualquier visitante.
    const res = await fetchAdminAutenticado('/api/resend/test', {
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
