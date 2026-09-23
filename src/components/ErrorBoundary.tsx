import { Component, ErrorInfo, ReactNode } from 'react';

/**
 * Auditoría 2026-09-23: la app no tenía ningún Error Boundary — cualquier error de render en
 * cualquier componente (ver el "Error #310" que dejó la web en blanco el 23/9, comentado en
 * PortalFamiliasModal.tsx) desmontaba TODA la página y la familia veía una pantalla vacía, sin
 * forma de seguir. Esto captura el error, lo deja en la consola y muestra un aviso con salida.
 *
 * - `variante="pagina"`: pantalla completa con botón para recargar (envuelve toda la app).
 * - `variante="modal"`: overlay chico sobre la página, que sigue funcionando; "Cerrar" llama a
 *   `onCerrar` y reinicia el boundary para que el modal se pueda volver a abrir.
 */
interface Props {
  children: ReactNode;
  variante?: 'pagina' | 'modal';
  onCerrar?: () => void;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  // El proyecto no instala @types/react (React 19 no trae tipos propios), así que la clase base
  // queda sin tipar: se declaran acá los miembros que se usan.
  declare readonly props: Readonly<Props>;
  declare setState: (estado: State) => void;
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary] Error inesperado en la interfaz:', error, info.componentStack);
  }

  private cerrar = () => {
    this.setState({ error: null });
    this.props.onCerrar?.();
  };

  private recargar = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    const esModal = this.props.variante === 'modal';
    return (
      <div
        role="alert"
        className={
          esModal
            ? 'fixed inset-0 z-[100] flex items-center justify-center bg-slate-950/70 p-4'
            : 'min-h-screen flex items-center justify-center bg-slate-50 p-4'
        }
      >
        <div className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-6 text-center shadow-xl">
          <h2 className="text-lg font-extrabold text-slate-900">Algo salió mal</h2>
          <p className="mt-2 text-sm leading-relaxed text-slate-600">
            Tuvimos un problema al mostrar esta pantalla. Tus datos y pedidos no se perdieron. Probá
            recargar la página; si el problema sigue, escribinos desde el formulario de Consultas.
          </p>
          <div className="mt-5 flex flex-wrap justify-center gap-2">
            <button
              type="button"
              onClick={this.recargar}
              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-bold text-slate-950 hover:bg-amber-300"
            >
              Recargar la página
            </button>
            {esModal && (
              <button
                type="button"
                onClick={this.cerrar}
                className="rounded-xl border border-slate-300 px-4 py-2 text-sm font-bold text-slate-700 hover:bg-slate-100"
              >
                Cerrar
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }
}
