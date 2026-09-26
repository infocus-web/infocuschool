/**
 * Auditoría 2026-09-26 (C2, CRÍTICO): llave de acceso de cada pedido.
 *
 * El servidor ya no entrega el link de descarga HD a cualquiera que tenga el UUID de un pedido:
 * hace falta además la "llave" que devuelve al crearlo (/api/pedidos/crear, /crear-multiple,
 * /api/reservas/crear) y que también viaja en la URL de vuelta de Mercado Pago / Nave (`&t=`).
 * Acá se guarda en este navegador (por id de pedido o de grupo de pago) y se agrega sola a las
 * consultas de estado. Si no está (otro dispositivo), el link igual le llega a la familia por email.
 */
const CLAVE_STORAGE = 'retrato_llaves_pedidos';

function leerLlaves(): Record<string, string> {
  try {
    const crudo = typeof window !== 'undefined' ? window.localStorage.getItem(CLAVE_STORAGE) : null;
    const datos = crudo ? JSON.parse(crudo) : {};
    return datos && typeof datos === 'object' ? datos : {};
  } catch {
    return {};
  }
}

export function guardarLlavePedido(referencias: (string | null | undefined)[], llave: string | null | undefined): void {
  if (!llave) return;
  try {
    const llaves = leerLlaves();
    for (const referencia of referencias) if (referencia) llaves[referencia] = llave;
    // Tope defensivo: sólo las últimas 200 referencias.
    const entradas = Object.entries(llaves).slice(-200);
    window.localStorage.setItem(CLAVE_STORAGE, JSON.stringify(Object.fromEntries(entradas)));
  } catch {
    /* sin almacenamiento disponible: el link igual llega por email */
  }
}

/** Llave de un pedido/grupo: la guardada, o la que vino en la URL de vuelta de la pasarela. */
export function obtenerLlavePedido(referencia: string): string | null {
  if (!referencia) return null;
  try {
    if (typeof window !== 'undefined') {
      const params = new URLSearchParams(window.location.search);
      const llaveUrl = params.get('t');
      const refUrl = params.get('pedido_id') || params.get('grupo_pago_id');
      if (llaveUrl && refUrl && refUrl === referencia) {
        guardarLlavePedido([referencia], llaveUrl);
        return llaveUrl;
      }
    }
  } catch {
    /* URL inválida: se sigue con lo guardado */
  }
  return leerLlaves()[referencia] || null;
}

/** URL de /api/pedidos/:id/status con la llave del pedido, si este navegador la tiene. */
export function urlEstadoPedido(referencia: string): string {
  const llave = obtenerLlavePedido(referencia);
  return `/api/pedidos/${encodeURIComponent(referencia)}/status${llave ? `?t=${encodeURIComponent(llave)}` : ''}`;
}
