import { Foto, CategoriaFoto } from '../types';
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
  categoria: 'individual' | 'grupal' | 'docente' | 'patio';
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
  categoria: 'individual' | 'grupal' | 'docente' | 'patio';
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
  emailsEnviados?: number;
  warning?: string;
  error?: string;
}

// El servidor acepta hasta 500 fotos por llamada (ver POST /api/admin/fotos en server.ts).
const FOTOS_POR_LOTE_REGISTRO = 200;

/** Panel admin: registra en Supabase las fotos ya subidas a Storage (queda visible al instante para las familias) */
export async function registrarFotosAdmin(fotos: DatosFotoParaRegistrar[]): Promise<ResultadoRegistrarFotos> {
  // Auditoría 2026-09-23 (bug real): todo el lote viajaba en UNA sola llamada. Con más de 500
  // fotos el servidor lo rechazaba entero, y con bastantes menos ya superaba el tamaño máximo del
  // body — en ambos casos las fotos quedaban subidas a Storage pero sin registrar en el catálogo
  // (no aparecían en la galería). Ahora se registran en lotes.
  let registradas = 0;
  let emailsEnviados = 0;
  let warning: string | undefined;
  for (let i = 0; i < fotos.length; i += FOTOS_POR_LOTE_REGISTRO) {
    const lote = fotos.slice(i, i + FOTOS_POR_LOTE_REGISTRO);
    try {
      const res = await fetchAdminAutenticado('/api/admin/fotos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fotos: lote }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        const error = data.error || 'No se pudieron registrar las fotos.';
        return {
          success: false,
          registradas,
          emailsEnviados,
          error: registradas > 0 ? `Se registraron ${registradas} de ${fotos.length} fotos. El resto falló: ${error}` : error,
        };
      }
      registradas += data.registradas || 0;
      emailsEnviados += data.emailsEnviados || 0;
      warning = warning || data.warning;
    } catch (err: any) {
      const error = err?.message || 'Error de red al registrar las fotos.';
      return {
        success: false,
        registradas,
        emailsEnviados,
        error: registradas > 0 ? `Se registraron ${registradas} de ${fotos.length} fotos. El resto falló: ${error}` : error,
      };
    }
  }
  return { success: true, registradas, emailsEnviados, warning };
}

/**
 * Panel admin: lista las fotos activas de un curso puntual (grado+turno+división) para
 * mostrarlas/borrarlas. Auditoría 2026-09-22 (pedido de Pablo: listado de qué cursos ya tienen
 * fotos subidas): `grado`/`turno` pasan a ser opcionales — si se omiten (dejando sólo
 * `colegioId`), el servidor devuelve TODAS las fotos del colegio sin filtrar por curso (ver
 * `/api/admin/fotos` en server.ts, que ya soportaba esto), y quien llama las agrupa por curso.
 */
