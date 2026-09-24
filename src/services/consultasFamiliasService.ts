import { fetchAdminAutenticado } from './adminAuthService';

export type EstadoConsultaFamilia = 'nueva' | 'en_proceso' | 'resuelta' | 'archivada';

export interface ConsultaFamilia {
  id: string;
  nombre: string;
  email: string;
  telefono?: string;
  colegio?: string;
  numeroPedido?: string;
  asunto: string;
  mensaje: string;
  estado: EstadoConsultaFamilia;
  origen: 'web' | 'email';
  createdAt: string;
  updatedAt: string;
  mensajes: MensajeConsultaFamilia[];
}

export interface MensajeConsultaFamilia {
  id: string;
  direccion: 'saliente' | 'entrante';
  remitente: string;
  destinatario: string;
  asunto?: string;
  contenido: string;
  createdAt: string;
}

export interface NuevaConsultaFamilia {
  nombre: string;
  email: string;
  telefono?: string;
  colegio?: string;
  numeroPedido?: string;
  asunto: string;
  mensaje: string;
  sitioWeb?: string;
}

function mapearConsulta(row: any): ConsultaFamilia {
  return {
    id: row.id,
    nombre: row.nombre,
    email: row.email,
    telefono: row.telefono || undefined,
    colegio: row.colegio || undefined,
    numeroPedido: row.numero_pedido || undefined,
    asunto: row.asunto,
    mensaje: row.mensaje,
    estado: row.estado,
    origen: row.origen,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mensajes: (row.consultas_familias_mensajes || [])
      .map((mensaje: any) => ({
        id: mensaje.id,
        direccion: mensaje.direccion,
        remitente: mensaje.remitente,
        destinatario: mensaje.destinatario,
        asunto: mensaje.asunto || undefined,
        contenido: mensaje.contenido,
        createdAt: mensaje.created_at,
      }))
      .sort((a: MensajeConsultaFamilia, b: MensajeConsultaFamilia) => a.createdAt.localeCompare(b.createdAt)),
  };
}

export async function enviarConsultaFamilia(datos: NuevaConsultaFamilia) {
  try {
    const response = await fetch('/api/consultas-familias', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await response.json();
    return response.ok && data.success
      ? { success: true as const }
      : { success: false as const, error: data.error || 'No se pudo enviar la consulta.' };
  } catch {
    return { success: false as const, error: 'No pudimos conectarnos. Intentá nuevamente.' };
  }
}

export async function obtenerConsultasFamiliasAdmin(estado: EstadoConsultaFamilia | 'todas') {
  const response = await fetchAdminAutenticado(`/api/admin/consultas-familias?estado=${encodeURIComponent(estado)}`);
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'No se pudieron cargar las consultas.');
  return (data.consultas || []).map(mapearConsulta) as ConsultaFamilia[];
}

export async function actualizarEstadoConsultaFamiliaAdmin(id: string, estado: EstadoConsultaFamilia) {
  const response = await fetchAdminAutenticado(`/api/admin/consultas-familias/${encodeURIComponent(id)}/estado`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ estado }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo actualizar la consulta.');
}

export async function eliminarConsultaFamiliaAdmin(id: string) {
  const response = await fetchAdminAutenticado(`/api/admin/consultas-familias/${encodeURIComponent(id)}`, {
    method: 'DELETE',
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo borrar la consulta.');
}

export async function responderConsultaFamiliaAdmin(id: string, mensaje: string) {
  const response = await fetchAdminAutenticado(`/api/admin/consultas-familias/${encodeURIComponent(id)}/responder`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mensaje }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo enviar la respuesta.');
}

// Solo redacta un borrador con IA — nunca envía nada. El fotógrafo lo revisa (y edita si
// hace falta) en el textarea de respuesta antes de mandarlo con responderConsultaFamiliaAdmin.
export async function sugerirRespuestaConsultaFamiliaAdmin(id: string): Promise<string> {
  const response = await fetchAdminAutenticado(`/api/admin/consultas-familias/${encodeURIComponent(id)}/sugerir-respuesta`, {
    method: 'POST',
  });
  const data = await response.json();
  if (!response.ok || !data.success) throw new Error(data.error || 'No se pudo generar una sugerencia.');
  return data.sugerencia as string;
}
