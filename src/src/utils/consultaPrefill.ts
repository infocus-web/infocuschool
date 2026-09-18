// Auditoría 2026-09-18 (reporte de Pablo): varios botones de "contactanos" del sitio usaban
// enlaces mailto:, pero un mailto: no hace nada visible si el navegador/dispositivo no tiene
// un cliente de correo configurado (muy común en desktop con Gmail web) — el cliente hacía
// clic y no pasaba nada, sin ningún aviso de error. Como estos botones ya no pueden usar
// WhatsApp (pedido explícito de Pablo: "los clientes no deben poder comunicarse por whatsapp
// bajo ningun punto de la web, solo por el sistema de mensajeria de la misma"), la solución
// correcta es llevar a la familia al formulario de Consultas propio del sitio (que sí manda un
// mensaje real, guardado en la base y visible en el panel admin) en vez de un mailto.
//
// Este helper guarda unos datos ya conocidos (pedido, alumno, colegio) en sessionStorage justo
// antes de scrollear al formulario, para que la familia no tenga que volver a tipearlos.
// ContactoSection los lee una sola vez al montar y los borra.

const CLAVE_PREFILL = 'rp_consulta_prefill';

export interface ConsultaPrefill {
  nombre?: string;
  telefono?: string;
  colegio?: string;
  numeroPedido?: string;
  asunto?: string;
  mensaje?: string;
}

/** Guarda los datos y lleva a la familia al formulario de Consultas (mismo sitio, sin recargar). */
export function irAConsultasConDatos(datos: ConsultaPrefill, cerrarModal?: () => void) {
  try {
    sessionStorage.setItem(CLAVE_PREFILL, JSON.stringify(datos));
  } catch {
    // Si sessionStorage no está disponible (modo privado estricto, etc.) el formulario igual
    // se abre vacío — no es motivo para bloquear la navegación.
  }
  cerrarModal?.();
  // Pequeño delay: si había un modal abierto, le da tiempo a desmontarse antes de scrollear,
  // así el navegador calcula bien la posición de la sección de contacto.
  setTimeout(() => {
    document.getElementById('contacto')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, 120);
}

/** Lee (y borra) los datos guardados por irAConsultasConDatos. Devuelve null si no hay nada. */
export function leerYLimpiarConsultaPrefill(): ConsultaPrefill | null {
  try {
    const crudo = sessionStorage.getItem(CLAVE_PREFILL);
    if (!crudo) return null;
    sessionStorage.removeItem(CLAVE_PREFILL);
    return JSON.parse(crudo) as ConsultaPrefill;
  } catch {
    return null;
  }
}
