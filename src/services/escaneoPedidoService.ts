/**
 * Auditoría 2026-09-21 (pedido de Pablo: escanear con el celular un QR impreso en el sobre
 * físico del laboratorio, que abra directo el pedido y deje avisar "Listo para retirar" o
 * "Marcar retirado" sin buscarlo a mano en el panel completo). Servicio liviano para la vista de
 * un solo pedido — ver EscaneoPedidoModal.tsx y /api/admin/pedidos/:id/resumen en server.ts.
 */
import { fetchAdminAutenticado } from './adminAuthService';

export type EtapaLabEscaneo = 'en_produccion' | 'listo_retiro' | 'entregado' | null;

export interface ResumenPedidoEscaneo {
  id: string;
  pedidoFriendlyId: string | null;
  alumnoNombre: string | null;
  colegioNombre: string | null;
  grado: string | null;
  division: string | null;
  turno: string | null;
  estado: string | null;
  estadoLab: EtapaLabEscaneo;
  fechaEnvioProduccion: string | null;
  fechaEnvioListoRetiro: string | null;
  fechaEntregado: string | null;
  tutorNombre: string | null;
  tutorEmail: string | null;
  tutorWhatsapp: string | null;
}

export interface ResultadoResumenEscaneo {
  success: boolean;
  pedido?: ResumenPedidoEscaneo;
  requiereLogin?: boolean;
  error?: string;
}

export async function obtenerResumenPedidoEscaneo(pedidoSupabaseId: string): Promise<ResultadoResumenEscaneo> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/pedidos/${encodeURIComponent(pedidoSupabaseId)}/resumen`);
    if (res.status === 401) {
      return { success: false, requiereLogin: true };
    }
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo cargar el pedido.' };
    }
    return { success: true, pedido: data.pedido };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al cargar el pedido.' };
  }
}
