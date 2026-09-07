import { fetchAdminAutenticado } from './adminAuthService';

export type EstadoInscripcion = 'pendiente' | 'aceptado' | 'rechazado';

export interface AlumnoHermano {
  id: string;
  alumnoNombre: string;
  alumnoApellido: string;
  grado: string;
  division: string;
  turno: string;
  colegioId?: string;
  colegioNombre?: string;
  codigoCurso?: string;
}

export interface InscripcionFamilia {
  id: string;
  padreNombre: string;       // Nombre y apellido del padre o madre / tutor
  telefonoWhatsApp: string;  // Número de teléfono de WhatsApp
  email: string;             // Correo electrónico
  alumnoNombre: string;      // Nombre del primer alumno/hijo
  alumnoApellido: string;    // Apellido del primer alumno/hijo
  turno: string;             // Turno (Mañana, Tarde, Jornada Completa)
  grado: string;             // Grado o Sala
  division: string;          // División
  colegioId: string;
  colegioNombre: string;
  fechaInscripcion: string;
  estado: EstadoInscripcion;
  codigoAsignado?: string;   // Código de acceso único asignado (curso o padrón)
  codigoFamiliar: string;    // Alias del código de acceso (compatibilidad con vistas existentes)
  solicitaFotoHermanos?: boolean; // Si los padres desean toma conjunta de hermanos
  hermanos?: AlumnoHermano[]; // Lista de hermanos adicionales
  fechaAprobacion?: string;
  notificacionWhatsAppEnviada?: boolean;
  notificacionEmailEnviada?: boolean;
}

/** Fila del padrón de padres autorizados (cargado por el colegio vía Excel/CSV) */
export interface FilaPadron {
  id: string;
  colegioId: string;
  nombre: string;
  telefono?: string | null;
  email?: string | null;
  alumnoNombre?: string | null;
  grado?: string | null;
  division?: string | null;
  turno?: string | null;
  codigoAsignado?: string | null;
  usado: boolean;
  createdAt?: string;
}

const STORAGE_KEY_ACTIVO = 'infocus_familia_activa_v1';

/**
 * Determines the recommended course code based on the student's sala, turno, and division.
 * Se usa solo como referencia visual (el servidor calcula el código real de forma independiente).
 */
export function determinarCodigoParaInscripcion(datos: { grado: string; turno: string; division: string }): string {
  const g = datos.grado.toLowerCase();
  const t = datos.turno.toLowerCase();
  const d = (datos.division || '').toLowerCase();

  if (g.includes('3')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA-3JE';
    if (t.includes('tarde') || d.includes('b')) return 'SALA-3TT';
    return 'SALA-3TM';
  }
  if (g.includes('4')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA-4JE';
    if (d.includes('c')) return 'SALA-4C';
    if (t.includes('tarde') || d.includes('b')) return 'SALA-4TT';
    return 'SALA-4A';
  }
  if (g.includes('5')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA-5JE';
    if (d.includes('c')) return 'SALA-5C';
    if (t.includes('tarde') || d.includes('b')) return 'SALA-5B';
    return 'SALA-5A';
  }

  return 'SALA-3TM';
}

/** Convierte una fila snake_case de Supabase (tabla `inscripciones`) al tipo usado en el frontend */
function mapearFilaSupabaseAInscripcion(row: any): InscripcionFamilia {
  return {
    id: row.id,
    padreNombre: row.padre_nombre || '',
    telefonoWhatsApp: row.telefono_whatsapp || '',
    email: row.email || '',
    alumnoNombre: row.alumno_nombre || '',
    alumnoApellido: row.alumno_apellido || '',
    turno: row.turno || '',
    grado: row.grado || '',
    division: row.division || '',
    colegioId: row.colegio_id || '',
    colegioNombre: row.colegio_nombre || '',
    fechaInscripcion: row.fecha_inscripcion || '',
    estado: (row.estado as EstadoInscripcion) || 'pendiente',
    codigoAsignado: row.codigo_asignado || undefined,
    codigoFamiliar: row.codigo_familiar || row.codigo_asignado || '',
    solicitaFotoHermanos: Boolean(row.solicita_foto_hermanos),
    hermanos: row.hermanos || [],
    fechaAprobacion: row.fecha_aprobacion || undefined,
    notificacionWhatsAppEnviada: Boolean(row.notificacion_whatsapp_enviada),
    notificacionEmailEnviada: Boolean(row.notificacion_email_enviada)
  };
}

/** Convierte una fila snake_case de Supabase (tabla `padres_autorizados`) al tipo usado en el frontend */
function mapearFilaPadron(row: any): FilaPadron {
  return {
    id: row.id,
    colegioId: row.colegio_id,
    nombre: row.nombre,
    telefono: row.telefono ?? null,
    email: row.email ?? null,
    alumnoNombre: row.alumno_nombre ?? null,
    grado: row.grado ?? null,
    division: row.division ?? null,
    turno: row.turno ?? null,
    codigoAsignado: row.codigo_asignado ?? null,
    usado: Boolean(row.usado),
    createdAt: row.created_at
  };
}

