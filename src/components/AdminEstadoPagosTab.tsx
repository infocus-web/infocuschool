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
  Info,
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
  // Pedido de Pablo (25/9): separar los que pagaron de los pendientes. Las tarjetas de arriba filtran.
  const [filtro, setFiltro] = useState<'todos' | 'pagados' | 'pendientes'>('todos');
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

  const alumnosVisibles = alumnos.filter((a) => (filtro === 'pagados' ? a.pagado : filtro === 'pendientes' ? !a.pagado : true));

  const handleExportarExcel = () => {
    const wb = XLSX.utils.book_new();
    const data = alumnosVisibles.map((a, idx) => ({
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
    <div className="space-y-3 text-slate-900 text-left">
      {/* Auditoría 2026-09-26 (pedido de Pablo: "reducirlo a la mitad o menos"): la explicación larga
          pasó a un tooltip (ⓘ) y las 4 tarjetas + la franja de meta quedaron en una sola fila de
          pastillas, que siguen funcionando como filtro de la tabla. */}
      <div className="bg-white rounded-2xl border border-slate-200 px-3 py-2 space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <span
            className="flex items-center gap-1.5 text-xs font-bold text-slate-800 cursor-help"
            title={'Cruza la nómina cargada de este colegio contra los pedidos ya pagados, para ver quién falta y cuánto queda para la meta (ej. un acto de egresados con tarifa acordada). El cruce es por nombre: un pedido con el nombre mal escrito puede no emparejar — revisá "Pedidos sin alumno en la nómina" si el total no te cierra.'}
          >
            <Wallet className="w-3.5 h-3.5 text-amber-600" />
            Pagos por curso
            <Info className="w-3 h-3 text-slate-400" />
          </span>
          <select
            value={colegioId}
            onChange={(e) => setColegioId(e.target.value)}
            className="px-2 py-1 text-[11px] bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold text-slate-800 max-w-[16rem]"
          >
            {colegios.map((col) => (
              <option key={col.id} value={col.id}>
                {col.nombre} ({col.localidad})
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1 text-[11px] font-semibold text-slate-600">
            <span>$ por alumno</span>
            <input
              type="text"
              inputMode="numeric"
              value={precioPorAlumno}
              onChange={(e) => setPrecioPorAlumno(e.target.value)}
              placeholder="15000"
              className="w-20 px-2 py-1 text-[11px] bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-mono"
            />
          </label>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              onClick={cargarEstadoPagos}
              disabled={cargando}
              title="Actualizar"
              aria-label="Actualizar"
              className="p-1.5 bg-white hover:bg-slate-100 disabled:opacity-50 text-slate-600 border border-slate-200 rounded-lg transition-colors cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin' : ''}`} />
            </button>
            <button
              type="button"
              onClick={handleExportarExcel}
              disabled={alumnos.length === 0}
              className="px-2.5 py-1 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-lg text-[11px] font-bold flex items-center gap-1 cursor-pointer transition-colors"
              title="Exporta este listado a un archivo de Excel para compartir con el organizador"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
              <span>Excel</span>
            </button>
          </div>
        </div>

        {error && (
          <div className="p-2 rounded-lg bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        {/* Resumen: las pastillas también son el filtro de la tabla */}
        <div className="flex flex-wrap items-center gap-1.5 text-[11px]">
          <button type="button" onClick={() => setFiltro('todos')} className={`px-2.5 py-1 rounded-full border font-semibold cursor-pointer transition-all ${filtro === 'todos' ? 'bg-slate-900 border-slate-900 text-white' : 'bg-slate-50 border-slate-200 text-slate-700 hover:border-slate-400'}`}>
            <span className="font-black">{resumen.totalAlumnos}</span> alumnos
          </button>
          <button type="button" onClick={() => setFiltro('pagados')} className={`px-2.5 py-1 rounded-full border font-semibold cursor-pointer transition-all ${filtro === 'pagados' ? 'bg-emerald-600 border-emerald-600 text-white' : 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:border-emerald-400'}`}>
            <span className="font-black">{resumen.alumnosPagados}</span> pagaron
          </button>
          <button type="button" onClick={() => setFiltro('pendientes')} className={`px-2.5 py-1 rounded-full border font-semibold cursor-pointer transition-all ${filtro === 'pendientes' ? 'bg-amber-600 border-amber-600 text-white' : 'bg-amber-50 border-amber-200 text-amber-800 hover:border-amber-400'}`}>
            <span className="font-black">{resumen.alumnosFaltantes}</span> faltan
          </button>
          <span className="px-2.5 py-1 rounded-full border border-slate-200 bg-slate-50 font-semibold text-slate-700">
            <span className="font-black">{formatearMonto(resumen.totalRecaudado)}</span> recaudado
          </span>
          {precioNumerico > 0 && (
            <span
              className={`px-2.5 py-1 rounded-full font-semibold ${faltaParaLaMeta > 0 ? 'bg-slate-900 text-amber-300' : 'bg-slate-900 text-emerald-300'}`}
              title={`Meta: ${resumen.totalAlumnos} alumnos × ${formatearMonto(precioNumerico)} = ${formatearMonto(meta)}`}
            >
              {faltaParaLaMeta > 0 ? (
                <>Meta {formatearMonto(meta)} · faltan {formatearMonto(faltaParaLaMeta)}</>
              ) : (
                <span className="flex items-center gap-1"><CheckCircle2 className="w-3 h-3" /> Meta {formatearMonto(meta)} alcanzada</span>
              )}
            </span>
          )}
        </div>
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
            ) : alumnosVisibles.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  {filtro === 'pagados' ? 'Todavía no pagó ningún alumno de este colegio.' : 'No queda ningún alumno pendiente de pago.'}
                </td>
              </tr>
            ) : (
              alumnosVisibles.map((a, index) => (
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
