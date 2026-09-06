import { useState, useEffect, useCallback } from 'react';
import { Colegio } from '../types';
import { fetchAdminAutenticado } from './adminAuthService';

/**
 * Perfil de cada colegio: se guarda en Supabase (tabla `colegios`) y es compartido por
 * todos los visitantes del sitio. Este valor por defecto solo se usa como respaldo mientras
 * se carga la lista real desde el servidor, o si la conexión falla.
 */
export const COLEGIO_POR_DEFECTO: Colegio = {
  id: 'col-divino-pastor-2026',
  slug: 'instituto-madre-del-divino-pastor',
  nombre: 'Instituto Madre del Divino Pastor',
  localidad: 'Buenos Aires',
  zona: 'Zona Norte',
  eventoActual: 'Temporada Oficial Retratos y Fotos Escolares 2026',
  codigoAcceso: 'IMDP2026',
  grados: [
    'Sala 3 años',
    'Sala 4 años',
    'Sala 5 años',
    '1° grado',
    '2° grado',
    '3° grado',
    '4° grado',
    '5° grado',
    '6° grado',
    '7° grado',
    '1° año',
    '2° año',
    '3° año',
    '4° año',
    '5° año',
    '6° año',
  ],
  divisiones: ['A', 'B', 'C', 'Jornada Extendida'],
  turnos: ['Mañana', 'Tarde', 'Jornada Extendida / Completa'],
};

export interface DatosColegio {
  nombre: string;
  localidad?: string;
  zona?: 'CABA' | 'Zona Norte' | 'Zona Sur' | 'Zona Oeste';
  codigoAcceso: string;
  whatsappContacto?: string;
  grados?: string[];
  divisiones?: string[];
  turnos?: string[];
  eventoActual?: string;
}

export interface ResultadoColegio {
  success: boolean;
  colegio?: Colegio;
  error?: string;
}

export interface ResultadoEliminarColegio {
  success: boolean;
  error?: string;
}

/** Trae la lista pública de colegios desde el servidor (Supabase). Sin autenticación: la necesitan
 *  el buscador del sitio y el formulario de inscripción antes de que la familia se identifique. */
export async function obtenerColegiosRemoto(): Promise<Colegio[]> {
  try {
    const res = await fetch('/api/colegios');
    const data = await res.json();
    if (!res.ok || !data.success || !Array.isArray(data.colegios)) {
      return [COLEGIO_POR_DEFECTO];
    }
    return data.colegios.length > 0 ? data.colegios : [COLEGIO_POR_DEFECTO];
  } catch (err) {
    console.error('Error al obtener la lista de colegios:', err);
    return [COLEGIO_POR_DEFECTO];
  }
}

/** Panel admin: da de alta un nuevo colegio en Supabase (visible al instante para todo el sitio) */
export async function crearColegioAdmin(datos: DatosColegio): Promise<ResultadoColegio> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/colegios', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.colegio) {
      return { success: false, error: data.error || 'No se pudo crear el colegio.' };
    }
    return { success: true, colegio: data.colegio };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al crear el colegio.' };
  }
}

/** Panel admin: actualiza nombre, localidad, código, WhatsApp, grados/divisiones/turnos de un colegio existente */
export async function actualizarColegioAdmin(
  id: string,
  cambios: Partial<DatosColegio>
): Promise<ResultadoColegio> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/colegios/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cambios),
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.colegio) {
      return { success: false, error: data.error || 'No se pudo actualizar el colegio.' };
    }
    return { success: true, colegio: data.colegio };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al actualizar el colegio.' };
  }
}

/** Atajo para actualizar solo el WhatsApp de contacto propio de un colegio */
export async function actualizarWhatsappColegio(colegioId: string, whatsapp: string): Promise<ResultadoColegio> {
  return actualizarColegioAdmin(colegioId, { whatsappContacto: whatsapp });
}

/** Panel admin: elimina un colegio (falla si todavía tiene familias/pedidos asociados) */
export async function eliminarColegioAdmin(id: string): Promise<ResultadoEliminarColegio> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/colegios/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo eliminar el colegio.' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al eliminar el colegio.' };
  }
}

/**
 * Hook de React para consumir la lista de colegios y reaccionar automáticamente a altas/bajas/ediciones.
 * La lista vive en Supabase: es la misma para todos los visitantes del sitio.
 */
export function useColegiosLista(): {
  colegios: Colegio[];
  cargando: boolean;
  agregarColegio: (datos: DatosColegio) => Promise<ResultadoColegio>;
  editarColegio: (id: string, cambios: Partial<DatosColegio>) => Promise<ResultadoColegio>;
  borrarColegio: (id: string) => Promise<ResultadoEliminarColegio>;
  recargarColegios: () => void;
} {
  const [colegios, setColegios] = useState<Colegio[]>([COLEGIO_POR_DEFECTO]);
  const [cargando, setCargando] = useState(true);

  const recargar = useCallback(() => {
    setCargando(true);
    obtenerColegiosRemoto()
      .then((lista) => setColegios(lista))
      .finally(() => setCargando(false));
  }, []);

  useEffect(() => {
    recargar();

    const handleActualizacion = () => recargar();
    window.addEventListener('colegios_actualizados', handleActualizacion);
    return () => {
      window.removeEventListener('colegios_actualizados', handleActualizacion);
    };
  }, [recargar]);

  const agregarColegio = async (datos: DatosColegio): Promise<ResultadoColegio> => {
    const resultado = await crearColegioAdmin(datos);
    if (resultado.success) {
      recargar();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('colegios_actualizados'));
      }
    }
    return resultado;
  };

  const editarColegio = async (id: string, cambios: Partial<DatosColegio>): Promise<ResultadoColegio> => {
    const resultado = await actualizarColegioAdmin(id, cambios);
    if (resultado.success) {
      recargar();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('colegios_actualizados'));
      }
    }
    return resultado;
  };

  const borrarColegio = async (id: string): Promise<ResultadoEliminarColegio> => {
    const resultado = await eliminarColegioAdmin(id);
    if (resultado.success) {
      recargar();
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('colegios_actualizados'));
      }
    }
    return resultado;
  };

  return {
    colegios,
    cargando,
    agregarColegio,
    editarColegio,
    borrarColegio,
    recargarColegios: recargar,
  };
}
