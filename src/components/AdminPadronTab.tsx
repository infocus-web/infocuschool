import React, { useCallback, useEffect, useMemo, useState } from 'react';
import * as XLSX from 'xlsx';
import {
  FileSpreadsheet,
  Upload,
  Download,
  Trash2,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertCircle,
  Users,
  School,
  Loader2,
  ShieldCheck,
  Phone,
  Mail
} from 'lucide-react';
import { useColegiosLista } from '../services/colegiosService';
import {
  FilaPadron,
  obtenerPadronAdmin,
  importarPadronAdmin,
  eliminarPadronAdmin
} from '../services/inscripcionesService';
import { generarExcelBlob, descargarBlobSeguro } from '../services/excelDownloadHelper';

interface FilaParseada {
  colegioId: string;
  nombre: string;
  telefono?: string;
  email?: string;
  alumnoNombre?: string;
  grado?: string;
  division?: string;
  turno?: string;
  codigoAsignado?: string;
  valida: boolean;
  motivo?: string;
}

/** Busca el valor de una fila del Excel probando varios nombres de columna posibles (sin distinguir mayúsculas ni acentos) */
function obtenerCampo(fila: Record<string, any>, ...alias: string[]): string {
  const normalizar = (s: string) =>
    s
      .toString()
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '');

  const claves = Object.keys(fila);
  for (const nombreBuscado of alias) {
    const nb = normalizar(nombreBuscado);
    const clave = claves.find((k) => normalizar(k) === nb);
    if (clave && fila[clave] !== undefined && fila[clave] !== null) {
      return String(fila[clave]).trim();
    }
  }
  return '';
}

