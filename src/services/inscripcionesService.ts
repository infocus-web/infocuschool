export type EstadoInscripcion = 'pendiente' | 'aceptado' | 'rechazado';

export interface InscripcionFamilia {
  id: string;
  padreNombre: string;       // Nombre y apellido del padre o madre / tutor
  telefonoWhatsApp: string;  // Número de teléfono de WhatsApp
  email: string;             // Correo electrónico
  alumnoNombre: string;      // Nombre del alumno
  alumnoApellido: string;    // Apellido del alumno
  turno: string;             // Turno (Mañana, Tarde, Jornada Completa)
  grado: string;             // Grado o Sala
  division: string;          // División
  colegioId: string;
  colegioNombre: string;
  fechaInscripcion: string;
  estado: EstadoInscripcion;
  codigoAsignado?: string;   // Código de curso asignado (ej: SALA3TM)
  fechaAprobacion?: string;
  notificacionWhatsAppEnviada?: boolean;
  notificacionEmailEnviada?: boolean;
}

const STORAGE_KEY_INSCRIPCIONES = 'infocus_familias_inscriptas_v1';
const STORAGE_KEY_ACTIVO = 'infocus_familia_activa_v1';

// Registro inicial de inscripciones
const INSCRIPCIONES_INICIALES: InscripcionFamilia[] = [
  {
    id: 'INS-2026-001',
    padreNombre: 'Mariana Gómez',
    telefonoWhatsApp: '+54 9 11 5489-3210',
    email: 'mariana.gomez@gmail.com',
    alumnoNombre: 'Benjamín',
    alumnoApellido: 'Gómez',
    turno: 'Tarde',
    grado: 'Sala 5 años',
    division: 'Celeste',
    colegioId: 'col-divino-pastor',
    colegioNombre: 'Instituto Superior Buenos Aires',
    fechaInscripcion: '05/03/2026 09:15',
    estado: 'pendiente',
    codigoAsignado: 'ISBA-S5B'
  },
  {
    id: 'INS-2026-002',
    padreNombre: 'Diego Benítez',
    telefonoWhatsApp: '+54 9 11 2384-9912',
    email: 'diego.benitez@outlook.com',
    alumnoNombre: 'Mateo',
    alumnoApellido: 'Benítez',
    turno: 'Mañana',
    grado: 'Sala 4 años',
    division: 'Verde',
    colegioId: 'col-divino-pastor',
    colegioNombre: 'Instituto Superior Buenos Aires',
    fechaInscripcion: '04/03/2026 14:30',
    estado: 'aceptado',
    codigoAsignado: 'ISBA-S4A',
    fechaAprobacion: '04/03/2026 15:10',
    notificacionWhatsAppEnviada: true,
    notificacionEmailEnviada: true
  },
  {
    id: 'INS-2026-003',
    padreNombre: 'Carla Rossi',
    telefonoWhatsApp: '+54 9 11 4120-7761',
    email: 'carla.rossi@yahoo.com.ar',
    alumnoNombre: 'Sofía',
    alumnoApellido: 'Rossi',
    turno: 'Mañana',
    grado: 'Sala 3 años',
    division: 'Roja',
    colegioId: 'col-divino-pastor',
    colegioNombre: 'Instituto Superior Buenos Aires',
    fechaInscripcion: '05/03/2026 08:45',
    estado: 'pendiente',
    codigoAsignado: 'ISBA-S3TM'
  }
];

/**
 * Determines the recommended course code based on the student's sala, turno, and division.
 */
export function determinarCodigoParaInscripcion(datos: { grado: string; turno: string; division: string }): string {
  const g = datos.grado.toLowerCase();
  const t = datos.turno.toLowerCase();

  if (g.includes('3')) {
    if (t.includes('tarde')) return 'SALA3TT';
    if (t.includes('jornada') || t.includes('extendida')) return 'SALA3JE';
    return 'SALA3TM';
  }
  if (g.includes('4')) {
    if (t.includes('tarde')) return 'SALA4TT';
    if (t.includes('jornada') || t.includes('extendida')) return 'SALA4JE';
    return 'SALA4A';
  }
  if (g.includes('5')) {
    if (t.includes('tarde')) return 'SALA5B';
    if (t.includes('jornada') || t.includes('extendida')) return 'SALA5JE';
    return 'SALA5A';
  }

  return 'SALA3TM';
}

