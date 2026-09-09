import { useCallback, useEffect, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  RefreshCw,
  Loader2,
  Wallet,
  CheckCircle2,
  AlertCircle,
  FileSpreadsheet,
  School,
} from 'lucide-react';
import { useColegiosLista } from '../services/colegiosService';
import { obtenerEstadoPagosColegio, AlumnoEstadoPago, PedidoSinAlumnoEnNomina, ResumenEstadoPagos } from '../services/estadoPagosService';
import { descargarLibroExcel } from '../services/excelDownloadHelper';

const RESUMEN_VACIO: ResumenEstadoPagos = { totalAlumnos: 0, alumnosPagados: 0, alumnosFaltantes: 0, totalRecaudado: 0 };

function formatearMonto(valor: number): string {
  return `$${Math.round(valor).toLocaleString('es-AR')}`;
}

export default function AdminEstadoPagosTab() {
  const { colegios } = useColegiosLista();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || '');
  const [precioPorAlumno, setPrecioPorAlumno] = useState<string>('15000');

  const [alumnos, setAlumnos] = useState<AlumnoEstadoPago[]>([]);
  const [pedidosSinAlumno, setPedidosSinAlumno] = useState<PedidoSinAlumnoEnNomina[]>([]);
  const [resumen, setResumen] = useState<ResumenEstadoPagos>(RESUMEN_VACIO);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (colegios.length > 0 && (!colegioId || !colegios.some((c) => c.id === colegioId))) {
      setColegioId(colegios[0].id);
    }
  }, [colegios, colegioId]);

  const cargarEstadoPagos = useCallback(async () => {
    if (!colegioId) return;
    setCargando(true);
    setError(null);
    const resultado = await obtenerEstadoPagosColegio(colegioId);
    if (!resultado.success) {
      setError(resultado.error || 'No se pudo obtener el estado de pagos.');
      setAlumnos([]);
      setPedidosSinAlumno([]);
      setResumen(RESUMEN_VACIO);
    } else {
      setAlumnos(resultado.alumnos);
      setPedidosSinAlumno(resultado.pedidosSinAlumnoEnNomina);
      setResumen(resultado.resumen);
    }
    setCargando(false);
  }, [colegioId]);

  useEffect(() => {
    cargarEstadoPagos();
  }, [cargarEstadoPagos]);

  const colegioSeleccionado = colegios.find((c) => c.id === colegioId);
  const precioNumerico = Number(precioPorAlumno.replace(/[^\d]/g, '')) || 0;
  const meta = precioNumerico > 0 ? resumen.totalAlumnos * precioNumerico : 0;
  const faltaParaLaMeta = Math.max(0, meta - resumen.totalRecaudado);

  const handleExportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const data = alumnos.map((a, idx) => ({
      'N°': a.numeroLista ?? idx + 1,
      'Apellido y Nombre': a.nombre,
      'Grado': a.grado,
      'Turno': a.turno || '',
      'División': a.division,
      'Estado': a.pagado ? 'Pagado' : 'Pendiente',
      'Monto': a.pedido?.total || '',
      'Kit': a.pedido?.kitNombre || '',
      'Fecha de pago': a.pedido?.fecha ? new Date(a.pedido.fecha).toLocaleDateString('es-AR') : '',
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    ws['!cols'] = [{ wch: 6 }, { wch: 30 }, { wch: 18 }, { wch: 12 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 22 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws, 'Estado de Pagos');
    const nombreArchivo = `ESTADO_PAGOS_${(colegioSeleccionado?.nombre || 'colegio').replace(/\s+/g, '_')}.xlsx`;
    descargarLibroExcel(wb, nombreArchivo);
  };

  return (
    <div className="space-y-5 text-slate-900 text-left">
      <div className="p-4 bg-amber-50/70 border border-amber-200 rounded-2xl flex items-start gap-3">
        <Wallet className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-950 leading-relaxed">
          <p className="font-bold">Estado de Pagos por Curso</p>
          <p className="mt-1 text-amber-900/90">
            Pensado para cursos con una tarifa total acordada (ej. un acto de egresados): cruza la
            nómina cargada de este colegio contra los pedidos ya pagados, para ver de un vistazo
            quién falta y cuánto queda para llegar a la meta. El cruce se hace por nombre, así que un
            pedido con el nombre mal escrito puede no aparecer emparejado — revisá la lista de abajo
            "Pedidos sin alumno en la nómina" si el total recaudado no te cierra.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={colegioId}
              onChange={(e) => setColegioId(e.target.value)}
              className="px-3 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold text-slate-800"
            >
              {colegios.map((col) => (
                <option key={col.id} value={col.id}>
                  {col.nombre} ({col.localidad})
                </option>
              ))}
            </select>

            <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-600">
              <span>Precio acordado por alumno</span>
              <input
                type="text"
                inputMode="numeric"
                value={precioPorAlumno}
                onChange={(e) => setPrecioPorAlumno(e.target.value)}
                placeholder="15000"
                className="w-24 px-2 py-1.5 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-mono"
              />
            </label>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={cargarEstadoPagos}
              disabled={cargando}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-600 border border-slate-200 text-xs font-bold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
            <button
              type="button"
              onClick={handleExportarExcel}
              disabled={alumnos.length === 0}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
              title="Exporta este listado a un archivo de Excel para compartir con el organizador"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
              <span>Exportar a Excel</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Summary cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-center">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-lg font-black text-slate-900">{resumen.totalAlumnos}</div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">Alumnos en el curso</div>
          </div>
          <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-200">
            <div className="text-lg font-black text-emerald-800">{resumen.alumnosPagados}</div>
            <div className="text-[9px] text-emerald-700 font-bold uppercase">Ya pagaron</div>
          </div>
          <div className="p-3 rounded-xl bg-amber-50 border border-amber-200">
            <div className="text-lg font-black text-amber-800">{resumen.alumnosFaltantes}</div>
            <div className="text-[9px] text-amber-700 font-bold uppercase">Todavía faltan</div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-200">
            <div className="text-lg font-black text-slate-900">{formatearMonto(resumen.totalRecaudado)}</div>
            <div className="text-[9px] text-slate-500 font-bold uppercase">Recaudado</div>
          </div>
        </div>

        {precioNumerico > 0 && (
          <div className="p-3.5 rounded-2xl bg-slate-900 text-white flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="text-xs">
              <span className="text-slate-300">Meta del curso ({resumen.totalAlumnos} alumnos × {formatearMonto(precioNumerico)}):</span>{' '}
              <span className="font-bold">{formatearMonto(meta)}</span>
            </div>
            <div className="text-xs">
              {faltaParaLaMeta > 0 ? (
                <span className="font-bold text-amber-300">Faltan {formatearMonto(faltaParaLaMeta)} para llegar a la meta</span>
              ) : (
                <span className="font-bold text-emerald-300 flex items-center gap-1"><CheckCircle2 className="w-3.5 h-3.5" /> Meta alcanzada</span>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
            <tr>
              <th className="py-2.5 px-3 w-12 text-slate-400">#</th>
              <th className="py-2.5 px-4 font-bold text-slate-800">Apellido y Nombre</th>
              <th className="py-2.5 px-4">Grado / División</th>
              <th className="py-2.5 px-4 text-center">Estado</th>
              <th className="py-2.5 px-4">Monto</th>
              <th className="py-2.5 px-4">Fecha</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 mx-auto animate-spin" />
                </td>
              </tr>
            ) : alumnos.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  <School className="w-5 h-5 mx-auto mb-1.5 text-slate-300" />
                  Este colegio todavía no tiene alumnos cargados en la nómina.
                </td>
              </tr>
            ) : (
              alumnos.map((a, index) => (
                <tr key={a.id} className="hover:bg-slate-50 transition-colors">
                  <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">{a.numeroLista ?? index + 1}</td>
                  <td className="py-2.5 px-4 font-bold text-slate-900">{a.nombre}</td>
                  <td className="py-2.5 px-4 text-slate-600">
                    {a.grado} {a.turno ? `· ${a.turno}` : ''} "{a.division}"
                  </td>
                  <td className="py-2.5 px-4 text-center">
                    {a.pagado ? (
                      <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3 h-3" /> Pagado
                      </span>
                    ) : (
                      <span className="inline-block text-[10px] font-semibold text-amber-700 bg-amber-100 px-2 py-0.5 rounded-full">
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-4 font-medium text-slate-700">
                    {a.pedido ? formatearMonto(a.pedido.total) : '—'}
                  </td>
                  <td className="py-2.5 px-4 text-slate-500 text-[11px]">
                    {a.pedido?.fecha ? new Date(a.pedido.fecha).toLocaleDateString('es-AR') : '—'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <div className="flex items-center justify-between text-xs text-slate-500 px-2">
        <span>Mostrando {alumnos.length} alumnos de {colegioSeleccionado?.nombre || 'este colegio'}</span>
      </div>

      {pedidosSinAlumno.length > 0 && (
        <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 space-y-2">
          <h4 className="text-xs font-bold text-rose-900 flex items-center gap-1.5">
            <AlertCircle className="w-4 h-4" />
            <span>Pedidos de este colegio sin alumno emparejado en la nómina ({pedidosSinAlumno.length})</span>
          </h4>
          <p className="text-[11px] text-rose-800">
            El nombre cargado en el pedido no coincide con ningún alumno de la nómina — puede ser un
            error de tipeo, o un alumno que ya no está en la lista. Revisalos a mano; ya están incluidos
            en el total recaudado de arriba.
          </p>
          <div className="space-y-1">
            {pedidosSinAlumno.map((p) => (
              <div key={p.id} className="flex items-center justify-between text-[11px] bg-white rounded-lg px-2.5 py-1.5 border border-rose-100">
                <span className="font-semibold text-slate-800">{p.alumnoNombre || '(sin nombre)'}</span>
                <span className="text-slate-500">{p.estado} · {formatearMonto(p.total)}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
