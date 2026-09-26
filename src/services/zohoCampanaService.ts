import { fetchAdminAutenticado } from './adminAuthService';

export interface DestinatarioCampana {
  email: string;
  institucion?: string;
  localidad_partido?: string;
  nivel?: string;
}

export interface EstadoZoho {
  conectado: boolean;
  cuentaEmail: string | null;
  remitentesPermitidos: string[];
  zohoConfigurado: boolean;
}

export interface EnvioZoho {
  id: string;
  destinatario_email: string;
  institucion: string | null;
  asunto: string;
  tipo: 'prueba' | 'real';
  estado: 'enviado' | 'error';
  zoho_message_id: string | null;
  error: string | null;
  created_at: string;
}

export interface ResultadoEnvioZoho {
  email: string;
  estado: 'enviado' | 'error' | 'omitido';
  error?: string;
}

export async function obtenerUrlConexionZoho(): Promise<{ success: boolean; url?: string; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/zoho/connect');
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}

export async function obtenerEstadoZoho(): Promise<EstadoZoho> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/zoho/estado');
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { conectado: false, cuentaEmail: null, remitentesPermitidos: [], zohoConfigurado: false };
    }
    return {
      conectado: data.conectado,
      cuentaEmail: data.cuentaEmail,
      remitentesPermitidos: data.remitentesPermitidos || [],
      zohoConfigurado: data.zohoConfigurado,
    };
  } catch {
    return { conectado: false, cuentaEmail: null, remitentesPermitidos: [], zohoConfigurado: false };
  }
}

export async function desconectarZoho(): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/zoho/desconectar', { method: 'POST' });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}

export async function mandarCorreoPruebaZoho(params: {
  destinatarioEjemplo: DestinatarioCampana;
  asunto: string;
  cuerpoHtml: string;
  remitente: string;
  emailPrueba: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/zoho/prueba', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}

/**
 * Manda la campaña real en lotes chicos (el servidor rechaza más de 3 por llamada) para no
 * pisar el límite de tiempo de la función serverless. onProgreso se llama después de cada
 * lote para que el panel pueda ir mostrando el avance.
 */
export async function mandarCampanaRealZoho(
  params: {
    destinatarios: DestinatarioCampana[];
    asunto: string;
    cuerpoHtml: string;
    remitente: string;
  },
  onProgreso?: (procesados: number, total: number) => void
): Promise<{ success: boolean; resultados: ResultadoEnvioZoho[]; error?: string }> {
  // Lotes de 3 (el servidor manda 1 cada 15 s y corta al llegar al tope por hora/día de Zoho).
  const TAMANO_LOTE = 3;
  const resultados: ResultadoEnvioZoho[] = [];
  for (let i = 0; i < params.destinatarios.length; i += TAMANO_LOTE) {
    const lote = params.destinatarios.slice(i, i + TAMANO_LOTE);
    try {
      const res = await fetchAdminAutenticado('/api/admin/zoho/enviar', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          destinatarios: lote,
          asunto: params.asunto,
          cuerpoHtml: params.cuerpoHtml,
          remitente: params.remitente,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        if (Array.isArray(data.resultados)) resultados.push(...data.resultados);
        return { success: false, resultados, error: data.error || 'No se pudo mandar el lote.' };
      }
      resultados.push(...(data.resultados || []));
    } catch (err: any) {
      return { success: false, resultados, error: err?.message || 'Error de red' };
    }
    onProgreso?.(Math.min(i + TAMANO_LOTE, params.destinatarios.length), params.destinatarios.length);
  }
  return { success: true, resultados };
}

export async function obtenerHistorialZoho(): Promise<EnvioZoho[]> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/zoho/historial');
    const data = await res.json();
    return res.ok && data.success ? data.envios : [];
  } catch {
    return [];
  }
}

/** Parsea un CSV simple (con o sin comillas) a una lista de destinatarios de campaña. */
export function parsearCsvDestinatarios(textoCsv: string): DestinatarioCampana[] {
  const lineas = textoCsv.split(/\r?\n/).filter((linea) => linea.trim().length > 0);
  if (lineas.length < 2) return [];
  const parsearLinea = (linea: string): string[] =>
    linea
      .split(',')
      .map((valor) => valor.trim().replace(/^"|"$/g, ''));
  // Se aceptan también los nombres de columna más comunes (caso real 25/9: un CSV con
  // "Nombre_Colegio,Localidad,Email" y BOM de Excel dejaba {{institucion}} vacío en cada correo).
  const encabezados = parsearLinea(lineas[0].replace(/^\uFEFF/, '')).map((h) =>
    h.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_')
  );
  const buscar = (...nombres: string[]) => encabezados.findIndex((h) => nombres.includes(h));
  const idxEmail = buscar('to', 'email', 'mail', 'correo', 'e-mail');
  const idxInstitucion = buscar('institucion', 'nombre_colegio', 'colegio', 'nombre', 'escuela', 'nombre_institucion');
  const idxLocalidad = buscar('localidad_partido', 'localidad', 'partido', 'ciudad', 'zona');
  const idxNivel = encabezados.indexOf('nivel');
  if (idxEmail === -1) return [];
  return lineas.slice(1).map((linea) => {
    const valores = parsearLinea(linea);
    return {
      email: valores[idxEmail] || '',
      institucion: idxInstitucion >= 0 ? valores[idxInstitucion] : undefined,
      localidad_partido: idxLocalidad >= 0 ? valores[idxLocalidad] : undefined,
      nivel: idxNivel >= 0 ? valores[idxNivel] : undefined,
    };
  }).filter((d) => d.email);
}