/**
 * Envía la inscripción al servidor. El servidor valida contra el padrón de padres autorizados
 * (cargado por el colegio) y sólo genera un código de acceso automático si el teléfono o el
 * email coinciden con un padre autorizado; en caso contrario, la inscripción queda "pendiente"
 * para revisión manual del fotógrafo.
 */
export interface ResultadoValidarInscripcion {
  success: boolean;
  estado?: EstadoInscripcion;
  codigoAcceso?: string | null;
  inscripcion?: InscripcionFamilia;
  error?: string;
}

export async function validarEInscribirFamilia(datos: {
  colegioId: string;
  colegioNombre: string;
  padreNombre: string;
  telefonoWhatsApp: string;
  email: string;
  alumnoNombre: string;
  alumnoApellido: string;
  grado: string;
  division: string;
  turno: string;
  solicitaFotoHermanos?: boolean;
  hermanos?: AlumnoHermano[];
}): Promise<ResultadoValidarInscripcion> {
  try {
    const res = await fetch('/api/inscripciones/validar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(datos)
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No pudimos registrar la inscripción. Intentá nuevamente.' };
    }
    const inscripcion = mapearFilaSupabaseAInscripcion(data.inscripcion);
    guardarFamiliaActiva(inscripcion);
    return { success: true, estado: data.estado, codigoAcceso: data.codigoAcceso, inscripcion };
  } catch (err: any) {
    console.error('Error al validar/inscribir familia:', err);
    return { success: false, error: 'Error al conectar con el servidor. Verificá tu conexión e intentá de nuevo.' };
  }
}

/**
 * Busca la inscripción propia por código de acceso, teléfono o email (endpoint público,
 * sólo devuelve como máximo un registro propio, nunca la tabla completa).
 */
export async function buscarMiInscripcion(query: string): Promise<InscripcionFamilia | null> {
  try {
    if (!query || query.trim().length < 3) return null;
    const res = await fetch('/api/inscripciones/buscar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim() })
    });
    const data = await res.json();
    if (!res.ok || !data.success || !data.inscripcion) return null;
    return mapearFilaSupabaseAInscripcion(data.inscripcion);
  } catch (err) {
    console.error('Error al buscar inscripción:', err);
    return null;
  }
}

/** Panel admin: lista completa de inscripciones (requiere sesión de administrador) */
export async function obtenerInscripcionesAdmin(): Promise<InscripcionFamilia[]> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/inscripciones');
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return (data.inscripciones || []).map(mapearFilaSupabaseAInscripcion);
  } catch (err) {
    console.error('Error al obtener inscripciones (admin):', err);
    return [];
  }
}

export interface ResultadoAprobarInscripcion {
  success: boolean;
  familia?: InscripcionFamilia;
  codigo?: string;
  error?: string;
}

/** Panel admin: aprueba una inscripción pendiente y le asigna (o confirma) el código de acceso */
export async function aprobarInscripcionAdmin(
  id: string,
  codigoPersonalizado?: string
): Promise<ResultadoAprobarInscripcion> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/inscripciones/${encodeURIComponent(id)}/aprobar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ codigo: codigoPersonalizado })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Error al aprobar la inscripción' };
    }
    return { success: true, familia: mapearFilaSupabaseAInscripcion(data.inscripcion), codigo: data.codigo };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al aprobar la inscripción' };
  }
}

export interface ResultadoEnviarEmailAprobacion {
  success: boolean;
  error?: string;
}

/** Panel admin: envía de verdad (vía Resend) el email con el Código de Acceso a una familia ya aprobada */
export async function enviarEmailAprobacionAdmin(id: string): Promise<ResultadoEnviarEmailAprobacion> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/inscripciones/${encodeURIComponent(id)}/enviar-email`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo enviar el email' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al enviar el email' };
  }
}

export interface ResultadoRechazarInscripcion {
  success: boolean;
  familia?: InscripcionFamilia;
  error?: string;
}

/** Panel admin: rechaza una inscripción */
export async function rechazarInscripcionAdmin(
  id: string
): Promise<ResultadoRechazarInscripcion> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/inscripciones/${encodeURIComponent(id)}/rechazar`, {
      method: 'POST'
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Error al rechazar la inscripción' };
    }
    return { success: true, familia: mapearFilaSupabaseAInscripcion(data.inscripcion) };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al rechazar la inscripción' };
  }
}

/** Panel admin: lista el padrón de padres autorizados, opcionalmente filtrado por colegio */
export async function obtenerPadronAdmin(colegioId?: string): Promise<FilaPadron[]> {
  try {
    const url = colegioId
      ? `/api/admin/padron?colegioId=${encodeURIComponent(colegioId)}`
      : '/api/admin/padron';
    const res = await fetchAdminAutenticado(url);
    const data = await res.json();
    if (!res.ok || !data.success) return [];
    return (data.padron || []).map(mapearFilaPadron);
  } catch (err) {
    console.error('Error al obtener el padrón:', err);
    return [];
  }
}

