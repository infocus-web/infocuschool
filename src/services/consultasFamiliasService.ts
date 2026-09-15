import { fetchAdminAutenticado } from './adminAuthService';

export type EstadoConsultaFamilia = 'nueva' | 'en_proceso' | 'resuelta';

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
