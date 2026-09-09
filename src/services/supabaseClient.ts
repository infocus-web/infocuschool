import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { fetchAdminAutenticado } from './adminAuthService';

const DEFAULT_SUPABASE_URL = 'https://ntkqypxvrljuihbxdrtx.supabase.co';
const DEFAULT_SUPABASE_ANON_KEY = 'sb_publishable_94eG1ynOFoTUTPfcKgBwlw_rfhcRNbT';

// Helper to detect if a key is a Supabase Service Role Key
export function isServiceRoleKey(key: string): boolean {
  if (!key) return false;
  const clean = key.trim();
  if (clean.toLowerCase().includes('service_role')) return true;
  if (clean.startsWith('sb_secret_') || clean.startsWith('secret_')) return true;
  if (clean.startsWith('ey') && clean.includes('.')) {
    try {
      const parts = clean.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(atob(parts[1]));
        if (payload?.role === 'service_role') {
          return true;
        }
      }
    } catch {
      // ignore
    }
  }
  return false;
}

// Get keys from environment or localStorage for easy configuration from Admin panel
export function getSupabaseConfig() {
  const metaEnv = (import.meta as unknown as { env?: Record<string, string> }).env;
  const envUrl = metaEnv?.VITE_SUPABASE_URL;
  const envKey = metaEnv?.VITE_SUPABASE_ANON_KEY;
  let storedKey = typeof window !== 'undefined' ? localStorage.getItem('infocus_supabase_anon_key') : null;
  const storedUrl = typeof window !== 'undefined' ? localStorage.getItem('infocus_supabase_url') : null;

  // Sanitize: never allow a stored service_role key in client localStorage
  if (storedKey && isServiceRoleKey(storedKey)) {
    console.warn('[Seguridad] Se eliminó una Service Role Key detectada en el almacenamiento local del cliente.');
    if (typeof window !== 'undefined') {
      localStorage.removeItem('infocus_supabase_anon_key');
    }
    storedKey = null;
  }

  return {
    url: storedUrl || envUrl || DEFAULT_SUPABASE_URL,
    anonKey: storedKey || envKey || DEFAULT_SUPABASE_ANON_KEY
  };
}

export function saveSupabaseConfig(url: string, anonKey: string): { ok: boolean; error?: string } {
  const cleanKey = anonKey ? anonKey.trim() : '';

  // Reject Service Role Key
  if (cleanKey && isServiceRoleKey(cleanKey)) {
    console.error('[Seguridad] Intento bloqueado: la Service Role Key no debe guardarse en el navegador.');
    return {
      ok: false,
      error: 'Por motivos de seguridad, la Service Role Key no puede utilizarse en el navegador. Utilizá exclusivamente la clave pública Anon / Publishable Key (sb_publishable_... o anon key).'
    };
  }

  if (typeof window !== 'undefined') {
    if (url) localStorage.setItem('infocus_supabase_url', url.trim());
    if (cleanKey) localStorage.setItem('infocus_supabase_anon_key', cleanKey);
  }
  supabaseInstance = null;
  return { ok: true };
}

let supabaseInstance: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  const config = getSupabaseConfig();
  if (!config.anonKey) {
    return null;
  }
  if (!supabaseInstance) {
    supabaseInstance = createClient(config.url, config.anonKey);
  }
  return supabaseInstance;
}

export function resetSupabaseConfig() {
  if (typeof window !== 'undefined') {
    localStorage.removeItem('infocus_supabase_url');
    localStorage.removeItem('infocus_supabase_anon_key');
  }
  supabaseInstance = null;
}

export interface SupabaseDiagnosticResult {
  ok: boolean;
  url: string;
  keyType: 'publishable_anon' | 'custom' | 'none';
  fotosWebStatus: 'ok' | 'rls_blocked' | 'not_found' | 'error';
  fotosHdStatus: 'ok' | 'rls_blocked' | 'not_found' | 'error';
  fotosWebError?: string;
  fotosHdError?: string;
  databaseStatus: 'ok' | 'tables_found' | 'error';
  detalles: string;
}

/**
 * Diagnostics function to test if Supabase Storage is reachable and whether
 * upload policies (RLS) are active or blocked.
 */
