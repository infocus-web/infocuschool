/**
 * Detecta errores de tipeo comunes en el dominio de un email ("gmail.comm", "gmial.com",
 * "hotmial.com") y devuelve el email corregido, o null si no hay nada que sugerir. Caso real
 * (25/9): una solicitud de código con "@gmail.comm" nunca podía coincidir con la inscripción.
 */
const DOMINIOS_COMUNES = [
  'gmail.com',
  'hotmail.com',
  'hotmail.com.ar',
  'yahoo.com',
  'yahoo.com.ar',
  'outlook.com',
  'outlook.com.ar',
  'live.com',
  'live.com.ar',
  'icloud.com',
];

function distancia(a: string, b: string): number {
  const fila = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    let anterior = fila[0];
    fila[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const temp = fila[j];
      fila[j] = Math.min(fila[j] + 1, fila[j - 1] + 1, anterior + (a[i - 1] === b[j - 1] ? 0 : 1));
      anterior = temp;
    }
  }
  return fila[b.length];
}

export function sugerirCorreccionEmail(email: string): string | null {
  const limpio = email.trim().toLowerCase();
  const arroba = limpio.lastIndexOf('@');
  if (arroba < 1) return null;
  const usuario = limpio.slice(0, arroba);
  const dominio = limpio.slice(arroba + 1);
  if (!dominio || DOMINIOS_COMUNES.includes(dominio)) return null;

  let mejor: { dominio: string; d: number } | null = null;
  for (const candidato of DOMINIOS_COMUNES) {
    const d = distancia(dominio, candidato);
    if (d <= 2 && (!mejor || d < mejor.d)) mejor = { dominio: candidato, d };
  }
  return mejor ? `${usuario}@${mejor.dominio}` : null;
}
