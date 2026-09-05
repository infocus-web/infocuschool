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
  codigoAsignado?: string;   // Código de curso asignado o código de acceso
  codigoFamiliar: string;    // Código Familiar único para todos los hermanos (ej: FAM-4821)
  solicitaFotoHermanos?: boolean; // Si los padres desean toma conjunta de hermanos
  hermanos?: AlumnoHermano[]; // Lista de hermanos adicionales
  fechaAprobacion?: string;
  notificacionWhatsAppEnviada?: boolean;
  notificacionEmailEnviada?: boolean;
}

const STORAGE_KEY_INSCRIPCIONES = 'infocus_familias_inscriptas_v1';
const STORAGE_KEY_ACTIVO = 'infocus_familia_activa_v1';

export function generarCodigoFamiliarUnico(existentes: InscripcionFamilia[] = []): string {
  const usados = new Set(existentes.map((f) => (f.codigoFamiliar || '').toUpperCase()));
  let codigo = '';
  do {
    const num = Math.floor(1000 + Math.random() * 9000);
    codigo = `FAM-${num}`;
  } while (usados.has(codigo));
  return codigo;
}

// Registro inicial de inscripciones (vacío por defecto para que las familias no vean datos ficticios)
const INSCRIPCIONES_INICIALES: InscripcionFamilia[] = [];

/**
 * Determines the recommended course code based on the student's sala, turno, and division.
 */
export function determinarCodigoParaInscripcion(datos: { grado: string; turno: string; division: string }): string {
  const g = datos.grado.toLowerCase();
  const t = datos.turno.toLowerCase();
  const d = (datos.division || '').toLowerCase();

  if (g.includes('3')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA3JE';
    if (t.includes('tarde') || d.includes('b')) return 'SALA3TT';
    return 'SALA3TM';
  }
  if (g.includes('4')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA4JE';
    if (d.includes('c')) return 'SALA4C';
    if (t.includes('tarde') || d.includes('b')) return 'SALA4TT';
    return 'SALA4A';
  }
  if (g.includes('5')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA5JE';
    if (d.includes('c')) return 'SALA5C';
    if (t.includes('tarde') || d.includes('b')) return 'SALA5B';
    return 'SALA5A';
  }

  return 'SALA3TM';
}

export function obtenerInscripciones(): InscripcionFamilia[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INSCRIPCIONES);
    if (!raw) {
      return [];
    }
    const parsed: InscripcionFamilia[] = JSON.parse(raw);
    // Remove sample/mock registrations (Benjamín Gómez, Mateo Benítez, Sofía Rossi)
    const cleaned = parsed.filter(
      (item) =>
        !['INS-2026-001', 'INS-2026-002', 'INS-2026-003'].includes(item.id) &&
        !['Benjamín Gómez', 'Mateo Benítez', 'Sofía Rossi'].includes(
          `${item.alumnoNombre} ${item.alumnoApellido}`.trim()
        )
    );
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(STORAGE_KEY_INSCRIPCIONES, JSON.stringify(cleaned));
    }
    return cleaned.map((item, idx) => ({
      ...item,
      estado: item.estado || 'pendiente',
      codigoFamiliar: item.codigoFamiliar || `FAM-${String(1000 + idx).slice(-4)}`,
      codigoAsignado: item.codigoAsignado || item.codigoFamiliar || determinarCodigoParaInscripcion(item),
      hermanos: item.hermanos || [],
      solicitaFotoHermanos: item.solicitaFotoHermanos ?? Boolean(item.hermanos && item.hermanos.length > 0)
    }));
  } catch (err) {
    console.error('Error al leer inscripciones:', err);
    return [];
  }
}

export function guardarInscripcion(
  datos: Omit<InscripcionFamilia, 'id' | 'fechaInscripcion' | 'estado' | 'codigoFamiliar'> & {
    codigoFamiliar?: string;
  }
): InscripcionFamilia {
  const lista = obtenerInscripciones();
  const idNuevo = `INS-2026-${String(lista.length + 1).padStart(3, '0')}`;
  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const codigoFamiliar = (datos.codigoFamiliar || generarCodigoFamiliarUnico(lista)).trim().toUpperCase();
  const codigoSugerido = determinarCodigoParaInscripcion(datos);

  const nueva: InscripcionFamilia = {
    ...datos,
    id: idNuevo,
    fechaInscripcion: fechaStr,
    estado: 'pendiente',
    codigoFamiliar,
    codigoAsignado: codigoFamiliar, // El código de acceso principal ahora es el Código Familiar único
    hermanos: datos.hermanos || [],
    solicitaFotoHermanos: datos.solicitaFotoHermanos ?? Boolean(datos.hermanos && datos.hermanos.length > 0),
    notificacionWhatsAppEnviada: false,
    notificacionEmailEnviada: false
  };

  const actualizada = [nueva, ...lista];
  try {
    localStorage.setItem(STORAGE_KEY_INSCRIPCIONES, JSON.stringify(actualizada));
    guardarFamiliaActiva(nueva);
    window.dispatchEvent(new CustomEvent('infocus_inscripciones_updated', { detail: actualizada }));
  } catch (err) {
    console.error('Error al guardar inscripción:', err);
  }

  return nueva;
}

/**
 * Approves a registration from the photographer's panel.
 * Sets estado = 'aceptado', assigns the code, registers timestamps,
 * and generates dispatch metadata for WhatsApp & Email.
 */
