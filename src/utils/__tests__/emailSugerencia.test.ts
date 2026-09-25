import { describe, expect, it } from 'vitest';
import { sugerirCorreccionEmail } from '../emailSugerencia';

describe('sugerirCorreccionEmail', () => {
  it('corrige errores de tipeo comunes en el dominio', () => {
    expect(sugerirCorreccionEmail('mariaalejandraliendo@gmail.comm')).toBe('mariaalejandraliendo@gmail.com');
    expect(sugerirCorreccionEmail('ana@gmial.com')).toBe('ana@gmail.com');
    expect(sugerirCorreccionEmail('ana@hotmial.com')).toBe('ana@hotmail.com');
    expect(sugerirCorreccionEmail('Ana@Gmail.con')).toBe('ana@gmail.com');
    expect(sugerirCorreccionEmail('ana@yahoo.com.ra')).toBe('ana@yahoo.com.ar');
  });

  it('no sugiere nada para emails correctos o dominios propios', () => {
    expect(sugerirCorreccionEmail('ana@gmail.com')).toBeNull();
    expect(sugerirCorreccionEmail('ana@hotmail.com.ar')).toBeNull();
    expect(sugerirCorreccionEmail('pablo@retratoescolar.com.ar')).toBeNull();
    expect(sugerirCorreccionEmail('sin-arroba')).toBeNull();
  });
});
