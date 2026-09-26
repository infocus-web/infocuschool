/**
 * Auditoría 2026-09-26 (M6): una foto INDIVIDUAL etiquetada con el nombre de un alumno sólo se le
 * muestra (y se le vende) a la familia de ese alumno. Las fotos sin etiqueta se siguen mostrando a
 * todo el curso, como antes. La comparación es tolerante al orden y a que falte un segundo nombre:
 * "Juan Pérez" coincide con "PEREZ, Juan Martín". Debe coincidir con nombresCompatibles de server.ts.
 */
function palabras(nombre: unknown): string[] {
  return String(nombre || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export function nombresCompatibles(a: unknown, b: unknown): boolean {
  const pa = palabras(a);
  const pb = palabras(b);
  if (pa.length === 0 || pb.length === 0) return false;
  const [corto, largo] = pa.length <= pb.length ? [pa, new Set(pb)] : [pb, new Set(pa)];
  return corto.every((p) => largo.has(p));
}

/** ¿Esta foto se le puede mostrar a la familia de `alumnoNombre`? */
export function fotoVisibleParaAlumno(foto: { categoria: string; alumnoNombre?: string }, alumnoNombre: string): boolean {
  if (foto.categoria !== 'individual' || !foto.alumnoNombre) return true;
  if (!alumnoNombre.trim()) return true;
  return nombresCompatibles(foto.alumnoNombre, alumnoNombre);
}
