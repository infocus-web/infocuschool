import { obtenerFamiliaActiva } from './inscripcionesService';

/**
 * Reporte de errores "con un solo botón" (pedido de Pablo 25/9, después de que las compras Solo
 * Digital fallaran en silencio desde el 24/9): la web va anotando sola las últimas llamadas al
 * servidor que fallaron (con su respuesta), los errores de JavaScript y en qué pantalla/paso está
 * la persona. Cuando el servidor responde con un error 5xx aparece un aviso con el botón
 * "Avisar al equipo técnico", que manda todo eso a /api/errores/reportar (se guarda en la base y
 * llega por email). Así el reporte trae lo necesario para arreglarlo sin tener que preguntar.
 */

export interface EventoRegistrado {
  t: string;
  tipo: 'api' | 'red' | 'js';
  resumen: string;
}

export interface PedidoDeReporte {
  titulo?: string;
  mensaje: string;
  detalle?: Record<string, unknown>;
}

const EVENTO_MOSTRAR = 'retrato:error-para-reportar';
const MAX_EVENTOS = 25;
const eventos: EventoRegistrado[] = [];
const contextoActual: Record<string, unknown> = {};
let instalado = false;

function registrarEvento(tipo: EventoRegistrado['tipo'], resumen: string) {
  eventos.push({ t: new Date().toISOString(), tipo, resumen: resumen.slice(0, 800) });
  if (eventos.length > MAX_EVENTOS) eventos.splice(0, eventos.length - MAX_EVENTOS);
}

/** Cada pantalla deja acá en qué está (paso, kit, pedido…) para que viaje con el reporte. */
export function registrarContextoDeError(clave: string, valor: unknown) {
  if (valor === undefined || valor === null || valor === '') delete contextoActual[clave];
  else contextoActual[clave] = valor;
}

/** Muestra el aviso con el botón "Avisar al equipo técnico". */
export function pedirReporteDeError(pedido: PedidoDeReporte) {
  try {
    window.dispatchEvent(new CustomEvent<PedidoDeReporte>(EVENTO_MOSTRAR, { detail: pedido }));
  } catch {
    /* navegadores muy viejos sin CustomEvent: no se muestra el aviso */
  }
}

export function escucharPedidosDeReporte(callback: (pedido: PedidoDeReporte) => void): () => void {
  const manejador = (e: Event) => callback((e as CustomEvent<PedidoDeReporte>).detail);
  window.addEventListener(EVENTO_MOSTRAR, manejador);
  return () => window.removeEventListener(EVENTO_MOSTRAR, manejador);
}

function rutaDe(input: RequestInfo | URL): string {
  try {
    const cruda = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(cruda, window.location.origin);
    return url.origin === window.location.origin ? url.pathname + url.search : url.href;
  } catch {
    return String(input);
  }
}

// Endpoints que no deben abrir el aviso: el propio reporte y la fila de estado del panel (que se
// consulta sola cada minuto; si falla ya se ve ahí).
const SIN_AVISO = ['/api/errores/reportar', '/api/admin/salud'];

/** Se llama una vez al arrancar la app. */
export function instalarCapturaDeErrores() {
  if (instalado || typeof window === 'undefined' || typeof window.fetch !== 'function') return;
  instalado = true;

  const fetchOriginal = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const ruta = rutaDe(input);
    const metodo = (init?.method || (typeof input === 'object' && 'method' in input ? (input as Request).method : 'GET')).toUpperCase();
    let respuesta: Response;
    try {
      respuesta = await fetchOriginal(input as any, init);
    } catch (err: any) {
      if (ruta.startsWith('/api/')) registrarEvento('red', `${metodo} ${ruta} → sin respuesta (${err?.message || 'error de red'})`);
      throw err;
    }
    if (respuesta.status >= 400 && ruta.startsWith('/api/')) {
      let cuerpo = '';
      try {
        cuerpo = (await respuesta.clone().text()).slice(0, 500);
      } catch {
        /* cuerpo ilegible */
      }
      registrarEvento('api', `${metodo} ${ruta} → ${respuesta.status} ${cuerpo}`);
      // El aviso se abre cuando falla una ACCIÓN (crear pedido, pagar, reservar, enviar…). Las
      // consultas en segundo plano (GET) solo se anotan: viajan en "eventos" del próximo reporte.
      if (respuesta.status >= 500 && metodo !== 'GET' && !SIN_AVISO.some((r) => ruta.startsWith(r))) {
        let mensaje = '';
        try {
          mensaje = JSON.parse(cuerpo)?.error || '';
        } catch {
          /* no era JSON */
        }
        pedirReporteDeError({
          mensaje: mensaje || `El servidor no pudo completar la operación (${respuesta.status}).`,
          detalle: { disparador: `${metodo} ${ruta}`, status: respuesta.status },
        });
      }
    }
    return respuesta;
  };

  window.addEventListener('error', (e) => {
    registrarEvento('js', `${e.message || 'error'} @ ${e.filename || ''}:${e.lineno || ''}`);
  });
  window.addEventListener('unhandledrejection', (e) => {
    const razon: any = (e as PromiseRejectionEvent).reason;
    registrarEvento('js', `Promesa rechazada: ${razon?.message || String(razon)}`);
  });
}

/** Con el panel admin abierto el aviso muestra el detalle técnico; a las familias, no. */
export function esPanelAdminAbierto(): boolean {
  return Boolean(contextoActual.panelAdmin);
}

export function emailConocidoParaReporte(): string {
  try {
    return obtenerFamiliaActiva()?.email || '';
  } catch {
    return '';
  }
}

export async function enviarReporteDeError(params: {
  mensaje: string;
  detalle?: Record<string, unknown>;
  email?: string;
}): Promise<{ success: boolean; codigo?: string; error?: string }> {
  const familia = (() => {
    try {
      return obtenerFamiliaActiva();
    } catch {
      return null;
    }
  })();
  const origen = window.location.search.includes('zoho=1') || contextoActual.panelAdmin ? 'admin' : 'familia';
  const cuerpo = {
    mensaje: params.mensaje,
    origen,
    email: params.email || familia?.email || '',
    url: window.location.href,
    detalle: {
      ...params.detalle,
      contexto: { ...contextoActual },
      familia: familia
        ? {
            nombre: familia.padreNombre,
            email: familia.email,
            alumno: `${familia.alumnoNombre || ''} ${familia.alumnoApellido || ''}`.trim(),
            grado: familia.grado,
            division: familia.division,
            turno: familia.turno,
          }
        : null,
      pantalla: { ancho: window.innerWidth, alto: window.innerHeight },
      idioma: navigator.language,
      momento: new Date().toISOString(),
      eventos: eventos.slice(),
    },
  };
  try {
    const res = await fetch('/api/errores/reportar', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cuerpo),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data.success) return { success: false, error: data.error || 'No se pudo enviar el reporte.' };
    return { success: true, codigo: data.codigo };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Sin conexión.' };
  }
}
