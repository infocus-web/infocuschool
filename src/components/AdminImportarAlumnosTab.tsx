import { useCallback, useEffect, useMemo, useState } from 'react';
import { UploadCloud, Loader2, AlertCircle, CheckCircle2, School, Trash2 } from 'lucide-react';
import { useColegiosLista, obtenerAlumnosNominaAdmin, AlumnoNominaReal, importarAlumnosAdmin, eliminarAlumnoAdmin, FilaAlumnoAImportar } from '../services/colegiosService';

interface FilaParseada {
  numeroLista: number | null;
  nombre: string;
}

/**
 * Parsea el texto pegado (típicamente copiado de un rango de Excel: una columna de número de
 * lista y otra de nombre, separadas por tab) en filas {numeroLista, nombre}. Tolera también
 * pegar solo los nombres sin numerar (se numeran solos en el orden en que aparecen), o números
 * seguidos de ". " o ") " en vez de tab.
 */
function parsearFilasPegadas(texto: string): FilaParseada[] {
  return texto
    .split(/\r?\n/)
    .map((linea) => linea.trim())
    .filter(Boolean)
    .map((linea, idx) => {
      const match = linea.match(/^(\d+)[.)]?\s*,?\s*(.+)$/);
      if (match && match[2].trim()) {
        return { numeroLista: parseInt(match[1], 10), nombre: match[2].trim() };
      }
      return { numeroLista: idx + 1, nombre: linea };
    })
    .filter((f) => f.nombre);
}

