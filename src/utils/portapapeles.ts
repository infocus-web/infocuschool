/**
 * Copia texto al portapapeles de forma segura. Auditoría 2026-09-24: `navigator.clipboard` no
 * existe en los navegadores internos de algunas apps (Instagram, Facebook, WhatsApp) ni fuera de
 * HTTPS, y además puede rechazar la promesa si el navegador niega el permiso. Antes cada botón
 * llamaba `navigator.clipboard.writeText(...)` directo: tiraba un error y la pantalla igual decía
 * "Copiado" sin haber copiado nada. Acá se intenta la API moderna y, si no está o falla, el método
 * clásico con un <textarea> temporal. Devuelve si realmente se pudo copiar.
 */
export async function copiarAlPortapapeles(texto: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(texto);
      return true;
    }
  } catch {
    // Se intenta el método clásico de abajo.
  }
  try {
    const area = document.createElement('textarea');
    area.value = texto;
    area.setAttribute('readonly', '');
    area.style.position = 'fixed';
    area.style.top = '-1000px';
    area.style.opacity = '0';
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(area);
    return ok;
  } catch {
    return false;
  }
}