export function obtenerInscripciones(): InscripcionFamilia[] {
  if (typeof window === 'undefined') return INSCRIPCIONES_INICIALES;
  try {
    const raw = localStorage.getItem(STORAGE_KEY_INSCRIPCIONES);
    if (!raw) {
      localStorage.setItem(STORAGE_KEY_INSCRIPCIONES, JSON.stringify(INSCRIPCIONES_INICIALES));
      return INSCRIPCIONES_INICIALES;
    }
    const parsed: InscripcionFamilia[] = JSON.parse(raw);
    // Ensure all items have estado
    return parsed.map((item) => ({
      ...item,
      estado: item.estado || 'pendiente',
      codigoAsignado: item.codigoAsignado || determinarCodigoParaInscripcion(item)
    }));
  } catch (err) {
    console.error('Error al leer inscripciones:', err);
    return INSCRIPCIONES_INICIALES;
  }
}

export function guardarInscripcion(
  datos: Omit<InscripcionFamilia, 'id' | 'fechaInscripcion' | 'estado'>
): InscripcionFamilia {
  const lista = obtenerInscripciones();
  const idNuevo = `INS-2026-${String(lista.length + 1).padStart(3, '0')}`;
  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const codigoSugerido = determinarCodigoParaInscripcion(datos);

  const nueva: InscripcionFamilia = {
    ...datos,
    id: idNuevo,
    fechaInscripcion: fechaStr,
    estado: 'pendiente',
    codigoAsignado: codigoSugerido,
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
  const codigoFinal = (codigoPersonalizado || item.codigoAsignado || determinarCodigoParaInscripcion(item)).trim().toUpperCase();

  const familiaActualizada: InscripcionFamilia = {
    ...item,
    estado: 'aceptado',
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
 * Formats official WhatsApp approval text
 */
export function generarMensajeWhatsAppAprobacion(familia: InscripcionFamilia, codigo: string): string {
  return `¡Hola ${familia.padreNombre}! Tu inscripción en el portal de fotos escolares para tu hijo/a ${familia.alumnoNombre} ${familia.alumnoApellido} (${familia.grado} "${familia.division}", Turno ${familia.turno} - ${familia.colegioNombre}) ha sido APROBADA con éxito por el equipo fotográfico.\n\n🔑 Tu Código de Curso para acceder a ver las fotos es: *${codigo}*\n\nCon este código podrás ingresar al portal, ver la muestra con marca de agua y seleccionar las fotos individuales y grupales para tu kit.\n\nAccedé aquí: https://retratoescolar.com.ar`;
}

/**
 * Builds WhatsApp link to send the access code to the parent
 */
export function generarEnlaceWhatsAppAprobacion(familia: InscripcionFamilia, codigo: string): string {
  const cleanPhone = familia.telefonoWhatsApp.replace(/[^\d]/g, '');
  const mensaje = generarMensajeWhatsAppAprobacion(familia, codigo);
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(mensaje)}`;
}

/**
 * Generates email content simulation for approval
 */
export function simularEnvioEmailAprobacion(familia: InscripcionFamilia, codigo: string) {
  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const asunto = `Retrato Escolar: Código de Acceso para las fotos de ${familia.alumnoNombre} (${codigo})`;
  const contenido = `Estimado/a ${familia.padreNombre},\n\nLe confirmamos que su solicitud de acceso para las fotografías escolares del ciclo 2026 de ${familia.alumnoNombre} ${familia.alumnoApellido} (${familia.grado} "${familia.division}", Turno ${familia.turno} - ${familia.colegioNombre}) ha sido verificada y aceptada por la coordinación fotográfica.\n\n=========================================\nCÓDIGO DE CURSO ASIGNADO: ${codigo}\n=========================================\n\nPasos a seguir:\n1. Ingrese a la plataforma retratoescolar.com.ar.\n2. Ingrese su código de curso "${codigo}".\n3. Seleccione a ${familia.alumnoNombre} de la nómina y elija sus tomas favoritas (individual, grupal y con docente).\n\nPara consultas adicionales o asistencia, nuestro equipo está a su disposición.\n\nAtentamente,\nEquipo de Fotografía Escolar · Retrato Escolar (retratoescolar.com.ar)`;

  return {
    asunto,
    destinatario: familia.email,
    telefono: familia.telefonoWhatsApp,
    contenido,
    timestamp: fechaStr
  };
}

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

export function buscarFamiliaPorContacto(query: string): InscripcionFamilia | undefined {
  if (!query || query.trim().length < 3) return undefined;
  const q = query.trim().toLowerCase().replace(/[\s-+()]/g, '');
  const lista = obtenerInscripciones();
  return lista.find((item) => {
    const emailMatch = item.email.toLowerCase().includes(query.trim().toLowerCase());
    const telClean = item.telefonoWhatsApp.replace(/[\s-+()]/g, '');
    const telMatch = telClean.includes(q) || q.includes(telClean);
    const alumnoMatch = `${item.alumnoNombre} ${item.alumnoApellido}`.toLowerCase().includes(query.trim().toLowerCase());
    const padreMatch = item.padreNombre.toLowerCase().includes(query.trim().toLowerCase());
    return emailMatch || telMatch || alumnoMatch || padreMatch;
  });
}
