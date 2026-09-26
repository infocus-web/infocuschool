import { describe, expect, it } from 'vitest';
import { fotoVisibleParaAlumno, nombresCompatibles } from '../nombresAlumno';

describe('nombresCompatibles', () => {
  it('ignora orden, acentos, mayúsculas y un segundo nombre faltante', () => {
    expect(nombresCompatibles('Juan Pérez', 'PEREZ, Juan Martín')).toBe(true);
    expect(nombresCompatibles('María José García', 'garcia maria jose')).toBe(true);
  });
  it('no confunde alumnos distintos', () => {
    expect(nombresCompatibles('Juan Pérez', 'Juan Gómez')).toBe(false);
    expect(nombresCompatibles('', 'Juan')).toBe(false);
  });
});

describe('fotoVisibleParaAlumno', () => {
  it('muestra grupales y fotos sin etiqueta a todo el curso', () => {
    expect(fotoVisibleParaAlumno({ categoria: 'grupal', alumnoNombre: 'Otro Chico' }, 'Juan Pérez')).toBe(true);
    expect(fotoVisibleParaAlumno({ categoria: 'individual' }, 'Juan Pérez')).toBe(true);
  });
  it('oculta la individual etiquetada con otro alumno', () => {
    expect(fotoVisibleParaAlumno({ categoria: 'individual', alumnoNombre: 'Otro Chico' }, 'Juan Pérez')).toBe(false);
    expect(fotoVisibleParaAlumno({ categoria: 'individual', alumnoNombre: 'Pérez Juan' }, 'Juan Pérez')).toBe(true);
  });
});
