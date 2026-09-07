import { useCallback, useEffect, useState } from 'react';
import { MessageCircle, Loader2, Trash2, CheckCircle2, Phone, School, RefreshCw, Filter } from 'lucide-react';
import {
  SolicitudCodigo,
  obtenerSolicitudesCodigoAdmin,
  marcarSolicitudCodigoAtendidaAdmin,
  eliminarSolicitudCodigoAdmin,
} from '../services/solicitudesCodigoService';

export default function AdminSolicitudesCodigoTab() {
  const [filtro, setFiltro] = useState<'pendiente' | 'todas'>('pendiente');
  const [solicitudes, setSolicitudes] = useState<SolicitudCodigo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [procesandoId, setProcesandoId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    const data = await obtenerSolicitudesCodigoAdmin(filtro);
    setSolicitudes(data);
    setCargando(false);
  }, [filtro]);

  useEffect(() => {
    void cargar();
  }, [cargar]);

  const handleAtender = async (id: string) => {
    setProcesandoId(id);
    try {
      const resultado = await marcarSolicitudCodigoAtendidaAdmin(id);
      if (resultado.success) {
        if (filtro === 'pendiente') {
          setSolicitudes((prev) => prev.filter((s) => s.id !== id));
        } else {
          setSolicitudes((prev) => prev.map((s) => (s.id === id ? { ...s, estado: 'atendido' } : s)));
        }
      } else {
        window.alert(resultado.error || 'No se pudo marcar como atendida.');
      }
    } finally {
      setProcesandoId(null);
    }
  };

  const handleEliminar = async (id: string) => {
    const confirmado = window.confirm('¿Eliminar esta solicitud de la lista?');
    if (!confirmado) return;
    setProcesandoId(id);
    try {
      const resultado = await eliminarSolicitudCodigoAdmin(id);
      if (resultado.success) {
        setSolicitudes((prev) => prev.filter((s) => s.id !== id));
      } else {
        window.alert(resultado.error || 'No se pudo eliminar la solicitud.');
      }
    } finally {
      setProcesandoId(null);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-2xl text-xs text-emerald-900 flex items-start gap-2.5">
        <MessageCircle className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
        <p>
          Acá caen las familias que tocaron <strong>"Solicitar mi Código"</strong> en el portal porque no encontraron
          su código de curso. Respondeles por WhatsApp o email con el dato de contacto que dejaron, y marcá la
          consulta como atendida para sacarla de la lista.
        </p>
      </div>

      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 bg-slate-100 rounded-xl p-1">
          <button
            type="button"
            onClick={() => setFiltro('pendiente')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer flex items-center gap-1.5 ${
              filtro === 'pendiente' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            <Filter className="w-3.5 h-3.5" />
            <span>Pendientes</span>
          </button>
          <button
            type="button"
            onClick={() => setFiltro('todas')}
            className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-colors cursor-pointer ${
              filtro === 'todas' ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            Todas
          </button>
        </div>
        <button
          type="button"
          onClick={cargar}
          className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-600 border border-slate-200 text-xs font-bold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin' : ''}`} />
          <span>Actualizar</span>
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
            <tr>
              <th className="py-2.5 px-3">Familia</th>
              <th className="py-2.5 px-3">Contacto</th>
              <th className="py-2.5 px-3">Alumno / Curso</th>
              <th className="py-2.5 px-3">Colegio</th>
              <th className="py-2.5 px-3">Estado</th>
              <th className="py-2.5 px-3 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {cargando ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400">
                  <Loader2 className="w-5 h-5 mx-auto animate-spin" />
                </td>
              </tr>
            ) : solicitudes.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-8 text-center text-slate-400 text-xs">
                  {filtro === 'pendiente' ? 'No hay solicitudes pendientes. 🎉' : 'Todavía no hay solicitudes.'}
                </td>
              </tr>
            ) : (
              solicitudes.map((s) => (
                <tr key={s.id} className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 font-semibold text-slate-800">{s.nombreSolicitante}</td>
                  <td className="py-2.5 px-3">
                    <span className="flex items-center gap-1 text-slate-600 font-mono">
                      <Phone className="w-3 h-3 text-emerald-500 shrink-0" /> {s.contacto}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {s.alumnoNombre || '—'}
                    {(s.grado || s.division || s.turno) && (
                      <div className="text-[10px] text-slate-400">
                        {[s.grado, s.division, s.turno].filter(Boolean).join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-slate-600">
                    {s.colegioNombre ? (
                      <span className="flex items-center gap-1">
                        <School className="w-3 h-3 text-slate-400 shrink-0" /> {s.colegioNombre}
                      </span>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="py-2.5 px-3">
                    {s.estado === 'atendido' ? (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 border border-emerald-200">
                        Atendido
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-100 text-amber-800 border border-amber-200">
                        Pendiente
                      </span>
                    )}
                  </td>
                  <td className="py-2.5 px-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {s.estado !== 'atendido' && (
                        <button
                          type="button"
                          onClick={() => handleAtender(s.id)}
                          disabled={procesandoId === s.id}
                          className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                          title="Marcar como atendida"
                        >
                          {procesandoId === s.id ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          )}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleEliminar(s.id)}
                        disabled={procesandoId === s.id}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition-colors cursor-pointer disabled:opacity-50"
                        title="Eliminar solicitud"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