export async function testSupabaseConnection(): Promise<SupabaseDiagnosticResult> {
  const client = getSupabase();
  const config = getSupabaseConfig();
  
  if (!client || !config.anonKey) {
    return {
      ok: false,
      url: config.url,
      keyType: 'none',
      fotosWebStatus: 'error',
      fotosHdStatus: 'error',
      fotosWebError: 'No hay clave configurada para Supabase.',
      fotosHdError: 'No hay clave configurada para Supabase.',
      databaseStatus: 'error',
      detalles: 'Configure la clave anónima pública (Anon Key) para conectar.'
    };
  }

  const keyType: 'publishable_anon' | 'custom' = config.anonKey.startsWith('sb_publishable')
    ? 'publishable_anon'
    : 'custom';

  let fotosWebStatus: 'ok' | 'rls_blocked' | 'not_found' | 'error' = 'ok';
  let fotosHdStatus: 'ok' | 'rls_blocked' | 'not_found' | 'error' = 'ok';
  let fotosWebError: string | undefined;
  let fotosHdError: string | undefined;

  // 1. Test listing from fotos-web (bucket público de lectura — sigue siendo válido probarlo
  // con la clave anónima, es justo el acceso que debe seguir funcionando para cualquier
  // visitante). Si la única política de lectura pública que queda ("Permitir lectura publica
  // fotos-web") se llegara a borrar por error, esto lo detecta como RLS bloqueada.
  const { error: errWebList } = await client.storage.from('fotos-web').list('', { limit: 1 });
  if (errWebList) {
    if (errWebList.message?.includes('row-level security') || errWebList.message?.includes('AccessDenied')) {
      fotosWebStatus = 'rls_blocked';
    } else {
      fotosWebStatus = errWebList.message?.includes('not found') ? 'not_found' : 'error';
    }
    fotosWebError = errWebList.message;
  }

  // 2. fotos-hd: auditoría 2026-09-09 — este bucket es privado (contiene las fotos originales,
  // el producto pago) y ya NO se lee ni se escribe con la clave anónima del navegador para
  // nada: antes esta misma función probaba subir/leer directo con la anon key, lo que
  // significaba que el bucket TENÍA que tener políticas públicas de lectura/escritura para
  // que este chequeo (y la subida real desde el panel) funcionaran — esas políticas son
  // justamente el agujero que se cerró. Ahora se verifica indirectamente: se le pide al
  // servidor (con sesión de admin) que genere una URL de subida firmada para fotos-hd sin
  // subir nada — si el servidor puede generarla, es porque la Service Role Key está bien
  // configurada y el bucket existe, que es todo lo que hace falta para que la subida real
  // funcione.
  try {
    const resHd = await fetchAdminAutenticado('/api/admin/storage/signed-upload-url', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket: 'fotos-hd', path: `_diagnostico/ping_${Date.now()}.txt` }),
    });
    const dataHd = await resHd.json();
    if (!dataHd?.success) {
      fotosHdStatus = 'error';
      fotosHdError = dataHd?.error || 'El servidor no pudo generar una URL de subida para fotos-hd.';
    }
  } catch (err: any) {
    fotosHdStatus = 'error';
    fotosHdError = err?.message || 'No se pudo consultar al servidor para verificar fotos-hd.';
  }

  const ok = fotosWebStatus === 'ok' && fotosHdStatus === 'ok';
  let detalles = 'Conexión a Supabase Storage verificada.';
  if (fotosWebStatus === 'rls_blocked') {
    detalles = 'Falta la política de lectura pública para fotos-web en el SQL Editor de Supabase.';
  } else if (fotosHdStatus === 'error') {
    detalles = 'El servidor no pudo confirmar acceso a fotos-hd — revisá que ADMIN_SESSION_SECRET y SUPABASE_SERVICE_ROLE_KEY estén configuradas, o iniciá sesión de admin de nuevo.';
  }

  return {
    ok,
    url: config.url,
    keyType,
    fotosWebStatus,
    fotosHdStatus,
    fotosWebError,
    fotosHdError,
    databaseStatus: 'ok',
    detalles
  };
}

// Auditoría 2026-09-09: las cuatro funciones de abajo (limpiar bucket, borrar foto, subir HD,
// subir web) antes escribían/borraban directo en Supabase Storage usando la clave anónima
// del navegador (getSupabase()). Eso solo funcionaba porque los buckets 'fotos-web' y
// 'fotos-hd' tenían políticas de RLS que decían "permitir a cualquiera, sin login" para
// insertar/actualizar/borrar — y 'fotos-hd' (las fotos originales, el producto pago) además
// permitía LEER a cualquiera. Es decir, cualquier visitante del sitio (no solo el admin) podía
// copiar la clave anónima pública (visible en el propio código del sitio) y, sin ningún PIN,
// descargar todas las fotos originales gratis, subir archivos arbitrarios, o borrar
// permanentemente todas las fotos del negocio. El PIN de admin de este panel nunca protegió
// nada de esto — solo ocultaba el botón, la puerta de atrás seguía abierta.
//
// Ahora estas cuatro funciones piden al SERVIDOR (con sesión de admin real) que haga el
// trabajo con la Service Role Key, que no necesita ninguna política pública en Storage. Las
// políticas públicas de escritura/lectura de 'fotos-hd' y de escritura de 'fotos-web' se
// cerraron del lado de Supabase (ver migración de la auditoría 2026-09-09); sólo queda
// pública la LECTURA de 'fotos-web' (las miniaturas con marca de agua, que sí deben verse en
// la galería pública).