export default function AdminImportarAlumnosTab() {
  const { colegios } = useColegiosLista();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || '');
  const [grado, setGrado] = useState('');
  const [turno, setTurno] = useState('');
  const [division, setDivision] = useState('');
  const [textoPegado, setTextoPegado] = useState('');

  const [alumnosExistentes, setAlumnosExistentes] = useState<AlumnoNominaReal[]>([]);
  const [cargandoExistentes, setCargandoExistentes] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultado, setResultado] = useState<{ importados: number; descartados: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  useEffect(() => {
    if (colegios.length > 0 && (!colegioId || !colegios.some((c) => c.id === colegioId))) {
      setColegioId(colegios[0].id);
    }
  }, [colegios, colegioId]);

  const cargarExistentes = useCallback(async () => {
    if (!colegioId) return;
    setCargandoExistentes(true);
    const datos = await obtenerAlumnosNominaAdmin(colegioId);
    setAlumnosExistentes(datos);
    setCargandoExistentes(false);
  }, [colegioId]);

  useEffect(() => {
    cargarExistentes();
  }, [cargarExistentes]);

  const filasParseadas = useMemo(() => parsearFilasPegadas(textoPegado), [textoPegado]);

  const yaCargadosEnEstaSeccion = useMemo(() => {
    if (!grado.trim() || !division.trim()) return [];
    return alumnosExistentes.filter(
      (a) =>
        a.grado.trim().toLowerCase() === grado.trim().toLowerCase() &&
        a.division.trim().toLowerCase() === division.trim().toLowerCase() &&
        (a.turno || '').trim().toLowerCase() === turno.trim().toLowerCase()
    );
  }, [alumnosExistentes, grado, division, turno]);

  const colegioSeleccionado = colegios.find((c) => c.id === colegioId);

  const handleImportar = async () => {
    setError(null);
    setResultado(null);
    if (!colegioId) {
      setError('Elegí un colegio.');
      return;
    }
    if (!grado.trim() || !division.trim()) {
      setError('Completá al menos el grado/año y la división.');
      return;
    }
    if (filasParseadas.length === 0) {
      setError('Pegá la lista de alumnos antes de importar.');
      return;
    }
    if (
      yaCargadosEnEstaSeccion.length > 0 &&
      !window.confirm(
        `Ya hay ${yaCargadosEnEstaSeccion.length} alumnos cargados para "${grado} ${division}" (${turno || 'sin turno'}) en este colegio. ¿Confirmás que querés agregar ${filasParseadas.length} más de todas formas? (si es una recarga de la misma lista, primero borrá los que ya están para no duplicar)`
      )
    ) {
      return;
    }

    setImportando(true);
    const filas: FilaAlumnoAImportar[] = filasParseadas.map((f) => ({
      nombre: f.nombre,
      grado: grado.trim(),
      division: division.trim(),
      turno: turno.trim() || null,
      numeroLista: f.numeroLista,
    }));
    const res = await importarAlumnosAdmin(colegioId, filas);
    setImportando(false);
    if (!res.success) {
      setError(res.error || 'No se pudo importar la lista.');
      return;
    }
    setResultado({ importados: res.importados, descartados: res.descartados });
    setTextoPegado('');
    await cargarExistentes();
  };

  const handleEliminar = async (id: string) => {
    setEliminandoId(id);
    await eliminarAlumnoAdmin(id);
    setEliminandoId(null);
    await cargarExistentes();
  };

  return (
    <div className="space-y-5 text-slate-900 text-left">
      <div className="p-4 bg-sky-50/70 border border-sky-200 rounded-2xl flex items-start gap-3">
        <UploadCloud className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-950 leading-relaxed">
          <p className="font-bold">Importar Alumnos a la Nómina</p>
          <p className="mt-1 text-sky-900/90">
            Cargá una sección (grado/año + turno + división) por vez. Pegá abajo la lista tal cual
            sale de copiar dos columnas de Excel — número de lista y nombre, separados por tab —
            o solo los nombres, uno por línea (se numeran solos). Repetí el proceso para cada
            sección del colegio.
          </p>
        </div>
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
          <label className="space-y-1 sm:col-span-2">
            <span className="text-xs font-bold text-slate-700 flex items-center gap-1"><School className="w-3.5 h-3.5 text-slate-400" /> Colegio</span>
            <select
              value={colegioId}
              onChange={(e) => setColegioId(e.target.value)}
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold text-slate-800"
            >
              {colegios.map((c) => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-slate-700">Grado / Año</span>
            <input
              type="text"
              value={grado}
              onChange={(e) => setGrado(e.target.value)}
              placeholder='ej. "6° año"'
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </label>
          <label className="space-y-1">
            <span className="text-xs font-bold text-slate-700">División</span>
            <input
              type="text"
              value={division}
              onChange={(e) => setDivision(e.target.value)}
              placeholder='ej. "A"'
              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </label>
          <label className="space-y-1 sm:col-span-4">
            <span className="text-xs font-bold text-slate-700">Turno (opcional)</span>
            <input
              type="text"
              value={turno}
              onChange={(e) => setTurno(e.target.value)}
              placeholder='ej. "Mañana"'
              className="w-full sm:w-52 px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </label>
        </div>

        {yaCargadosEnEstaSeccion.length > 0 && (
          <div className="p-2.5 rounded-xl bg-amber-50 border border-amber-200 text-amber-800 text-[11px] font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>Ya hay {yaCargadosEnEstaSeccion.length} alumnos cargados para esta sección en este colegio.</span>
          </div>
        )}

        <label className="space-y-1 block">
          <span className="text-xs font-bold text-slate-700">Pegá la lista acá</span>
          <textarea
            value={textoPegado}
            onChange={(e) => setTextoPegado(e.target.value)}
            rows={10}
            placeholder={'1\tABERTONDO, Caterina\n2\tALBERINI, Francesca\n3\tASTURIANO, Renata\n...'}
            className="w-full px-3 py-2 text-xs font-mono bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
          />
        </label>

        <div className="flex items-center justify-between">
          <span className="text-xs text-slate-500">
            {filasParseadas.length > 0 ? `${filasParseadas.length} alumnos detectados en el texto pegado` : 'Todavía no pegaste ninguna lista'}
          </span>
          <button
            type="button"
            onClick={handleImportar}
            disabled={importando || filasParseadas.length === 0}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs shadow flex items-center gap-1.5 cursor-pointer"
          >
            {importando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UploadCloud className="w-3.5 h-3.5" />}
            <span>{importando ? 'Importando...' : `Importar ${filasParseadas.length || ''} alumnos`}</span>
          </button>
        </div>

        {error && (
          <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
        {resultado && (
          <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
            <span>
              Se importaron {resultado.importados} alumnos
              {resultado.descartados > 0 ? ` (${resultado.descartados} filas descartadas por datos incompletos)` : ''}.
            </span>
          </div>
        )}

        {filasParseadas.length > 0 && (
          <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-64">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="py-1.5 px-3 w-12">N°</th>
                  <th className="py-1.5 px-3">Nombre</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filasParseadas.map((f, idx) => (
                  <tr key={idx}>
                    <td className="py-1 px-3 text-slate-400 font-mono">{f.numeroLista}</td>
                    <td className="py-1 px-3 text-slate-800">{f.nombre}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
        <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider">
          Nómina actual de {colegioSeleccionado?.nombre || 'este colegio'} ({alumnosExistentes.length})
        </h4>
        {cargandoExistentes ? (
          <div className="py-6 text-center text-slate-400"><Loader2 className="w-5 h-5 mx-auto animate-spin" /></div>
        ) : alumnosExistentes.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">Todavía no hay alumnos cargados para este colegio.</p>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-200 max-h-72">
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 sticky top-0">
                <tr>
                  <th className="py-1.5 px-3 w-10">N°</th>
                  <th className="py-1.5 px-3">Nombre</th>
                  <th className="py-1.5 px-3">Grado</th>
                  <th className="py-1.5 px-3">Turno</th>
                  <th className="py-1.5 px-3">División</th>
                  <th className="py-1.5 px-3 text-right">Acciones</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {alumnosExistentes.map((a) => (
                  <tr key={a.id} className="hover:bg-slate-50">
                    <td className="py-1 px-3 text-slate-400 font-mono">{a.numero_lista ?? '—'}</td>
                    <td className="py-1 px-3 font-semibold text-slate-800">{a.nombre}</td>
                    <td className="py-1 px-3 text-slate-600">{a.grado}</td>
                    <td className="py-1 px-3 text-slate-600">{a.turno || '—'}</td>
                    <td className="py-1 px-3 text-slate-600">{a.division}</td>
                    <td className="py-1 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEliminar(a.id)}
                        disabled={eliminandoId === a.id}
                        className="p-1 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                        title="Eliminar de la nómina"
                      >
                        {eliminandoId === a.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
