import { useCallback, useEffect, useMemo, useState } from 'react';
import { CheckCircle2, Clock3, Inbox, Loader2, Mail, RefreshCw, Search, Send, Sparkles, X } from 'lucide-react';
import {
  actualizarEstadoConsultaFamiliaAdmin,
  ConsultaFamilia,
  EstadoConsultaFamilia,
  obtenerConsultasFamiliasAdmin,
  responderConsultaFamiliaAdmin,
  sugerirRespuestaConsultaFamiliaAdmin,
} from '../services/consultasFamiliasService';

const etiquetasEstado: Record<EstadoConsultaFamilia, string> = {
  nueva: 'Nueva',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
};

export default function AdminConsultasFamiliasTab() {
  const [estado, setEstado] = useState<EstadoConsultaFamilia | 'todas'>('nueva');
  const [consultas, setConsultas] = useState<ConsultaFamilia[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [procesandoId, setProcesandoId] = useState<string | null>(null);
  const [respondiendoId, setRespondiendoId] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [respuestaEnviadaId, setRespuestaEnviadaId] = useState<string | null>(null);
  const [generandoSugerenciaId, setGenerandoSugerenciaId] = useState<string | null>(null);

  const cargar = useCallback(async () => {
    setCargando(true);
    setError('');
    try {
      setConsultas(await obtenerConsultasFamiliasAdmin(estado));
    } catch (err: any) {
      setError(err?.message || 'No se pudieron cargar las consultas.');
    } finally {
      setCargando(false);
    }
  }, [estado]);

  useEffect(() => { void cargar(); }, [cargar]);

  const filtradas = useMemo(() => {
    const termino = busqueda.trim().toLocaleLowerCase('es');
    if (!termino) return consultas;
    return consultas.filter((consulta) =>
      [consulta.nombre, consulta.email, consulta.colegio, consulta.numeroPedido, consulta.asunto, consulta.mensaje]
        .filter(Boolean)
        .some((valor) => String(valor).toLocaleLowerCase('es').includes(termino))
    );
  }, [busqueda, consultas]);

  const cambiarEstado = async (consulta: ConsultaFamilia, nuevoEstado: EstadoConsultaFamilia) => {
    setProcesandoId(consulta.id);
    setError('');
    try {
      await actualizarEstadoConsultaFamiliaAdmin(consulta.id, nuevoEstado);
      if (estado === 'todas') {
        setConsultas((actuales) => actuales.map((item) => item.id === consulta.id ? { ...item, estado: nuevoEstado } : item));
      } else {
        setConsultas((actuales) => actuales.filter((item) => item.id !== consulta.id));
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo actualizar la consulta.');
    } finally {
      setProcesandoId(null);
    }
  };

  const generarSugerencia = async (consulta: ConsultaFamilia) => {
    setGenerandoSugerenciaId(consulta.id);
    setError('');
    try {
      setRespuesta(await sugerirRespuestaConsultaFamiliaAdmin(consulta.id));
    } catch (err: any) {
      setError(err?.message || 'No se pudo generar una sugerencia.');
    } finally {
      setGenerandoSugerenciaId(null);
    }
  };

  const enviarRespuesta = async (consulta: ConsultaFamilia) => {
    setProcesandoId(consulta.id);
    setError('');
    try {
      await responderConsultaFamiliaAdmin(consulta.id, respuesta);
      setRespuesta('');
      setRespondiendoId(null);
      setRespuestaEnviadaId(consulta.id);
      await cargar();
    } catch (err: any) {
      setError(err?.message || 'No se pudo enviar la respuesta.');
    } finally {
      setProcesandoId(null);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="p-4 rounded-2xl border border-sky-200 bg-sky-50 text-sky-950 flex items-start gap-3">
        <Inbox className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold">Consultas recibidas desde la web</p>
          <p className="text-xs text-sky-800 mt-0.5">Respondé por email y usá los estados para organizar el seguimiento de cada familia.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1">
          {(['nueva', 'en_proceso', 'resuelta', 'todas'] as const).map((opcion) => (
            <button key={opcion} type="button" onClick={() => setEstado(opcion)} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${estado === opcion ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}>
              {opcion === 'todas' ? 'Todas' : etiquetasEstado[opcion]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="relative min-w-0 sm:w-72">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
            <input value={busqueda} onChange={(event) => setBusqueda(event.target.value)} placeholder="Buscar familia, colegio o pedido" className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-xs" />
          </label>
          <button type="button" onClick={cargar} className="p-2 border border-slate-200 bg-white hover:bg-slate-50 rounded-xl cursor-pointer" title="Actualizar">
            <RefreshCw className={`w-4 h-4 text-slate-600 ${cargando ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {error && <p className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs">{error}</p>}

      {cargando ? (
        <div className="py-14 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>
      ) : filtradas.length === 0 ? (
        <div className="py-14 text-center border border-dashed border-slate-300 rounded-2xl text-sm text-slate-500">No hay consultas en esta vista.</div>
      ) : (
        <div className="space-y-3">
          {filtradas.map((consulta) => {
            const asuntoRespuesta = `Re: ${consulta.asunto}${consulta.numeroPedido ? ` · Pedido ${consulta.numeroPedido}` : ''}`;
            return (
              <article key={consulta.id} className="p-4 bg-white border border-slate-200 rounded-2xl shadow-2xs">
                <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-sm text-slate-900">{consulta.nombre}</h3>
                      <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 text-[10px] font-bold">{etiquetasEstado[consulta.estado]}</span>
                      <span className="text-[10px] text-slate-400 uppercase font-bold">{consulta.origen === 'web' ? 'Formulario web' : 'Email'}</span>
                    </div>
                    <p className="font-semibold text-xs text-slate-800 mt-2">{consulta.asunto}</p>
                    <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap break-words">{consulta.mensaje}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
                      <a className="inline-flex items-center gap-1 hover:text-sky-700 hover:underline" href={`mailto:${consulta.email}?subject=${encodeURIComponent(asuntoRespuesta)}`}><Mail className="w-3 h-3" />{consulta.email}</a>
                      {consulta.telefono && <span>{consulta.telefono}</span>}
                      {consulta.colegio && <span>Colegio: {consulta.colegio}</span>}
                      {consulta.numeroPedido && <span>Pedido: {consulta.numeroPedido}</span>}
                      <span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />{new Date(consulta.createdAt).toLocaleString('es-AR')}</span>
                    </div>
                    {consulta.mensajes.length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Conversación</p>
                        {consulta.mensajes.map((mensaje) => (
                          <div key={mensaje.id} className={`max-w-3xl rounded-xl border p-3 ${mensaje.direccion === 'entrante' ? 'border-emerald-200 bg-emerald-50' : 'ml-auto border-sky-200 bg-sky-50'}`}>
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                              <span className={mensaje.direccion === 'entrante' ? 'text-emerald-700' : 'text-sky-700'}>{mensaje.direccion === 'entrante' ? 'Familia' : 'Retrato Escolar'}</span>
                              <span className="font-normal text-slate-400">{new Date(mensaje.createdAt).toLocaleString('es-AR')}</span>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-xs text-slate-700">{mensaje.contenido}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button type="button" onClick={() => { setRespondiendoId(consulta.id); setRespuesta(''); setRespuestaEnviadaId(null); }} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"><Mail className="w-3.5 h-3.5" />Responder</button>
                    <select value={consulta.estado} disabled={procesandoId === consulta.id} onChange={(event) => void cambiarEstado(consulta, event.target.value as EstadoConsultaFamilia)} className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-bold disabled:opacity-50">
                      <option value="nueva">Nueva</option>
                      <option value="en_proceso">En proceso</option>
                      <option value="resuelta">Resuelta</option>
                    </select>
                  </div>
                </div>
                {respuestaEnviadaId === consulta.id && (
                  <p className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-emerald-700"><CheckCircle2 className="h-4 w-4" />Respuesta enviada correctamente.</p>
                )}
                {respondiendoId === consulta.id && (
                  <div className="mt-4 rounded-xl border border-sky-200 bg-sky-50 p-3">
                    <div className="mb-2 flex items-center justify-between gap-3">
                      <p className="text-xs font-bold text-sky-950">Responder a {consulta.email}</p>
                      <button type="button" onClick={() => { setRespondiendoId(null); setRespuesta(''); }} className="rounded-lg p-1 text-slate-500 hover:bg-white cursor-pointer" aria-label="Cerrar respuesta"><X className="h-4 w-4" /></button>
                    </div>
                    <textarea autoFocus value={respuesta} onChange={(event) => setRespuesta(event.target.value)} minLength={2} maxLength={5000} rows={5} placeholder="Escribí la respuesta para la familia, o generá un borrador con IA..." className="w-full resize-y rounded-xl border border-slate-300 bg-white p-3 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-200" />
                    <div className="mt-2 flex justify-between items-center gap-3">
                      <button type="button" disabled={generandoSugerenciaId === consulta.id} onClick={() => void generarSugerencia(consulta)} className="inline-flex items-center gap-1.5 rounded-xl border border-sky-300 bg-white px-3 py-2 text-xs font-bold text-sky-700 hover:bg-sky-100 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                        {generandoSugerenciaId === consulta.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                        {generandoSugerenciaId === consulta.id ? 'Generando...' : 'Sugerir con IA'}
                      </button>
                      <button type="button" disabled={respuesta.trim().length < 2 || procesandoId === consulta.id} onClick={() => void enviarRespuesta(consulta)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                        {procesandoId === consulta.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                        {procesandoId === consulta.id ? 'Enviando...' : 'Enviar respuesta'}
                      </button>
                    </div>
                    <p className="mt-1.5 text-[10px] text-slate-400">La IA solo redacta un borrador acá — revisalo (y editalo si hace falta) antes de enviarlo, nunca se manda solo.</p>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
    </div>
  );
}
