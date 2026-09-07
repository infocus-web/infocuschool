import { SECCIONES_INICIAL_2026, SeccionEscolar } from './alumnosData';

export interface CursoCodigoInfo {
  seccionId: string;
  codigo: string;
  sala: string;
  turno: string;
  division: string;
  nombreCompleto: string;
  fechaCreacion?: string;
  activo: boolean;
}

// Initial default codes for each section
export const CODIGOS_CURSOS_INICIALES: Record<string, string> = {
  's3-tm': 'SALA-3TM',
  's3-tt': 'SALA-3TT',
  's3-je': 'SALA-3JE',
  's4-a': 'SALA-4A',
  's4-tt': 'SALA-4TT',
  's4-c': 'SALA-4C',
  's4-je': 'SALA-4JE',
  's5-a': 'SALA-5A',
  's5-b-tt': 'SALA-5B',
  's5-c': 'SALA-5C',
  's5-je': 'SALA-5JE',
};

const STORAGE_KEY = 'historias_colegio_codigos_cursos_2026';

/**
 * Loads the current codes dictionary from localStorage or returns defaults
 */
export function getCodigosCursos(): Record<string, string> {
  if (typeof window === 'undefined') return CODIGOS_CURSOS_INICIALES;
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved);
      // Clean any obsolete codes like PASTOR
      for (const key of Object.keys(parsed)) {
        if (typeof parsed[key] === 'string' && parsed[key].toUpperCase().includes('PASTOR')) {
          delete parsed[key];
        }
      }
      return { ...CODIGOS_CURSOS_INICIALES, ...parsed };
    }
  } catch (e) {
    console.error('Error loading course codes from localStorage:', e);
  }
  return CODIGOS_CURSOS_INICIALES;
}

/**
 * Saves or updates a code for a specific section
 */
export function guardarCodigoCurso(seccionId: string, nuevoCodigo: string): Record<string, string> {
  const current = getCodigosCursos();
  const updated = {
    ...current,
    [seccionId]: nuevoCodigo.trim().toUpperCase(),
  };
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('codigos_cursos_updated', { detail: updated }));
  } catch (e) {
    console.error('Error saving course codes to localStorage:', e);
  }
  return updated;
}

/**
 * Generates custom or random codes for all courses
 */
export function regenerarTodosLosCodigos(tipo: 'nemotecnico' | 'pin' = 'nemotecnico'): Record<string, string> {
  const updated: Record<string, string> = {};
  SECCIONES_INICIAL_2026.forEach((sec) => {
    if (tipo === 'nemotecnico') {
      // e.g. SALA-3TM, SALA-4A, etc. (guión después de SALA para que el número no se confunda con una letra)
      const salaNum = sec.sala.replace(/\D/g, '') || '3';
      const cleanTurno = sec.turno === 'Mañana' ? 'TM' : sec.turno === 'Tarde' ? 'TT' : 'JE';
      const cleanDiv = sec.division.replace(/[^A-Za-z0-9]/g, '').slice(0, 2);
      updated[sec.id] = `SALA-${salaNum}${cleanTurno}${cleanDiv}`.toUpperCase();
    } else {
      // 5-character secure pin, e.g. INF34
      const rnd = Math.floor(100 + Math.random() * 900);
      const salaNum = sec.sala.replace(/\D/g, '') || '3';
      updated[sec.id] = `INF${salaNum}-${rnd}`;
    }
  });

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated));
    window.dispatchEvent(new CustomEvent('codigos_cursos_updated', { detail: updated }));
  } catch (e) {
    console.error('Error regenerating course codes:', e);
  }
  return updated;
}

/**
 * Finds a section matching a given code string
 */
export function buscarSeccionPorCodigo(codigo: string): { seccion: SeccionEscolar; codigoValido: string } | null {
  if (!codigo || !codigo.trim()) return null;
  const clean = codigo.trim().toUpperCase().replace(/[\s-]/g, '');
  const currentCodes = getCodigosCursos();

  for (const [secId, codeVal] of Object.entries(currentCodes)) {
    const cleanSaved = codeVal.trim().toUpperCase().replace(/[\s-]/g, '');
    if (cleanSaved === clean) {
      const seccion = SECCIONES_INICIAL_2026.find((s) => s.id === secId);
      if (seccion) {
        return { seccion, codigoValido: codeVal };
      }
    }
  }

  return null;
}

/**
 * Generates a ready-to-send WhatsApp template message for the school or parent group
 */
export function getMensajeWhatsAppParaCurso(seccion: SeccionEscolar, codigo: string): string {
  return `📸 *FOTOS ESCOLARES 2026 - ${seccion.nombreCompleto.toUpperCase()}*

¡Hola familias! Ya se encuentran listas las fotografías de la sesión escolar.

🔑 *Código de acceso exclusivo para nuestro curso:* *${codigo}*
📍 *Curso:* ${seccion.sala}
⏰ *Turno:* ${seccion.turno} · *División:* ${seccion.division}

Pueden ingresar al portal para ver la muestra protegida con marca de agua y elegir las *3 fotos que están incluidas en el paquete*:
👉 https://retratoescolar.com.ar

*Opciones disponibles:*
1️⃣ *Impresiones de laboratorio:* Incluye carpeta personalizada + fotos impresas + *los 3 archivos en HD de regalo para descargar*.
2️⃣ *Solo Digitales HD:* Los 3 archivos en máxima resolución listos para guardar en el celular y compartir.

¡Esperamos que disfruten de este hermoso recuerdo!`;
}
