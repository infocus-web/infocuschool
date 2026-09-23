import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PortalFamiliasModal from '../PortalFamiliasModal';
import { obtenerFamiliaActiva } from '../../services/inscripcionesService';
import { familiaActivaMellizos, mockearFetchFamiliaYGaleria } from '../../test/fixtures/familiaMellizos';

// Auditoría 2026-09-23 — dos regresiones que llegaron a producción:
// 1) "Página en blanco" (React error #310): un hook declarado después del `if (!isOpen) return
//    null;` rompía toda la app apenas se abría el portal. Este test alterna isOpen como lo hace
//    App.tsx (el modal queda montado) y verifica que no explote.
// 2) Sesión vieja sin DNI del tutor: desde el 22/9 el código es compartido por el curso; una
//    sesión guardada sin DNI no identifica a la familia y se descarta.
describe('PortalFamiliasModal — sesión y ciclo de apertura', () => {
  beforeEach(() => {
    localStorage.clear();
    mockearFetchFamiliaYGaleria();
  });

  it('abre, cierra y vuelve a abrir sin romper las Reglas de los Hooks', async () => {
    localStorage.setItem('infocus_familia_activa_v1', JSON.stringify(familiaActivaMellizos));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { rerender } = render(<PortalFamiliasModal isOpen={false} onClose={() => {}} />);
    rerender(<PortalFamiliasModal isOpen={true} onClose={() => {}} />);
    await screen.findByRole('button', { name: /abrir galería de fotos/i });
    rerender(<PortalFamiliasModal isOpen={false} onClose={() => {}} />);
    rerender(<PortalFamiliasModal isOpen={true} onClose={() => {}} />);
    await screen.findByRole('button', { name: /abrir galería de fotos/i });
    const erroresDeHooks = errorSpy.mock.calls.filter((c) => /more hooks|fewer hooks|order of Hooks/i.test(String(c[0])));
    expect(erroresDeHooks).toHaveLength(0);
    errorSpy.mockRestore();
  });

  it('descarta una sesión guardada con código pero sin DNI del tutor', () => {
    const { padreDni: _sinDni, ...sesionVieja } = familiaActivaMellizos;
    localStorage.setItem('infocus_familia_activa_v1', JSON.stringify(sesionVieja));
    expect(obtenerFamiliaActiva()).toBeNull();
    expect(localStorage.getItem('infocus_familia_activa_v1')).toBeNull();
  });

  it('conserva una sesión con DNI del tutor', () => {
    localStorage.setItem('infocus_familia_activa_v1', JSON.stringify(familiaActivaMellizos));
    expect(obtenerFamiliaActiva()?.padreDni).toBe(familiaActivaMellizos.padreDni);
  });
});
