import { fetchAdminAutenticado } from './adminAuthService';

/**
 * Gestión de los códigos REALES de acceso por sección (tabla `codigos_seccion` de Supabase —
 * el valor aleatorio que de verdad valida `/api/fotos` para dejar entrar a una familia).
 *
 * Antes la pestaña "Códigos & Difusión WhatsApp" del panel mostraba códigos inventados,
 * guardados solo en el navegador (localStorage), que no tenían nada que ver con estos —
 * un colegio podía terminar recibiendo por WhatsApp un código que no funcionaba en el sitio.
 */

export interface CodigoSeccionReal {
  grado: string;
  turno: string;
  division: string;
  codigo_secreto: string;
}

export interface ResultadoCodigoSeccion {
  success: boolean;
  codigo?: string;
  error?: string;
}

/** Trae todos los códigos reales ya asignados a las secciones de un colegio. */
export async function obtenerCodigosSeccionAdmin(colegioId: string): Promise<CodigoSeccionReal[]> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/codigos-seccion?colegioId=${encodeURIComponent(colegioId)}`);
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return data.codigos || [];
  } catch (err) {
    console.error('Error al obtener los códigos de sección:', err);
    return [];
  }
}

/** Se asegura de que la sección tenga un código real: si ya tiene uno, lo devuelve; si no, crea uno nuevo. */
export async function asegurarCodigoSeccionAdmin(
  colegioId: string,
  grado: string,
  turno: string,
  division: string
): Promise<ResultadoCodigoSeccion> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/codigos-seccion/asegurar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegioId, grado, turno, division }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo asegurar el código de la sección.' };
    }
    return { success: true, codigo: data.codigo };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al asegurar el código.' };
  }
}

/** Genera un código nuevo para la sección, invalidando el anterior (si existía). */
export async function regenerarCodigoSeccionAdmin(
  colegioId: string,
  grado: string,
  turno: string,
  division: string
): Promise<ResultadoCodigoSeccion> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/codigos-seccion/regenerar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegioId, grado, turno, division }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo regenerar el código.' };
    }
    return { success: true, codigo: data.codigo };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al regenerar el código.' };
  }
}

/** Fija a mano el código real de una sección (rechazado si ya lo usa otra sección distinta). */
export async function actualizarCodigoSeccionAdmin(
  colegioId: string,
  grado: string,
  turno: string,
  division: string,
  nuevoCodigo: string
): Promise<ResultadoCodigoSeccion> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/codigos-seccion/actualizar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegioId, grado, turno, division, nuevoCodigo }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo actualizar el código.' };
    }
    return { success: true, codigo: data.codigo };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al actualizar el código.' };
  }
}
