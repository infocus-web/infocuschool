import { Foto, CategoriaFoto } from '../types';
import { FOTOS_MUESTRA } from '../data/colegiosData';
import { eliminarFotoDeStorage } from './supabaseClient';
import { fetchAdminAutenticado } from './adminAuthService';

/**
 * Catálogo de fotos activas: vive en Supabase (tabla `fotos`), compartido por todo el sitio.
 * Antes se guardaba en el almacenamiento local del navegador del fotógrafo, por lo que las
 * familias nunca veían las fotos reales desde su propio dispositivo — esto ya no ocurre.
 */
export interface FotoRegistrada {
  id: string;
  colegioId?: string | null;
  codigoCurso?: string | null;
  grado?: string | null;
  division?: string | null;
  turno?: string | null;
  categoria: 'individual' | 'grupal' | 'docente';
  alumnoNombre?: string | null;
  urlWeb: string;
  pathStorageWeb?: string | null;
  pathStorageHD?: string | null;
  createdAt?: string;
}

function mapearFilaFoto(row: any): FotoRegistrada {
  return {
    id: row.id,
    colegioId: row.colegio_id,
    codigoCurso: row.codigo_curso,
    grado: row.grado,
    division: row.division,
    turno: row.turno,
    categoria: row.categoria,
    alumnoNombre: row.alumno_nombre,
    urlWeb: row.preview_path || row.thumb_path || '',
    pathStorageWeb: row.thumb_path || row.preview_path,
    pathStorageHD: row.storage_path,
    createdAt: row.created_at,
  };
}

export interface DatosFotoParaRegistrar {
  colegioId: string;
  categoria: 'individual' | 'grupal' | 'docente';
  grado: string;
  turno: string;
  division: string;
  storagePathHD: string;
  storagePathWeb: string;
  /** Miniatura chica y sin marca de agua, usada en la grilla de la galería */
  storagePathThumb?: string;
  alumnoNombre?: string;
}

export interface ResultadoRegistrarFotos {
  success: boolean;
  registradas?: number;
  error?: string;
}

/** Panel admin: registra en Supabase las fotos ya subidas a Storage (queda visible al instante para las familias) */
export async function registrarFotosAdmin(fotos: DatosFotoParaRegistrar[]): Promise<ResultadoRegistrarFotos> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/fotos', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fotos }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudieron registrar las fotos.' };
    }
    return { success: true, registradas: data.registradas };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al registrar las fotos.' };
  }
}

/** Panel admin: lista las fotos activas de un curso puntual (grado+turno+división) para mostrarlas/borrarlas */
export async function obtenerFotosActivasAdmin(params: {
  colegioId?: string;
  grado: string;
  turno: string;
  division?: string;
}): Promise<FotoRegistrada[]> {
  try {
    const query = new URLSearchParams();
    if (params.colegioId) query.set('colegioId', params.colegioId);
    query.set('grado', params.grado);
    query.set('turno', params.turno);
    if (params.division) query.set('division', params.division);

    const res = await fetchAdminAutenticado(`/api/admin/fotos?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return (data.fotos || []).map(mapearFilaFoto);
  } catch (err) {
    console.error('Error al obtener las fotos activas:', err);
    return [];
  }
}

/**
 * El campo web se guarda como URL pública completa (para poder mostrarla directamente),
 * pero Storage necesita la ruta relativa dentro del bucket para poder borrar el archivo.
 */
function extraerPathStorageWeb(valor?: string | null): string | undefined {
  if (!valor) return undefined;
  const marcador = '/fotos-web/';
  const idx = valor.indexOf(marcador);
  return idx === -1 ? valor : valor.slice(idx + marcador.length);
}

/** Panel admin: elimina una foto (fila en Supabase + los archivos reales en Storage) */
export async function eliminarFotoActivaAdmin(foto: FotoRegistrada): Promise<{ success: boolean; error?: string }> {
  try {
    if (foto.pathStorageWeb || foto.pathStorageHD) {
      await eliminarFotoDeStorage(extraerPathStorageWeb(foto.pathStorageWeb), foto.pathStorageHD || undefined);
    }
    const res = await fetchAdminAutenticado(`/api/admin/fotos/${encodeURIComponent(foto.id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo eliminar la foto.' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al eliminar la foto.' };
  }
}

/** Panel admin: vacía por completo el catálogo de fotos (usado junto con "Limpiar Supabase") */
export async function limpiarTodasLasFotosAdmin(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/fotos', { method: 'DELETE' });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo limpiar el catálogo de fotos.' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al limpiar el catálogo de fotos.' };
  }
}

export interface ResultadoRegenerarMiniaturas {
  success: boolean;
  procesadas?: number;
  fallidas?: number;
  restantes?: number;
  error?: string;
}

/**
 * Panel admin: migración de fotos ya subidas ANTES de tener miniatura propia — genera,
 * a partir del original guardado en el bucket privado, una miniatura chica y sin marca de
 * agua para cada una. Procesa de a un lote chico por llamada (el servidor la corta sola
 * para no exceder el tiempo máximo de una función serverless), por eso se llama en un
 * bucle hasta que "restantes" llega a 0.
 */
export async function regenerarMiniaturasAdmin(limite = 12): Promise<ResultadoRegenerarMiniaturas> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/fotos/regenerar-miniaturas', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limite }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudieron regenerar las miniaturas.' };
    }
    return { success: true, procesadas: data.procesadas || 0, fallidas: data.fallidas || 0, restantes: data.restantes || 0 };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al regenerar las miniaturas.' };
  }
}

