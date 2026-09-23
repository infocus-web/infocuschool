import { vi } from 'vitest';
import type { InscripcionFamilia } from '../../services/inscripcionesService';

// Fixture de prueba: una familia con 2 hijos mellizos en la MISMA sección (mismo curso, mismo
// código secreto) — este es exactamente el caso real de Pablo que destapó la serie de bugs de
// "carrito multi-hijo" en septiembre de 2026 (fotos cruzadas entre hermanos, avance sin validar a
// todos los hermanos, carpeta extra por hijo, conteo de carpetas base). Compartir sección es
// intencional: es el escenario que menos margen de error tiene, porque `fotosDisponibles` es
// literalmente el mismo array de referencia para los dos hermanos.
// El código familiar (`codigo_asignado`) que la familia usa para entrar NO es un token aparte:
// el servidor lo genera con `obtenerOCrearCodigoSeccion` sobre el grado/turno/división del ALUMNO
// PRINCIPAL (ver server.ts, `aprobarInscripcionAdmin`, líneas ~2994/3021) — es literalmente el
// mismo código secreto de la sección del alumno principal, el mismo que después devuelve
// `/api/familia/hijos` como `codigoSeccion` de ese hijo. Usar acá un valor DISTINTO (como hacía la
// primera versión de este fixture: `CODIGO_FAMILIAR = 'FAM-TEST-MELLIZOS'` separado de
// `CODIGO_SECCION_COMPARTIDA`) es un dato de prueba irreal, y fue justo lo que causaba que la 2ª y
// 3ª prueba de este archivo fallaran de forma reproducible: al abrir el modal, `codigoSeccionValidado`
// arranca en el código familiar inventado (`PortalFamiliasModal.tsx` línea ~793) y carga la galería
// con ESE valor; recién al cambiar de hijo (`seleccionarHijo`) pasa a valer el código real de
// sección — un cambio de valor que SÍ dispara de nuevo el fetch de la galería (efecto con
// dependencia `[codigoSeccionValidado]`) y, al resolver esa promesa, el efecto "al cambiar de
// galería" (dependencia `[fotosDisponibles]`) que limpia `errorSeleccionFotos` incondicionalmente
// — justo después de que `handleContinuarAlKit` lo hubiera puesto para avisar del hermano
// incompleto. No es un bug de la app: es un fixture con un dato que nunca podría darse en
// producción, porque ahí ambos códigos siempre son el mismo valor.
export const CODIGO_SECCION_COMPARTIDA = 'GRADO1-TARDE-A';
export const CODIGO_FAMILIAR = CODIGO_SECCION_COMPARTIDA;
export const COLEGIO_ID = 'col-divino-pastor-2026'; // = COLEGIO_POR_DEFECTO, resuelve sin red

export const familiaActivaMellizos: InscripcionFamilia = {
  id: 'insc-test-1',
  padreNombre: 'Pablo Alder',
  // Desde el 23/9 una sesión con código pero sin DNI del tutor se descarta al abrir el portal
  // (ver obtenerFamiliaActiva) — una familia real identificada siempre lo tiene.
  padreDni: '20111222',
  telefonoWhatsApp: '+5491100000000',
  email: 'pablo.alder.test@example.com',
  alumnoNombre: 'Pablo',
  alumnoApellido: 'Alder',
  alumnoDni: '00000001',
  turno: 'Tarde',
  grado: '1° grado',
  division: 'A',
  colegioId: COLEGIO_ID,
  colegioNombre: 'Instituto Madre del Divino Pastor',
  fechaInscripcion: '2026-01-01T00:00:00.000Z',
  estado: 'aceptado',
  codigoAsignado: CODIGO_FAMILIAR,
  codigoFamiliar: CODIGO_FAMILIAR,
};

// Forma que devuelve /api/familia/hijos (ver `obtenerHijosDeFamilia` en inscripcionesService.ts).
// OJO: el id del alumno principal SIEMPRE es literalmente 'principal' en producción (server.ts,
// endpoint /api/familia/hijos, candidatos[0].id) — nunca un id propio como "hijo-pablo". Un
// hermano adicional usa el id que traiga `hermanos[].id`, o `hermano-${idx}` como respaldo si no
// tiene uno. Usar un id inventado para el principal fue justamente lo que hizo fallar la primera
// versión de estas pruebas (el componente arranca con `hijoSeleccionadoId = 'principal'`, así que
// un id de fixture que no matchee ese valor rompe el primer `seleccionarHijo` de forma artificial,
// sin que sea un bug real del componente).
export const hijosMellizos = [
  {
    id: 'principal',
    nombreCompleto: 'Pablo Alder',
    colegioNombre: 'Instituto Madre del Divino Pastor',
    grado: '1° grado',
    turno: 'Tarde',
    division: 'A',
    codigoSeccion: CODIGO_SECCION_COMPARTIDA,
  },
  {
    id: 'hermano-0',
    nombreCompleto: 'Sofia Alder',
    colegioNombre: 'Instituto Madre del Divino Pastor',
    grado: '1° grado',
    turno: 'Tarde',
    division: 'A',
    codigoSeccion: CODIGO_SECCION_COMPARTIDA,
  },
];

// Forma "cruda" (fila de Supabase) que espera `obtenerGaleriaPublica` en /api/fotos: una sola toma
// por categoría alcanza para probar la selección completa (individual + grupal + docente).
export const fotosSeccionCompartida = [
  { id: 'foto-individual-1', categoria: 'individual', thumb_path: '/img/individual-1.jpg' },
  { id: 'foto-grupal-1', categoria: 'grupal', thumb_path: '/img/grupal-1.jpg' },
  { id: 'foto-docente-1', categoria: 'docente', thumb_path: '/img/docente-1.jpg' },
];

/** Registra en el `fetch` global (ya mockeado por src/test/setup.ts) las dos rutas que necesita
 *  este fixture: la lista de hijos de la familia y la galería de la sección compartida. */
export function mockearFetchFamiliaYGaleria() {
  (global.fetch as unknown as ReturnType<typeof vi.fn>).mockImplementation(async (input: RequestInfo | URL) => {
    const url = typeof input === 'string' ? input : input.toString();
    if (url.includes('/api/familia/hijos')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({ success: true, hijos: hijosMellizos }),
      } as Response;
    }
    if (url.includes('/api/fotos')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          success: true,
          seccion: { colegioId: COLEGIO_ID, grado: '1° grado', turno: 'Tarde', division: 'A' },
          fotos: fotosSeccionCompartida,
        }),
      } as Response;
    }
    return { ok: false, status: 404, json: async () => ({ success: false }) } as Response;
  });
}
