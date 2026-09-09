import { fetchAdminAutenticado } from './adminAuthService';

/**
 * Estado de pagos de un colegio/curso puntual (ej. un acto de egresados donde el organizador
 * se compromete a una tarifa total fija por todo el curso): cruza la nómina real de alumnos
 * contra los pedidos ya registrados para ese colegio, para poder ver quién ya pagó y a quién
 * le falta, y cuánto se recaudó contra la meta que se calcule (alumnos × precio acordado).
 */

export interface PedidoResumenAlumno {
  id: string;
  estado: string;
  total: number;
  kitNombre: string | null;
  metodoPago: string | null;
  fecha: string | null;
}

export interface AlumnoEstadoPago {
  id: string;
  nombre: string;
  grado: string;
  division: string;
  turno: string | null;
  numeroLista: number | null;
  pagado: boolean;
  pedido: PedidoResumenAlumno | null;
  // Cuántos pedidos adicionales tiene este alumno además del que se muestra (poco común,
  // pero puede pasar si pagó dos veces o corrigió un pedido) — para no ocultarlos del todo.
  otrosPedidos: number;
}

export interface PedidoSinAlumnoEnNomina {
  id: string;
  alumnoNombre: string | null;
  estado: string;
  total: number;
  kitNombre: string | null;
  fecha: string | null;
}

export interface ResumenEstadoPagos {
  totalAlumnos: number;
  alumnosPagados: number;
  alumnosFaltantes: number;
  totalRecaudado: number;
}

export interface EstadoPagosColegio {
  success: boolean;
  alumnos: AlumnoEstadoPago[];
  pedidosSinAlumnoEnNomina: PedidoSinAlumnoEnNomina[];
  resumen: ResumenEstadoPagos;
  error?: string;
}

export async function obtenerEstadoPagosColegio(colegioId: string): Promise<EstadoPagosColegio> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/colegios/${encodeURIComponent(colegioId)}/estado-pagos`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      return {
        success: false,
        alumnos: [],
        pedidosSinAlumnoEnNomina: [],
        resumen: { totalAlumnos: 0, alumnosPagados: 0, alumnosFaltantes: 0, totalRecaudado: 0 },
        error: data?.error || 'No se pudo obtener el estado de pagos de este colegio.',
      };
    }
    return data;
  } catch (err: any) {
    return {
      success: false,
      alumnos: [],
      pedidosSinAlumnoEnNomina: [],
      resumen: { totalAlumnos: 0, alumnosPagados: 0, alumnosFaltantes: 0, totalRecaudado: 0 },
      error: err?.message || 'Error de conexión al consultar el estado de pagos.',
    };
  }
}