/** Panel admin: importa filas ya parseadas (desde un Excel/CSV leído en el navegador) al padrón */
export async function importarPadronAdmin(
  filas: Array<{
    colegioId: string;
    nombre: string;
    telefono?: string;
    email?: string;
    alumnoNombre?: string;
    grado?: string;
    division?: string;
    turno?: string;
    codigoAsignado?: string;
  }>,
  colegioId: string
): Promise<{ success: boolean; importados?: number; descartados?: number; error?: string }> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/padron/importar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ filas, colegioId })
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'Error al importar el padrón' };
    }
    return { success: true, importados: data.importados, descartados: data.descartados };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al importar el padrón' };
  }
}

/** Panel admin: elimina una fila del padrón */
export async function eliminarPadronAdmin(id: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/padron/${encodeURIComponent(id)}`, {
      method: 'DELETE'
    });
    return await res.json();
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al eliminar del padrón' };
  }
}

/**
 * Formats official WhatsApp approval text with the family's single access code and siblings
 */
export function generarMensajeWhatsAppAprobacion(familia: InscripcionFamilia, codigo: string): string {
  const hijosNombres = [
    `${familia.alumnoNombre} (${familia.grado} ${familia.division} - Turno ${familia.turno})`,
    ...(familia.hermanos || []).map(
      (h) => `${h.alumnoNombre} (${h.grado} ${h.division} - Turno ${h.turno})`
    )
  ].join(', ');

  const fotoHermanosNota = familia.solicitaFotoHermanos
    ? `\n📸 *Foto de hermanos:* Incluida en la sesión fotográfica.`
    : '';

  return `¡Hola ${familia.padreNombre}! Tu inscripción familiar en el portal de fotos escolares para *${hijosNombres}* (${familia.colegioNombre}) ha sido APROBADA con éxito por el equipo fotográfico.\n\n🔑 Tu *CÓDIGO DE ACCESO* es: *${codigo}*${fotoHermanosNota}\n\nCon este único código podrás ingresar al portal, ver las galerías protegidas de todos tus hijos en un solo lugar y armar tu pedido o combos con un solo pago.\n\nAccedé directamente aquí: https://retratoescolar.com.ar`;
}

/**
 * Builds WhatsApp link to send the family access code to the parent
 */
export function generarEnlaceWhatsAppAprobacion(familia: InscripcionFamilia, codigo: string): string {
  const cleanPhone = familia.telefonoWhatsApp.replace(/[^\d]/g, '');
  const mensaje = generarMensajeWhatsAppAprobacion(familia, codigo);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Prepara el contenido y asunto formal del correo de aprobación con el código de acceso asignado
 */
export function prepararEmailAprobacion(familia: InscripcionFamilia, codigo: string) {
  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const listaHijos = [
    `• ${familia.alumnoNombre} ${familia.alumnoApellido} (${familia.grado} "${familia.division}", Turno ${familia.turno})`,
    ...(familia.hermanos || []).map(
      (h) => `• ${h.alumnoNombre} ${h.alumnoApellido} (${h.grado} "${h.division}", Turno ${h.turno})`
    )
  ].join('\n');

  const asunto = `Retrato Escolar: Tu Código de Acceso (${codigo}) - ${familia.colegioNombre}`;
  const contenido = `Estimado/a ${familia.padreNombre},\n\nLe confirmamos que su registro familiar para el ciclo escolar 2026 en ${familia.colegioNombre} ha sido validado con éxito.\n\nAlumnos vinculados a su cuenta familiar:\n${listaHijos}\n${familia.solicitaFotoHermanos ? '✓ Foto de hermanos juntos: Solicitada y programada\n' : ''}\n=========================================\nSU CÓDIGO DE ACCESO: ${codigo}\n=========================================\n\nCon este único código podrá:\n1. Ingresar a retratoescolar.com.ar\n2. Ver las galerías individuales y grupales de todos sus hijos sin tener que usar códigos diferentes.\n3. Seleccionar las fotos favoritas y armar un pedido consolidado en un solo pago.\n\nPara cualquier consulta, nuestro equipo fotográfico está a su entera disposición.\n\nAtentamente,\nEquipo de Fotografía Escolar · Retrato Escolar (retratoescolar.com.ar)`;

  return {
    asunto,
    destinatario: familia.email,
    telefono: familia.telefonoWhatsApp,
    contenido,
    timestamp: fechaStr
  };
}

// Alias para compatibilidad
export const simularEnvioEmailAprobacion = prepararEmailAprobacion;

/** Sesión activa de familia en este navegador (caché local, no reemplaza la base de datos) */
export function obtenerFamiliaActiva(): InscripcionFamilia | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_ACTIVO);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function guardarFamiliaActiva(familia: InscripcionFamilia | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (familia) {
      localStorage.setItem(STORAGE_KEY_ACTIVO, JSON.stringify(familia));
    } else {
      localStorage.removeItem(STORAGE_KEY_ACTIVO);
    }
    // Notifica a otros componentes en la misma pestaña (ej. Hero) que la sesión de familia activa cambió
    window.dispatchEvent(new CustomEvent('infocus_familia_activa_actualizada', { detail: familia }));
  } catch (err) {
    console.error('Error al guardar familia activa:', err);
  }
}

export function cerrarSesionFamilia(): void {
  guardarFamiliaActiva(null);
}
