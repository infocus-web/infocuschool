/**
 * Servicio para las solicitudes de "no encuentro mi código de curso" que dejan las familias
 * desde el portal. Reemplaza el botón que antes abría WhatsApp directo al fotógrafo: ahora
 * la consulta queda guardada en Supabase y aparece listada en el panel admin.
 */
import { fetchAdminAutenticado } from './adminAuthService';

export interface SolicitudCodigo {
  id: string;
  nombreSolicitante: string;
  contacto: string; // WhatsApp o email que dejó la familia para que le respondan
  alumnoNombre?: string;
  colegioId?: string;
  colegioNombre?: string;
  grado?: string;
  division?: string;
  turno?: string;
  mensaje?: string;
  estado: 'pendiente' | 'atendido';
  createdAt: string;
  updatedAt: string;
}

export interface DatosSolicitudCodigo {
  nombreSolicitante: string;
  contacto: string;
  alumnoNombre?: string;
  colegioId?: string;
  colegioNombre?: string;
  grado?: string;
  division?: string;
  turno?: string;
  mensaje?: string;
}

function mapearFilaSupabaseASolicitud(row: any): SolicitudCodigo {
  return {
    id: row.id,
    nombreSolicitante: row.nombre_solicitante || '',
    contacto: row.contacto || '',
    alumnoNombre: row.alumno_nombre || undefined,
    colegioId: row.colegio_id || undefined,
    colegioNombre: row.colegio_nombre || undefined,
    grado: row.grado || undefined,
    division: row.division || undefined,
    turno: row.turno || undefined,
    mensaje: row.mensaje || undefined,
    estado: (row.estado as SolicitudCodigo['estado']) || 'pendiente',
    createdAt: row.created_at || '',
    updatedAt: row.updated_at || '',
  };
}

/** Portal público: la familia deja sus datos para que el fotógrafo le facilite el código */
export async function enviarSolicitudCodigo(
  datos: DatosSolicitudCodigo
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch('/api/solicitudes-codigo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo enviar la solicitud.' };
    }
    return { success: true };
  } catch (err: any) {
    console.error('Error al enviar solicitud de código:', err);
    return { success: false, error: 'Error de conexión con el servidor.' };
  }
}

/** Panel admin: lista las solicitudes (por defecto solo las pendientes) */
export async function obtenerSolicitudesCodigoAdmin(
  estado: 'pendiente' | 'todas' = 'pendiente'
): Promise<SolicitudCodigo[]> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/solicitudes-codigo?estado=${encodeURIComponent(estado)}`);
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return (data.solicitudes || []).map(mapearFilaSupabaseASolicitud);
  } catch (err) {
    console.error('Error al obtener solicitudes de código (admin):', err);
    return [];
  }
}

/** Panel admin: marca una solicitud como ya atendida */
export async function marcarSolicitudCodigoAtendidaAdmin(
  id: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/solicitudes-codigo/${encodeURIComponent(id)}/atender`, {
      method: 'POST',
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}

/** Panel admin: elimina una solicitud de la lista */
export async function eliminarSolicitudCodigoAdmin(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/solicitudes-codigo/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}