export async function obtenerFotosActivasAdmin(params: {
  colegioId?: string;
  grado?: string;
  turno?: string;
  division?: string;
}): Promise<FotoRegistrada[]> {
  try {
    const query = new URLSearchParams();
    if (params.colegioId) query.set('colegioId', params.colegioId);
    if (params.grado) query.set('grado', params.grado);
    if (params.turno) query.set('turno', params.turno);
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
  const path = idx === -1 ? valor : valor.slice(idx + marcador.length);
  // Las URLs guardadas pueden traer "?v=..." al final (para evitar caché del navegador tras
  // pisar el archivo) — hay que sacarlo para quedarnos con la ruta real dentro del bucket.
  const idxQuery = path.indexOf('?');
  return idxQuery === -1 ? path : path.slice(0, idxQuery);
}

/** Panel admin: elimina una foto (fila en Supabase + los archivos reales en Storage) */
export async function eliminarFotoActivaAdmin(foto: FotoRegistrada): Promise<{ success: boolean; error?: string }> {
  try {
    let advertenciaStorage: string | undefined;
    if (foto.pathStorageWeb || foto.pathStorageHD) {
      // Auditoría 2026-09-22: antes se ignoraba por completo el resultado de
      // eliminarFotoDeStorage (que a su vez, hasta este mismo audit, reportaba éxito sin revisar
      // la respuesta del servidor). Si el borrado del archivo en el bucket fallaba, el registro
      // en la tabla `fotos` se borraba igual y el panel mostraba "eliminada" sin avisar que el
      // archivo real (en un bucket de lectura pública) seguía existiendo, accesible por su URL.
      const resultadoStorage = await eliminarFotoDeStorage(extraerPathStorageWeb(foto.pathStorageWeb), foto.pathStorageHD || undefined);
      if (!resultadoStorage.ok) {
        advertenciaStorage = resultadoStorage.error || 'No se pudo eliminar el archivo del almacenamiento.';
        console.warn('eliminarFotoActivaAdmin: el borrado en storage falló, se continúa borrando el registro:', advertenciaStorage);
      }
    }
    const res = await fetchAdminAutenticado(`/api/admin/fotos/${encodeURIComponent(foto.id)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo eliminar la foto.' };
    }
    // Se borró el registro del catálogo (que es lo que el admin ve y lo que evita que se siga
    // mostrando/entregando la foto), pero si el archivo en el bucket no se pudo borrar, se avisa
    // igual con success:true + error para que quede visible en el panel y se pueda reintentar o
    // limpiar el bucket a mano — en vez de reportar un éxito silenciosamente incompleto.
    if (advertenciaStorage) {
      return { success: true, error: `Foto quitada del catálogo, pero el archivo no se pudo borrar del almacenamiento: ${advertenciaStorage}` };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al eliminar la foto.' };
  }
}

/**
 * Panel admin: vacía por completo el catálogo de fotos (usado junto con "Limpiar Supabase").
 * Auditoría 2026-09-19: el servidor ahora exige la frase exacta "BORRAR TODAS LAS FOTOS" (mismo
 * criterio que "Cerrar año") antes de ejecutar el borrado — evita que un solo click accidental
 * (o un token de admin filtrado) borre todo el catálogo sin posibilidad de deshacer.
 */
export async function limpiarTodasLasFotosAdmin(confirmacion: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/fotos', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ confirmacion }),
    });
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

export interface SeccionGaleria {
  colegioId: string;
  grado: string;
  turno: string;
  division: string;
}

export interface ResultadoGaleriaPublica {
  fotos: Foto[];
  /** Sección real confirmada por el servidor a partir del código. */
  seccion: SeccionGaleria | null;
}

/**
 * Galería pública para el portal de familias: trae las fotos reales del curso al que
 * pertenece un código de acceso válido.
 *
 * IMPORTANTE — SEGURIDAD: antes esta función (y el endpoint `/api/fotos`) recibían
 * directamente grado/turno/división, que son datos públicos visibles en un combo del sitio.
 * Eso permitía ver las fotos reales de cualquier curso sin ningún código, con sólo elegir las
 * opciones del desplegable. Ahora la ÚNICA llave es el código secreto de la sección: el
 * servidor lo valida contra `codigos_seccion` y es quien decide a qué grado/turno/división
 * corresponde — nunca se confía en lo que mande el navegador. Sin un código válido, se
 * se devuelve una galería vacía. Nunca se mezclan fotos genéricas con las reales.
 */
export async function obtenerGaleriaPublica(params: { codigo?: string | null }): Promise<ResultadoGaleriaPublica> {
  const codigo = (params.codigo || '').trim();
  if (!codigo) {
    return { fotos: [], seccion: null };
  }
  try {
    const query = new URLSearchParams();
    query.set('codigo', codigo);

    const res = await fetch(`/api/fotos?${query.toString()}`);
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { fotos: [], seccion: null };
    }

    const seccion: SeccionGaleria | null = data.seccion
      ? {
          colegioId: data.seccion.colegioId,
          grado: data.seccion.grado,
          turno: data.seccion.turno,
          division: data.seccion.division,
        }
      : null;

    if (!Array.isArray(data.fotos) || data.fotos.length === 0) {
      return { fotos: [], seccion };
    }

    const fotos = data.fotos.map((row: any): Foto => {
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

    return { fotos, seccion };
  } catch (err) {
    console.error('Error al obtener la galería de fotos:', err);
    return { fotos: [], seccion: null };
  }
}