export default function AdminPadronTab() {
  const { colegios } = useColegiosLista();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || '');

  const [filasParseadas, setFilasParseadas] = useState<FilaParseada[]>([]);
  const [nombreArchivo, setNombreArchivo] = useState<string | null>(null);
  const [parseando, setParseando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [resultadoImport, setResultadoImport] = useState<{ importados: number; descartados: number } | null>(null);
  const [errorImport, setErrorImport] = useState<string | null>(null);

  const [padron, setPadron] = useState<FilaPadron[]>([]);
  const [cargandoPadron, setCargandoPadron] = useState(true);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  useEffect(() => {
    if (colegios.length > 0 && (!colegioId || !colegios.some((c) => c.id === colegioId))) {
      setColegioId(colegios[0].id);
    }
  }, [colegios, colegioId]);

  const cargarPadron = useCallback(async () => {
    setCargandoPadron(true);
    const datos = await obtenerPadronAdmin(colegioId || undefined);
    setPadron(datos);
    setCargandoPadron(false);
  }, [colegioId]);

  useEffect(() => {
    cargarPadron();
  }, [cargarPadron]);

  const validas = useMemo(() => filasParseadas.filter((f) => f.valida), [filasParseadas]);
  const invalidas = useMemo(() => filasParseadas.filter((f) => !f.valida), [filasParseadas]);

  const handleArchivoSeleccionado = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setResultadoImport(null);
    setErrorImport(null);
    setNombreArchivo(file.name);
    setParseando(true);

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const data = event.target?.result;
        const wb = XLSX.read(data, { type: 'array' });
        const primeraHoja = wb.Sheets[wb.SheetNames[0]];
        const filasCrudas: Record<string, any>[] = XLSX.utils.sheet_to_json(primeraHoja, { defval: '' });

        const parseadas: FilaParseada[] = filasCrudas.map((fila) => {
          const nombre = obtenerCampo(fila, 'Nombre', 'Padre', 'Madre', 'Tutor', 'PadreNombre', 'Nombre y Apellido');
          const telefono = obtenerCampo(fila, 'Telefono', 'Teléfono', 'WhatsApp', 'Celular');
          const email = obtenerCampo(fila, 'Email', 'Correo', 'Correo Electronico', 'Correo Electrónico');
          const alumnoNombre = obtenerCampo(fila, 'Alumno', 'AlumnoNombre', 'Alumno/a', 'Nombre del Alumno');
          const grado = obtenerCampo(fila, 'Grado', 'Sala', 'Grado/Sala');
          const division = obtenerCampo(fila, 'Division', 'División');
          const turno = obtenerCampo(fila, 'Turno');
          const codigoAsignado = obtenerCampo(fila, 'Codigo', 'Código', 'CodigoAsignado', 'Código Asignado', 'Código de Curso');

          const valida = Boolean(nombre) && Boolean(telefono || email);
          let motivo: string | undefined;
          if (!valida) {
            motivo = !nombre
              ? 'Falta el nombre del padre/madre/tutor'
              : 'Falta teléfono o email (se necesita al menos uno)';
          }

          return {
            colegioId,
            nombre,
            telefono: telefono || undefined,
            email: email ? email.toLowerCase() : undefined,
            alumnoNombre: alumnoNombre || undefined,
            grado: grado || undefined,
            division: division || undefined,
            turno: turno || undefined,
            codigoAsignado: codigoAsignado ? codigoAsignado.toUpperCase() : undefined,
            valida,
            motivo
          };
        });

        setFilasParseadas(parseadas);
      } catch (err) {
        console.error('Error al leer el archivo:', err);
        setErrorImport('No pudimos leer el archivo. Verificá que sea un Excel (.xlsx) o CSV válido.');
        setFilasParseadas([]);
      } finally {
        setParseando(false);
      }
    };
    reader.onerror = () => {
      setParseando(false);
      setErrorImport('Error al leer el archivo seleccionado.');
    };
    reader.readAsArrayBuffer(file);

    // Allow re-selecting the same file later
    e.target.value = '';
  };

  const handleImportar = async () => {
    if (validas.length === 0 || !colegioId) return;
    setImportando(true);
    setErrorImport(null);
    const resultado = await importarPadronAdmin(
      validas.map((f) => ({
        colegioId,
        nombre: f.nombre,
        telefono: f.telefono,
        email: f.email,
        alumnoNombre: f.alumnoNombre,
        grado: f.grado,
        division: f.division,
        turno: f.turno,
        codigoAsignado: f.codigoAsignado
      })),
      colegioId
    );
    setImportando(false);

    if (!resultado.success) {
      setErrorImport(resultado.error || 'Error desconocido al importar el padrón.');
      return;
    }

    setResultadoImport({ importados: resultado.importados || 0, descartados: resultado.descartados || 0 });
    setFilasParseadas([]);
    setNombreArchivo(null);
    await cargarPadron();
  };

  const handleEliminar = async (id: string) => {
    setEliminandoId(id);
    await eliminarPadronAdmin(id);
    setEliminandoId(null);
    await cargarPadron();
  };

  const handleDescargarPlantilla = () => {
    const wsData = [
      ['Nombre', 'Telefono', 'Email', 'AlumnoNombre', 'Grado', 'Division', 'Turno', 'CodigoAsignado'],
      ['Mariana Gómez', '1145893210', 'mariana.gomez@gmail.com', 'Benjamín Gómez', 'Sala 5 años', 'A', 'Tarde', '']
    ];
    const ws = XLSX.utils.aoa_to_sheet(wsData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Padrón');
    const blob = generarExcelBlob(wb);
    descargarBlobSeguro(blob, 'plantilla_padron_autorizado.xlsx');
  };

  const colegioSeleccionado = colegios.find((c) => c.id === colegioId);

  return (
    <div className="space-y-6 text-slate-900 text-left">
      {/* Explanation banner */}
      <div className="p-4 bg-sky-50/70 border border-sky-200 rounded-2xl flex items-start gap-3">
        <ShieldCheck className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-950 leading-relaxed">
          <p className="font-bold">Padrón de Padres Autorizados</p>
          <p className="mt-1 text-sky-900/90">
            Subí acá la lista de teléfonos y/o emails que el colegio te confirmó como padres/madres/tutores
            reales. Cuando una familia se inscriba desde el portal, el sistema le asigna automáticamente su
            Código de Acceso <strong>sólo si</strong> su teléfono o email coincide con esta lista; si no
            coincide, la inscripción queda pendiente para que la revises manualmente en la pestaña "Inscriptos".
          </p>
        </div>
      </div>

      {/* Colegio selector + template download */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <School className="w-4 h-4 text-slate-500 shrink-0" />
          <label className="text-xs font-bold text-slate-700 shrink-0">Colegio:</label>
          <select
            value={colegioId}
            onChange={(e) => setColegioId(e.target.value)}
            className="px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold text-slate-800"
          >
            {colegios.map((col) => (
              <option key={col.id} value={col.id}>
                {col.nombre} ({col.localidad})
              </option>
            ))}
          </select>
        </div>
        <button
          type="button"
          onClick={handleDescargarPlantilla}
          className="px-3.5 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-bold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer shrink-0"
        >
          <Download className="w-3.5 h-3.5" />
          <span>Descargar plantilla Excel</span>
        </button>
      </div>

      {/* File upload */}
      <div className="bg-white border-2 border-dashed border-amber-300 rounded-2xl p-6 text-center space-y-3">
        <FileSpreadsheet className="w-8 h-8 mx-auto text-amber-500" />
        <div>
          <p className="text-sm font-bold text-slate-800">Subí el Excel o CSV del padrón</p>
          <p className="text-xs text-slate-500 mt-0.5">
            Columnas esperadas: Nombre, Telefono, Email, AlumnoNombre, Grado, Division, Turno, CodigoAsignado (opcional)
          </p>
        </div>
        <label className="inline-flex items-center gap-2 px-4 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-all active:scale-98">
          <Upload className="w-4 h-4" />
          <span>Elegir archivo (.xlsx, .xls, .csv)</span>
          <input
            type="file"
            accept=".xlsx,.xls,.csv"
            onChange={handleArchivoSeleccionado}
            className="hidden"
          />
        </label>
        {nombreArchivo && (
          <p className="text-[11px] text-slate-500">
            Archivo cargado: <span className="font-semibold text-slate-700">{nombreArchivo}</span>
          </p>
        )}
      </div>

      {errorImport && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
          <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
          <span>{errorImport}</span>
        </div>
      )}

      {resultadoImport && (
        <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-xl text-xs text-emerald-800 flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
          <span>
            Se importaron <strong>{resultadoImport.importados}</strong> filas al padrón de {colegioSeleccionado?.nombre}.
            {resultadoImport.descartados > 0 && ` Se descartaron ${resultadoImport.descartados} filas incompletas.`}
          </span>
        </div>
      )}

      {/* Preview of parsed rows */}
      {parseando ? (
        <div className="p-6 text-center text-slate-400">
          <Loader2 className="w-6 h-6 mx-auto animate-spin mb-2" />
          <p className="text-xs">Leyendo archivo...</p>
        </div>
      ) : filasParseadas.length > 0 ? (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3 text-xs">
              <span className="font-bold text-emerald-700">{validas.length} filas válidas</span>
              {invalidas.length > 0 && (
                <span className="font-bold text-red-600">{invalidas.length} filas con datos incompletos</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleImportar}
              disabled={validas.length === 0 || importando}
              className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              {importando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              <span>Importar {validas.length} filas a {colegioSeleccionado?.nombre || 'este colegio'}</span>
            </button>
          </div>

          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs max-h-80 overflow-y-auto">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider sticky top-0">
                <tr>
                  <th className="py-2 px-3">Estado</th>
                  <th className="py-2 px-3">Nombre</th>
                  <th className="py-2 px-3">Teléfono</th>
                  <th className="py-2 px-3">Email</th>
                  <th className="py-2 px-3">Alumno</th>
                  <th className="py-2 px-3">Código</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filasParseadas.map((f, idx) => (
                  <tr key={idx} className={f.valida ? '' : 'bg-red-50/50'}>
                    <td className="py-2 px-3">
                      {f.valida ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
                      ) : (
                        <span title={f.motivo} className="inline-flex items-center gap-1 text-red-600">
                          <XCircle className="w-3.5 h-3.5" />
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-3 font-semibold text-slate-800">{f.nombre || '—'}</td>
                    <td className="py-2 px-3 font-mono text-slate-600">{f.telefono || '—'}</td>
                    <td className="py-2 px-3 text-slate-600">{f.email || '—'}</td>
                    <td className="py-2 px-3 text-slate-600">{f.alumnoNombre || '—'}</td>
                    <td className="py-2 px-3 font-mono text-slate-500">{f.codigoAsignado || 'auto'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ) : null}

      {/* Existing padron list */}
      <div className="space-y-3 pt-2 border-t border-slate-200">
        <div className="flex items-center justify-between">
          <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-500" />
            <span>Padrón cargado {colegioSeleccionado ? `de ${colegioSeleccionado.nombre}` : ''} ({padron.length})</span>
          </h4>
          <button
            type="button"
            onClick={cargarPadron}
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cargandoPadron ? 'animate-spin' : ''}`} />
            <span>Actualizar</span>
          </button>
        </div>

        <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
          <table className="w-full text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
              <tr>
                <th className="py-2.5 px-3">Nombre</th>
                <th className="py-2.5 px-3">Contacto</th>
                <th className="py-2.5 px-3">Alumno</th>
                <th className="py-2.5 px-3">Estado</th>
                <th className="py-2.5 px-3 text-right">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {cargandoPadron ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400">
                    <Loader2 className="w-5 h-5 mx-auto animate-spin" />
                  </td>
                </tr>
              ) : padron.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-8 text-center text-slate-400 text-xs">
                    Todavía no cargaste el padrón de este colegio.
                  </td>
                </tr>
              ) : (
                padron.map((fila) => (
                  <tr key={fila.id} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-semibold text-slate-800">{fila.nombre}</td>
                    <td className="py-2.5 px-3">
                      <div className="flex flex-col gap-0.5">
                        {fila.telefono && (
                          <span className="flex items-center gap-1 text-slate-600 font-mono">
                            <Phone className="w-3 h-3 text-emerald-500" /> {fila.telefono}
                          </span>
                        )}
                        {fila.email && (
                          <span className="flex items-center gap-1 text-slate-600">
                            <Mail className="w-3 h-3 text-sky-500" /> {fila.email}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-slate-600">{fila.alumnoNombre || '—'}</td>
                    <td className="py-2.5 px-3">
                      {fila.usado ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                          Ya se inscribió
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 text-slate-600 border border-slate-200">
                          Sin usar
                        </span>
                      )}
                    </td>
                    <td className="py-2.5 px-3 text-right">
                      <button
                        type="button"
                        onClick={() => handleEliminar(fila.id)}
                        disabled={eliminandoId === fila.id}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                        title="Eliminar del padrón"
                      >
                        {eliminandoId === fila.id ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
