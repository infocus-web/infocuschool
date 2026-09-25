import { Component, ErrorInfo, ReactNode } from 'react';
import { enviarReporteDeError } from '../services/reporteErrores';

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
  pilaComponentes?: string;
  reporte?: 'enviando' | 'enviado' | 'fallo';
  codigoReporte?: string;
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
    this.setState({ error, pilaComponentes: String(info.componentStack || '').slice(0, 3000) });
  }

  private reportar = async () => {
    const { error, pilaComponentes } = this.state;
    if (!error) return;
    this.setState({ error, pilaComponentes, reporte: 'enviando' });
    const res = await enviarReporteDeError({
      mensaje: `Pantalla caída: ${error.message}`,
      detalle: { disparador: 'ErrorBoundary', variante: this.props.variante || 'pagina', pila: String(error.stack || '').slice(0, 3000), pilaComponentes },
    });
    this.setState({ error, pilaComponentes, reporte: res.success ? 'enviado' : 'fallo', codigoReporte: res.codigo });
  };

  private cerrar = () => {
    this.setState({ error: null, pilaComponentes: undefined, reporte: undefined, codigoReporte: undefined });
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
            Tuvimos un problema al mostrar esta pantalla. Tus datos y pedidos no se perdieron. Avisanos
            con el botón y probá recargar la página.
          </p>
          {this.state.reporte === 'enviado' ? (
            <p className="mt-4 rounded-xl bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-800">
              ¡Gracias! Nuestro equipo técnico ya recibió el aviso{this.state.codigoReporte ? ` (${this.state.codigoReporte})` : ''}.
            </p>
          ) : (
            <button
              type="button"
              onClick={() => void this.reportar()}
              disabled={this.state.reporte === 'enviando'}
              className="mt-4 w-full rounded-xl bg-slate-950 px-4 py-2.5 text-sm font-bold text-white hover:bg-slate-800 disabled:opacity-60"
            >
              {this.state.reporte === 'enviando' ? 'Enviando…' : this.state.reporte === 'fallo' ? 'No se pudo enviar, reintentar' : 'Avisar al equipo técnico'}
            </button>
          )}
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