export interface ResultadoRegenerarMarcaAgua {
  success: boolean;
  procesadas?: number;
  fallidas?: number;
  restantes?: number;
  siguienteOffset?: number;
  error?: string;
}

/**
 * Panel admin: re-genera la copia ampliada (con marca de agua quemada) de TODAS las fotos
 * ya subidas, usando la nueva versión más liviana y espaciada de la marca de agua — a partir
 * del original guardado, sin volver a subir nada. Se procesa de a un lote chico por llamada,
 * avanzando con `offset` hasta que "restantes" llega a 0.
 */
export async function regenerarMarcaAguaAdmin(limite = 8, offset = 0): Promise<ResultadoRegenerarMarcaAgua> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/fotos/regenerar-marca-agua', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ limite, offset }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo regenerar la marca de agua.' };
    }
    return {
      success: true,
      procesadas: data.procesadas || 0,
      fallidas: data.fallidas || 0,
      restantes: data.restantes || 0,
      siguienteOffset: data.siguienteOffset || 0,
    };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al regenerar la marca de agua.' };
  }
}

/**
 * Galería pública para el portal de familias: trae las fotos reales de un curso puntual
 * (grado + turno + división) desde Supabase. Si todavía no hay fotos reales cargadas para
 * ese curso, devuelve las fotos de muestra estándar — igual que antes.
 */
export async function obtenerGaleriaPublica(params: {
  grado?: string;
  turno?: string;
  division?: string;
}): Promise<Foto[]> {
  if (!params.grado || !params.turno) {
    return FOTOS_MUESTRA;
  }
  try {
    const query = new URLSearchParams();
    query.set('grado', params.grado);
    query.set('turno', params.turno);
    if (params.division) query.set('division', params.division);

    const res = await fetch(`/api/fotos?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success || !Array.isArray(data.fotos) || data.fotos.length === 0) {
      return FOTOS_MUESTRA;
    }

    return data.fotos.map((row: any): Foto => {
      const categoria = row.categoria as CategoriaFoto;
      // La vista ampliada usa la copia con la marca de agua quemada en los píxeles
      // (preview_path). La miniatura de la grilla usa la copia chica y limpia (thumb_path)
      // cuando existe; si la foto se subió antes de tener miniatura propia, cae de nuevo
      // en la versión con marca de agua como respaldo.
      const url = row.preview_path || row.thumb_path || row.storage_path || '';
      const thumbnail = row.thumb_path || row.preview_path || row.storage_path || '';
      return {
        id: row.id,
        url,
        thumbnail,
        categoria,
        titulo: row.alumno_nombre
          ? `${row.alumno_nombre} (${categoria})`
          : `Foto ${categoria}`,
        descripcion: `Foto ${categoria} del curso`,
        alumnoNombre: row.alumno_nombre || undefined,
        grado: row.grado || undefined,
        division: row.division || undefined,
      };
    });
  } catch (err) {
    console.error('Error al obtener la galería de fotos:', err);
    return FOTOS_MUESTRA;
  }
}
