import { Fragment, useCallback, useEffect, useState } from 'react';
import { MessageCircle, Loader2, Trash2, CheckCircle2, Mail, School, RefreshCw, Filter, X, Send, KeyRound, AlertTriangle } from 'lucide-react';
import {
  SolicitudCodigo,
  obtenerSolicitudesCodigoAdmin,
  marcarSolicitudCodigoAtendidaAdmin,
  eliminarSolicitudCodigoAdmin,
  responderSolicitudCodigoAdmin,
} from '../services/solicitudesCodigoService';
import { asegurarCodigoSeccionAdmin } from '../services/codigosSeccionService';

export default function AdminSolicitudesCodigoTab() {
  const [filtro, setFiltro] = useState<'pendiente' | 'todas'>('pendiente');
  const [solicitudes, setSolicitudes] = useState<SolicitudCodigo[]>([]);
  const [cargando, setCargando] = useState(true);
  const [procesandoId, setProcesandoId] = useState<string | null>(null);
  // Auditoría 2026-09-16 (pedido de Pablo: "quiero que haya un botón para responder por email
  // del sistema" — el cartel de arriba ya sugería "por WhatsApp o email" pero el email había que
  // mandarlo a mano desde afuera): mismo patrón inline que ya usa AdminConsultasFamiliasTab.tsx,
  // adaptado a una fila de tabla en vez de una tarjeta.
  const [respondiendoId, setRespondiendoId] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [respuestaEnviadaId, setRespuestaEnviadaId] = useState<string | null>(null);
  const [errorRespuesta, setErrorRespuesta] = useState<string | null>(null);
  // Auditoría 2026-09-16, segunda vuelta (pedido de Pablo: "no puede ser automática la entrega
  // del mensaje con el código?"): al abrir "Responder", si la familia dejó colegio+grado+turno+
  // división al pedirlo, se busca (o se crea, si esa sección todavía no tenía uno) el Código de
  // Acceso real de esa sección con el mismo mecanismo que ya usa la pestaña "Códigos y difusión"
  // — así Pablo no tiene que escribirlo a mano, solo revisar y enviar. Si la familia no dejó esos
  // datos, se sigue pidiendo el texto a mano como antes.
  const [buscandoCodigo, setBuscandoCodigo] = useState(false);
  const [codigoEncontrado, setCodigoEncontrado] = useState<string | null>(null);
  const [avisoSinCodigo, setAvisoSinCodigo] = useState<string | null>(null);

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

  const handleAbrirRespuesta = async (s: SolicitudCodigo) => {
    setRespondiendoId(s.id);
    setRespuesta('');
    setErrorRespuesta(null);
    setRespuestaEnviadaId(null);
    setCodigoEncontrado(null);
    setAvisoSinCodigo(null);

    if (!s.colegioId || !s.grado || !s.turno || !s.division) {
      setAvisoSinCodigo(
        'Esta familia no dejó colegio, grado, turno y división completos, así que no pudimos ubicar el código solo — escribí la respuesta a mano (podés pedirle esos datos, o directamente pasarle el código si ya lo sabés).'
      );
      return;
    }
    setBuscandoCodigo(true);
    try {
      const resultado = await asegurarCodigoSeccionAdmin(s.colegioId, s.grado, s.turno, s.division);
      if (resultado.success && resultado.codigo) {
        setCodigoEncontrado(resultado.codigo);
      } else {
        setAvisoSinCodigo(
          resultado.error || 'No pudimos ubicar el código de esa sección automáticamente — escribí la respuesta a mano.'
        );
      }
    } finally {
      setBuscandoCodigo(false);
    }
  };

  const handleEnviarRespuesta = async (s: SolicitudCodigo) => {
    if (!codigoEncontrado && respuesta.trim().length < 2) return;
    setProcesandoId(s.id);
    setErrorRespuesta(null);
    try {
      const resultado = await responderSolicitudCodigoAdmin(s.id, respuesta.trim(), codigoEncontrado || undefined);
      if (resultado.success) {
        setRespondiendoId(null);
        setRespuesta('');
        setRespuestaEnviadaId(s.id);
        // El servidor ya marcó la solicitud como atendida al enviar el email — se refleja acá
        // sin esperar un refresco manual, igual que hace handleAtender.
        if (filtro === 'pendiente') {
          setSolicitudes((prev) => prev.filter((item) => item.id !== s.id));
        } else {
          setSolicitudes((prev) => prev.map((item) => (item.id === s.id ? { ...item, estado: 'atendido' } : item)));
        }
      } else {
        setErrorRespuesta(resultado.error || 'No se pudo enviar la respuesta.');
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
          su código de curso. Tocá <strong>"Responder"</strong> para mandarles el código por email directo desde el
          sistema (queda registrada como atendida automáticamente), o marcala como atendida a mano si preferís
          resolverlo por WhatsApp.
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
                <Fragment key={s.id}>
                <tr className="hover:bg-slate-50/70">
                  <td className="py-2.5 px-3 font-semibold text-slate-800">{s.nombreSolicitante}</td>
                  <td className="py-2.5 px-3">
                    <span className="flex items-center gap-1 text-slate-600 font-mono">
                      <Mail className="w-3 h-3 text-emerald-500 shrink-0" /> {s.contacto}
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
                      <button
                        type="button"
                        onClick={() => (respondiendoId === s.id ? setRespondiendoId(null) : handleAbrirRespuesta(s))}
                        disabled={procesandoId === s.id}
                        className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-[10px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        Responder
                      </button>
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
                {respondiendoId === s.id && (
                  <tr>
                    <td colSpan={6} className="py-3 px-3 bg-sky-50/60 border-t border-sky-100">
                      <div className="flex flex-col gap-2">
                        {buscandoCodigo && (
                          <p className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500">
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            Buscando el código de acceso de esa sección...
                          </p>
                        )}
                        {codigoEncontrado && (
                          <div className="flex items-center gap-2 px-3 py-2 rounded-xl bg-emerald-50 border border-emerald-200">
                            <KeyRound className="h-4 w-4 text-emerald-600 shrink-0" />
                            <p className="text-[11px] text-emerald-900">
                              Encontramos el código de <strong>{[s.grado, s.division, s.turno].filter(Boolean).join(' · ')}</strong>:{' '}
                              <span className="font-mono font-extrabold tracking-wider">{codigoEncontrado}</span> — se manda
                              destacado en el email, no hace falta que lo escribas.
                            </p>
                          </div>
                        )}
                        {avisoSinCodigo && (
                          <div className="flex items-start gap-2 px-3 py-2 rounded-xl bg-amber-50 border border-amber-200">
                            <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
                            <p className="text-[11px] text-amber-900">{avisoSinCodigo}</p>
                          </div>
                        )}
                        <textarea
                          value={respuesta}
                          onChange={(e) => setRespuesta(e.target.value)}
                          minLength={codigoEncontrado ? 0 : 2}
                          maxLength={5000}
                          rows={3}
                          autoFocus
                          placeholder={
                            codigoEncontrado
                              ? 'Aclaración opcional (el código ya se agrega solo, no hace falta escribirlo)...'
                              : `Escribí la respuesta que le va a llegar por email a ${s.contacto}...`
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs text-slate-800 focus:outline-none focus:ring-2 focus:ring-sky-400"
                        />
                        {errorRespuesta && (
                          <p className="text-[11px] font-semibold text-red-600">{errorRespuesta}</p>
                        )}
                        <div className="flex items-center justify-end gap-2">
                          <button
                            type="button"
                            onClick={() => setRespondiendoId(null)}
                            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-500 border border-slate-200 rounded-xl text-[10px] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" />
                            Cancelar
                          </button>
                          <button
                            type="button"
                            onClick={() => handleEnviarRespuesta(s)}
                            disabled={procesandoId === s.id || buscandoCodigo || (!codigoEncontrado && respuesta.trim().length < 2)}
                            className="px-3 py-1.5 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-[10px] font-bold inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                          >
                            {procesandoId === s.id ? (
                              <Loader2 className="w-3.5 h-3.5 animate-spin" />
                            ) : (
                              <Send className="w-3.5 h-3.5" />
                            )}
                            Enviar respuesta
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
                {respuestaEnviadaId === s.id && respondiendoId !== s.id && (
                  <tr>
                    <td colSpan={6} className="py-2 px-3 bg-emerald-50/60 border-t border-emerald-100">
                      <p className="flex items-center gap-1.5 text-[11px] font-semibold text-emerald-700">
                        <CheckCircle2 className="h-3.5 w-3.5" />
                        Respuesta enviada correctamente.
                      </p>
                    </td>
                  </tr>
                )}
                </Fragment>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
