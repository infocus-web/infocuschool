import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

  // 1. Test listing from fotos-web
  const { error: errWebList } = await client.storage.from('fotos-web').list('', { limit: 1 });
  if (errWebList) {
    fotosWebStatus = errWebList.message?.includes('not found') ? 'not_found' : 'error';
    fotosWebError = errWebList.message;
  }

  // 2. Test listing from fotos-hd
  const { error: errHdList } = await client.storage.from('fotos-hd').list('', { limit: 1 });
  if (errHdList) {
    fotosHdStatus = errHdList.message?.includes('not found') ? 'not_found' : 'error';
    fotosHdError = errHdList.message;
  }

  // 3. Test a tiny ping upload to check RLS write permissions on fotos-web
  const pingBlob = new Blob(['ping'], { type: 'image/jpeg' });
  const pingPath = `_ping_check_${Date.now()}.jpg`;
  
  const { error: errWebWrite } = await client.storage.from('fotos-web').upload(pingPath, pingBlob, { upsert: true });
  if (errWebWrite) {
    if (errWebWrite.message?.includes('row-level security') || errWebWrite.message?.includes('AccessDenied')) {
      fotosWebStatus = 'rls_blocked';
      fotosWebError = 'Bloqueado por Row-Level Security (RLS). Falta política INSERT en storage.objects para fotos-web.';
    } else {
      fotosWebStatus = 'error';
      fotosWebError = errWebWrite.message;
    }
  } else {
    fotosWebStatus = 'ok';
    // Clean ping file
    await client.storage.from('fotos-web').remove([pingPath]);
  }

  // 4. Test a tiny ping upload to check RLS write permissions on fotos-hd
  const { error: errHdWrite } = await client.storage.from('fotos-hd').upload(pingPath, pingBlob, { upsert: true });
  if (errHdWrite) {
    if (errHdWrite.message?.includes('row-level security') || errHdWrite.message?.includes('AccessDenied')) {
      fotosHdStatus = 'rls_blocked';
      fotosHdError = 'Bloqueado por Row-Level Security (RLS). Falta política INSERT en storage.objects para fotos-hd.';
    } else {
      fotosHdStatus = 'error';
      fotosHdError = errHdWrite.message;
    }
  } else {
    fotosHdStatus = 'ok';
    // Clean ping file
    await client.storage.from('fotos-hd').remove([pingPath]);
  }

  const ok = fotosWebStatus === 'ok' && fotosHdStatus === 'ok';
  let detalles = 'Conexión a Supabase Storage verificada.';
  if (fotosWebStatus === 'rls_blocked' || fotosHdStatus === 'rls_blocked') {
    detalles = 'Se requiere aplicar la política RLS en el SQL Editor de Supabase para permitir subidas con la Anon Key.';
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

/**
 * Remove all files in a specific storage bucket and path
 */
export async function limpiarStorageBucket(bucket: 'fotos-web' | 'fotos-hd' | 'fotos', prefix = ''): Promise<{ eliminados: number; error?: string }> {
  const client = getSupabase();
  if (!client) return { eliminados: 0, error: 'Supabase no conectado' };

  try {
    const { data: files, error: listErr } = await client.storage.from(bucket).list(prefix, { limit: 100 });
    if (listErr) return { eliminados: 0, error: listErr.message };
    if (!files || files.length === 0) return { eliminados: 0 };

    const filePaths: string[] = [];
    for (const f of files) {
      if (f.id) {
        filePaths.push(prefix ? `${prefix}/${f.name}` : f.name);
      }
    }

    if (filePaths.length === 0) return { eliminados: 0 };

    const { error: removeErr } = await client.storage.from(bucket).remove(filePaths);
    if (removeErr) return { eliminados: 0, error: removeErr.message };

    return { eliminados: filePaths.length };
  } catch (err: any) {
    return { eliminados: 0, error: err?.message || 'Error al limpiar bucket' };
  }
}

/**
 * Delete a photo from both web and HD buckets
 */
export async function eliminarFotoDeStorage(pathWeb?: string, pathHD?: string): Promise<{ ok: boolean; error?: string }> {
  const client = getSupabase();
  if (!client) return { ok: false, error: 'Supabase no conectado' };

  try {
    if (pathWeb) {
      await client.storage.from('fotos-web').remove([pathWeb]);
    }
    if (pathHD) {
      await client.storage.from('fotos-hd').remove([pathHD]);
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error al eliminar foto de storage' };
  }
}

/**
 * Upload an original High Resolution photo or ZIP to private 'fotos-hd' bucket
 */
export async function uploadFotoHD(file: File | Blob, filePath: string): Promise<{ path: string; error?: string }> {
  const client = getSupabase();
  if (!client) {
    return { path: filePath, error: 'Supabase no conectado con anon key' };
  }

  const { data, error } = await client.storage
    .from('fotos-hd')
    .upload(filePath, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg'
    });

  if (error) {
    return { path: '', error: error.message };
  }
  return { path: data.path };
}

/**
 * Upload a watermarked compressed web preview photo to public 'fotos-web' bucket
 */
export async function uploadFotoWeb(file: File | Blob, filePath: string): Promise<{ publicUrl: string; error?: string }> {
  const client = getSupabase();
  if (!client) {
    return { publicUrl: '', error: 'Supabase no conectado con anon key' };
  }

  const { data, error } = await client.storage
    .from('fotos-web')
    .upload(filePath, file, {
      upsert: true,
      contentType: file.type || 'image/jpeg'
    });

  if (error) {
    return { publicUrl: '', error: error.message };
  }

  const { data: publicUrlData } = client.storage
    .from('fotos-web')
    .getPublicUrl(data.path);

  return { publicUrl: publicUrlData.publicUrl };
}

/**
 * Generate a signed temporary download URL for an HD original photo (only for parents with paid orders)
 */
export async function getSignedDownloadUrl(storagePath: string, expiresIn = 60 * 60 * 24 * 7): Promise<string | null> {
  const client = getSupabase();
  if (!client) return null;

  try {
    const { data, error } = await client.storage
      .from('fotos-hd')
      .createSignedUrl(storagePath, expiresIn);

    if (error || !data?.signedUrl) return null;
    return data.signedUrl;
  } catch (err) {
    console.error('Error generating signed URL:', err);
    return null;
  }
}
