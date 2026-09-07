import { useCallback, useEffect, useState } from 'react';
import {
  Link2,
  Copy,
  Check,
  RefreshCw,
  Trash2,
  Users,
  School,
  Loader2,
  ShieldCheck,
  Phone,
  Mail,
} from 'lucide-react';
import { useColegiosLista, obtenerTokensPadronAdmin, regenerarTokenPadronAdmin } from '../services/colegiosService';
import { FilaPadron, obtenerPadronAdmin, eliminarPadronAdmin } from '../services/inscripcionesService';

export default function AdminPadronTab() {
  const { colegios } = useColegiosLista();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || '');

  // Links secretos de carga de padrón por colegio (misma fuente que usa la pestaña Colegios)
  const [padronTokens, setPadronTokens] = useState<Record<string, string>>({});
  const [cargandoTokens, setCargandoTokens] = useState(true);
  const [copiadoId, setCopiadoId] = useState<string | null>(null);
  const [regenerandoId, setRegenerandoId] = useState<string | null>(null);
  const [errorTokens, setErrorTokens] = useState<string | null>(null);

  const [padron, setPadron] = useState<FilaPadron[]>([]);
  const [cargandoPadron, setCargandoPadron] = useState(true);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  useEffect(() => {
    if (colegios.length > 0 && (!colegioId || !colegios.some((c) => c.id === colegioId))) {
      setColegioId(colegios[0].id);
    }
  }, [colegios, colegioId]);

  useEffect(() => {
    obtenerTokensPadronAdmin().then((tokens) => {
      setPadronTokens(tokens);
      setCargandoTokens(false);
    });
  }, []);

  const cargarPadron = useCallback(async () => {
    setCargandoPadron(true);
    const datos = await obtenerPadronAdmin(colegioId || undefined);
    setPadron(datos);
    setCargandoPadron(false);
  }, [colegioId]);

  useEffect(() => {
    cargarPadron();
  }, [cargarPadron]);

  const construirLinkPadron = (id: string): string => {
    const token = padronTokens[id];
    if (!token) return '';
    return `${window.location.origin}/padron.html?colegio=${encodeURIComponent(id)}&codigo=${encodeURIComponent(token)}`;
  };

  const handleCopiarLink = async (id: string) => {
    const link = construirLinkPadron(id);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiadoId(id);
      setTimeout(() => setCopiadoId((actual) => (actual === id ? null : actual)), 2000);
    } catch {
      window.prompt('Copiá el link manualmente:', link);
    }
  };

  const handleRegenerar = async (id: string, nombre: string) => {
    if (!window.confirm(`¿Regenerar el link de carga de padrón de "${nombre}"? El link anterior dejará de funcionar.`)) return;
    setRegenerandoId(id);
    setErrorTokens(null);
    const resultado = await regenerarTokenPadronAdmin(id);
    setRegenerandoId(null);
    if (!resultado.success || !resultado.codigoPadron) {
      setErrorTokens(resultado.error || 'No se pudo regenerar el link de padrón.');
      return;
    }
    setPadronTokens((actual) => ({ ...actual, [id]: resultado.codigoPadron! }));
  };

  const handleEliminar = async (id: string) => {
    setEliminandoId(id);
    await eliminarPadronAdmin(id);
    setEliminandoId(null);
    await cargarPadron();
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
            Compartí el link de abajo con cada institución: ellos mismos pegan ahí la lista de teléfonos y/o
            emails de los padres/madres/tutores reales, sin tener que completar, guardar y enviarte ningún
            Excel. Cuando una familia se inscriba desde el portal, el sistema le asigna automáticamente su
            Código de Acceso <strong>sólo si</strong> su teléfono o email coincide con esta lista; si no
            coincide, la inscripción queda pendiente para que la revises manualmente en la pestaña "Inscriptos".
          </p>
        </div>
      </div>

      {/* Links de carga por institución */}
      <div className="bg-white rounded-2xl border border-slate-200 p-4 sm:p-5 space-y-3">
        <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
          <Link2 className="w-4 h-4 text-slate-500" />
          <span>Link para que cada institución cargue su padrón</span>
        </h4>

        {errorTokens && (
          <div className="p-2.5 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">
            {errorTokens}
          </div>
        )}

        {cargandoTokens ? (
          <div className="py-6 text-center text-slate-400">
            <Loader2 className="w-5 h-5 mx-auto animate-spin" />
          </div>
        ) : colegios.length === 0 ? (
          <p className="text-xs text-slate-400 py-4 text-center">Todavía no cargaste ningún colegio.</p>
        ) : (
          <div className="space-y-2">
            {colegios.map((c) => (
              <div
                key={c.id}
                className="p-3 rounded-xl border border-slate-200 bg-slate-50 flex flex-col sm:flex-row sm:items-center gap-2"
              >
                <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5 sm:w-52 shrink-0">
                  <School className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                  <span className="truncate">{c.nombre}</span>
                </span>

                {padronTokens[c.id] ? (
                  <div className="flex items-center gap-1.5 flex-1 min-w-0">
                    <input
                      type="text"
                      readOnly
                      value={construirLinkPadron(c.id)}
                      onFocus={(e) => e.target.select()}
                      className="flex-1 min-w-0 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white text-[11px] font-mono text-slate-600"
                    />
                    <button
                      type="button"
                      onClick={() => handleCopiarLink(c.id)}
                      title="Copiar link"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-100 transition-colors cursor-pointer shrink-0"
                    >
                      {copiadoId === c.id ? (
                        <Check className="w-3.5 h-3.5 text-emerald-600" />
                      ) : (
                        <Copy className="w-3.5 h-3.5" />
                      )}
                    </button>
                    <button
                      type="button"
                      disabled={regenerandoId === c.id}
                      onClick={() => handleRegenerar(c.id, c.nombre)}
                      title="Regenerar link (invalida el anterior)"
                      className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-100 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                    >
                      {regenerandoId === c.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                    </button>
                  </div>
                ) : (
                  <p className="text-[11px] text-slate-400">Cargando link...</p>
                )}
              </div>
            ))}
          </div>
        )}
        <p className="text-[10px] text-slate-400">
          Compartí cada link solo con esa institución — es lo único que necesitan para cargar los datos de contacto de las familias.
        </p>
      </div>

      {/* Existing padron list */}
      <div className="space-y-3 pt-2 border-t border-slate-200">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <h4 className="text-xs font-extrabold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
            <Users className="w-4 h-4 text-slate-500" />
            <span>Padrón cargado {colegioSeleccionado ? `de ${colegioSeleccionado.nombre}` : ''} ({padron.length})</span>
          </h4>
          <div className="flex items-center gap-2">
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
            <button
              type="button"
              onClick={cargarPadron}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${cargandoPadron ? 'animate-spin' : ''}`} />
              <span>Actualizar</span>
            </button>
          </div>
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