/**
 * Vacía por completo un bucket (botón "Limpiar Supabase" del panel admin).
 */
export async function limpiarStorageBucket(bucket: 'fotos-web' | 'fotos-hd' | 'fotos', prefix = ''): Promise<{ eliminados: number; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/storage/limpiar-bucket', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ bucket, prefix }),
    });
    const data = await res.json();
    if (!data?.success) {
      return { eliminados: 0, error: data?.error || 'No se pudo limpiar el bucket.' };
    }
    return { eliminados: data.eliminados || 0 };
  } catch (err: any) {
    return { eliminados: 0, error: err?.message || 'Error al limpiar bucket' };
  }
}

/**
 * Borra una foto puntual de los buckets web y/o HD.
 */
export async function eliminarFotoDeStorage(pathWeb?: string, pathHD?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (pathWeb) {
      await fetchAdminAutenticado('/api/admin/storage/eliminar-archivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: 'fotos-web', paths: [pathWeb] }),
      });
    }
    if (pathHD) {
      await fetchAdminAutenticado('/api/admin/storage/eliminar-archivos', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bucket: 'fotos-hd', paths: [pathHD] }),
      });
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error al eliminar foto de storage' };
  }
}

/**
 * Pide al servidor una URL de subida firmada de un solo uso para `bucket`/`filePath`, y sube
 * el archivo directo a Supabase Storage con ella — sin necesitar ninguna política pública de
 * escritura, ya que la autorización viene del token firmado (generado por el servidor con la
 * Service Role Key tras validar la sesión de admin), no del rol de la clave anónima.
 */
async function subirConUrlFirmada(bucket: 'fotos-hd' | 'fotos-web', file: File | Blob, filePath: string): Promise<{ path: string; error?: string }> {
  const client = getSupabase();
  if (!client) {
    return { path: '', error: 'Supabase no conectado con anon key' };
  }
  const resFirma = await fetchAdminAutenticado('/api/admin/storage/signed-upload-url', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bucket, path: filePath }),
  });
  const dataFirma = await resFirma.json();
  if (!dataFirma?.success) {
    return { path: '', error: dataFirma?.error || 'No se pudo autorizar la subida (¿sesión de admin vencida?)' };
  }

  const { data, error } = await client.storage
    .from(bucket)
    .uploadToSignedUrl(dataFirma.path, dataFirma.token, file, {
      contentType: (file as File).type || 'image/jpeg',
    });

  if (error) {
    return { path: '', error: error.message };
  }
  return { path: data.path };
}

/**
 * Upload an original High Resolution photo or ZIP to private 'fotos-hd' bucket
 */
export async function uploadFotoHD(file: File | Blob, filePath: string): Promise<{ path: string; error?: string }> {
  return subirConUrlFirmada('fotos-hd', file, filePath);
}

/**
 * Upload a watermarked compressed web preview photo to public 'fotos-web' bucket
 */
export async function uploadFotoWeb(file: File | Blob, filePath: string): Promise<{ publicUrl: string; error?: string }> {
  const client = getSupabase();
  if (!client) {
    return { publicUrl: '', error: 'Supabase no conectado con anon key' };
  }

  const resultado = await subirConUrlFirmada('fotos-web', file, filePath);
  if (resultado.error) {
    return { publicUrl: '', error: resultado.error };
  }

  const { data: publicUrlData } = client.storage
    .from('fotos-web')
    .getPublicUrl(resultado.path);

  return { publicUrl: publicUrlData.publicUrl };
}

// Nota (auditoría 2026-09-09): existía acá una función "getSignedDownloadUrl" pensada para
// generar un link de descarga de una foto HD directo con la clave anónima del navegador —
// nunca llegó a usarse en ningún lugar del código (se confirmó buscando todos sus llamadores),
// pero para que hubiera funcionado el bucket 'fotos-hd' habría necesitado permitir LECTURA
// pública, que es exactamente el agujero que se cerró (cualquiera podía descargar todas las
// fotos originales gratis). Se quita: si en el futuro hace falta mandarle a una familia un
// link de descarga de su HD ya pago, hay que generarlo del lado del servidor (con la Service
// Role Key, protegido detrás de una verificación real de que ese pedido está pagado), nunca
// con la clave anónima del navegador.
