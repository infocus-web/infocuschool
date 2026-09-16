import { fetchAdminAutenticado } from './adminAuthService';

/**
 * Buscador global de alumnos (panel admin -> "Buscar alumno"): un solo cuadro de búsqueda que
 * cruza nombre y apellido, DNI, Código de Acceso y teléfono de la familia contra la nómina real,
 * los códigos de sección y los pedidos — pensado para responder rápido "¿este alumno ya pagó?"
 * sin tener que saber de antemano en qué colegio o curso está. Ver el endpoint del servidor
 * (`/api/admin/alumnos/buscar`) para el detalle de cómo se cruzan los tres caminos de búsqueda.
 */

export interface PedidoResumenBusqueda {
  id: string;
  numero: string | null;
  estado: string;
  total: number;
  kitNombre: string | null;
  metodoPago: string | null;
  fecha: string | null;
  tutorNombre: string | null;
  tutorTelefono: string | null;
  tutorEmail: string | null;
}

export interface AlumnoBusqueda {
  id: string;
  nombre: string;
  dni: string | null;
  grado: string;
  division: string;
  turno: string | null;
  numeroLista: number | null;
  colegioId: string | null;
  colegioNombre: string | null;
  codigoSeccion: string | null;
  pagado: boolean;
  otrosPedidos: number;
  pedido: PedidoResumenBusqueda | null;
}

export interface PedidoPorTelefonoBusqueda {
  id: string;
  numero: string | null;
  alumnoNombre: string | null;
  colegioNombre: string | null;
  grado: string | null;
  division: string | null;
  estado: string;
  total: number;
  kitNombre: string | null;
  fecha: string | null;
  tutorNombre: string | null;
  tutorTelefono: string | null;
}

export interface ResultadoBusquedaAlumnos {
  success: boolean;
  alumnos: AlumnoBusqueda[];
  pedidosPorTelefono: PedidoPorTelefonoBusqueda[];
  error?: string;
}

export async function buscarAlumnosAdmin(query: string): Promise<ResultadoBusquedaAlumnos> {
  const q = query.trim();
  if (q.length < 2) {
    return { success: true, alumnos: [], pedidosPorTelefono: [] };
  }
  try {
    const res = await fetchAdminAutenticado(`/api/admin/alumnos/buscar?q=${encodeURIComponent(q)}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, alumnos: [], pedidosPorTelefono: [], error: data?.error || 'No se pudo buscar.' };
    }
    return { success: true, alumnos: data.alumnos || [], pedidosPorTelefono: data.pedidosPorTelefono || [] };
  } catch (err: any) {
    return { success: false, alumnos: [], pedidosPorTelefono: [], error: err?.message || 'Error de conexión al buscar.' };
  }
}
