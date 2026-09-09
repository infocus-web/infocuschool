import { fetchAdminAutenticado } from './adminAuthService';

/**
 * Cierre de temporada ("Cerrar año"): borra los datos de LA TEMPORADA de un colegio puntual
 * (o de todos, si colegioId === 'todos') — alumnos, familias, pedidos, fotos, inscripciones,
 * padres autorizados y códigos de sección — para poder arrancar un año nuevo desde cero.
 * El colegio en sí (tabla `colegios`) nunca se borra.
 *
 * Es una acción destructiva e irreversible: por eso primero se pide un resumen (para mostrarle
 * al fotógrafo cuánto se va a borrar) y recién después se ejecuta, con una frase de
 * confirmación que el servidor valida contra el nombre real del colegio.
 */

export interface ResumenCierreAnio {
  familias: number;
  alumnos: number;
  fotos: number;
  pedidos: number;
  pedidoFotos: number;
  inscripciones: number;
  padresAutorizados: number;
  codigosSeccion: number;
  solicitudesCodigo: number;
}

export interface ResultadoResumenCierreAnio {
  success: boolean;
  colegioNombre?: string;
  resumen?: ResumenCierreAnio;
  error?: string;
}

export interface ResultadoEjecutarCierreAnio {
  success: boolean;
  borrados?: { familias: number; alumnos: number; fotos: number; pedidos: number };
  erroresStorage?: string[];
  error?: string;
}

/** Pide un conteo de todo lo que se borraría, sin borrar nada todavía. */
export async function obtenerResumenCierreAnio(colegioId: string): Promise<ResultadoResumenCierreAnio> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/cerrar-anio/resumen?colegioId=${encodeURIComponent(colegioId)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo armar el resumen del cierre de año.' };
    }
    return { success: true, colegioNombre: data.colegioNombre, resumen: data.resumen };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al pedir el resumen del cierre de año.' };
  }
}

/**
 * Ejecuta el cierre de año. `confirmacion` tiene que ser exactamente "CERRAR <nombre del
 * colegio>" (o "CERRAR TODOS LOS COLEGIOS" si colegioId es 'todos') — el servidor la valida
 * contra el nombre real, así que no alcanza con mandar cualquier texto.
 */
export async function ejecutarCierreAnio(colegioId: string, confirmacion: string): Promise<ResultadoEjecutarCierreAnio> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/cerrar-anio/ejecutar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ colegioId, confirmacion }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo cerrar el año.' };
    }
    return { success: true, borrados: data.borrados, erroresStorage: data.erroresStorage };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al cerrar el año.' };
  }
}