export function aprobarInscripcion(
  id: string,
  codigoPersonalizado?: string
): { familia: InscripcionFamilia; codigo: string } | null {
  const lista = obtenerInscripciones();
  const index = lista.findIndex((item) => item.id === id);
  if (index === -1) return null;

  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const item = lista[index];
  const codigoFinal = (
    codigoPersonalizado ||
    item.codigoFamiliar ||
    item.codigoAsignado ||
    generarCodigoFamiliarUnico(lista)
  ).trim().toUpperCase();

  const familiaActualizada: InscripcionFamilia = {
    ...item,
    estado: 'aceptado',
    codigoFamiliar: item.codigoFamiliar || codigoFinal,
    codigoAsignado: codigoFinal,
    fechaAprobacion: fechaStr,
    notificacionWhatsAppEnviada: true,
    notificacionEmailEnviada: true
  };

  lista[index] = familiaActualizada;

  try {
    localStorage.setItem(STORAGE_KEY_INSCRIPCIONES, JSON.stringify(lista));

    // Update active family if matches
    const activa = obtenerFamiliaActiva();
    if (activa && activa.id === id) {
      guardarFamiliaActiva(familiaActualizada);
    }

    window.dispatchEvent(new CustomEvent('infocus_inscripciones_updated', { detail: lista }));
  } catch (err) {
    console.error('Error al aprobar inscripción:', err);
  }

  return { familia: familiaActualizada, codigo: codigoFinal };
}

/**
 * Rejects an inscription if needed.
 */
export function rechazarInscripcion(id: string): InscripcionFamilia | null {
  const lista = obtenerInscripciones();
  const index = lista.findIndex((item) => item.id === id);
  if (index === -1) return null;

  lista[index] = {
    ...lista[index],
    estado: 'rechazado'
  };

  try {
    localStorage.setItem(STORAGE_KEY_INSCRIPCIONES, JSON.stringify(lista));
    window.dispatchEvent(new CustomEvent('infocus_inscripciones_updated', { detail: lista }));
  } catch (err) {
    console.error('Error al rechazar inscripción:', err);
  }

  return lista[index];
}

/**
 * Formats official WhatsApp approval text with single family code and siblings
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

  return `¡Hola ${familia.padreNombre}! Tu inscripción familiar en el portal de fotos escolares para *${hijosNombres}* (${familia.colegioNombre}) ha sido APROBADA con éxito por el equipo fotográfico.\n\n🔑 Tu *CÓDIGO FAMILIAR ÚNICO* es: *${codigo}*${fotoHermanosNota}\n\nCon este único código podrás ingresar al portal, ver las galerías protegidas de todos tus hijos en un solo lugar y armar tu pedido o combos con un solo pago.\n\nAccedé directamente aquí: https://retratoescolar.com.ar`;
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
 * Prepara el contenido y asunto formal del correo de aprobación con el código familiar asignado
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

  const asunto = `Retrato Escolar: Tu Código Familiar Único (${codigo}) - ${familia.colegioNombre}`;
  const contenido = `Estimado/a ${familia.padreNombre},\n\nLe confirmamos que su registro familiar para el ciclo escolar 2026 en ${familia.colegioNombre} ha sido validado con éxito.\n\nAlumnos vinculados a su cuenta familiar:\n${listaHijos}\n${familia.solicitaFotoHermanos ? '✓ Foto de hermanos juntos: Solicitada y programada\n' : ''}\n=========================================\nSU CÓDIGO FAMILIAR ÚNICO: ${codigo}\n=========================================\n\nCon este único código de familia podrá:\n1. Ingresar a retratoescolar.com.ar\n2. Ver las galerías individuales y grupales de todos sus hijos sin tener que usar códigos diferentes.\n3. Seleccionar las fotos favoritas y armar un pedido consolidado en un solo pago.\n\nPara cualquier consulta, nuestro equipo fotográfico está a su entera disposición.\n\nAtentamente,\nEquipo de Fotografía Escolar · Retrato Escolar (retratoescolar.com.ar)`;

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
    window.dispatchEvent(new CustomEvent('infocus_inscripciones_updated', { detail: familia }));
  } catch (err) {
    console.error('Error al guardar familia activa:', err);
  }
}

export function cerrarSesionFamilia(): void {
  guardarFamiliaActiva(null);
}

export function buscarFamiliaPorCodigoOFamilia(query: string): InscripcionFamilia | undefined {
  if (!query || query.trim().length < 2) return undefined;
  const q = query.trim().toUpperCase();
  const qClean = q.replace(/[\s-+()]/g, '');
  const lista = obtenerInscripciones();

  return lista.find((item) => {
    // 1. Coincidencia exacta con Código Familiar (ej: FAM-4821)
    if (item.codigoFamiliar && item.codigoFamiliar.toUpperCase() === q) return true;
    // 2. Coincidencia con código asignado anterior
    if (item.codigoAsignado && item.codigoAsignado.toUpperCase() === q) return true;
    // 3. Email
    if (item.email.trim().toLowerCase() === query.trim().toLowerCase()) return true;
    // 4. Celular limpio
    const telClean = item.telefonoWhatsApp.replace(/[\s-+()]/g, '');
    if (telClean && (telClean.includes(qClean) || qClean.includes(telClean)) && qClean.length >= 6) return true;
    // 5. Nombre de alumno principal o hermanos
    const nombreCompleto = `${item.alumnoNombre} ${item.alumnoApellido}`.toUpperCase();
    if (nombreCompleto.includes(q)) return true;
    if (item.hermanos && item.hermanos.some((h) => `${h.alumnoNombre} ${h.alumnoApellido}`.toUpperCase().includes(q))) {
      return true;
    }
    return false;
  });
}

export function buscarFamiliaPorContacto(query: string): InscripcionFamilia | undefined {
  return buscarFamiliaPorCodigoOFamilia(query);
}
