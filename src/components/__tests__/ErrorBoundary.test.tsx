import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ErrorBoundary from '../ErrorBoundary';

function Explota(): never {
  throw new Error('boom');
}

// Auditoría 2026-09-23: sin Error Boundary, un error de render en cualquier modal dejaba toda la
// página en blanco. Verifica que el error quede contenido y que "Cerrar" devuelva el control.
describe('ErrorBoundary', () => {
  it('muestra un aviso en vez de romper la página y permite cerrar el modal', () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const onCerrar = vi.fn();
    render(
      <div>
        <p>Contenido de la home</p>
        <ErrorBoundary variante="modal" onCerrar={onCerrar}>
          <Explota />
        </ErrorBoundary>
      </div>
    );
    expect(screen.getByText('Contenido de la home')).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toMatch(/algo salió mal/i);
    fireEvent.click(screen.getByRole('button', { name: /cerrar/i }));
    expect(onCerrar).toHaveBeenCalledTimes(1);
    errorSpy.mockRestore();
  });

  it('renderiza los hijos normalmente cuando no hay error', () => {
    render(
      <ErrorBoundary>
        <p>Todo bien</p>
      </ErrorBoundary>
    );
    expect(screen.getByText('Todo bien')).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });
});
