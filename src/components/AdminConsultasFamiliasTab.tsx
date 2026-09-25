import { useCallback, useEffect, useMemo, useState } from 'react';
import { AlertTriangle, Archive, ArchiveRestore, Bot, CheckCircle2, ChevronDown, Clock3, Inbox, Loader2, Mail, MessageSquare, RefreshCw, Search, Send, Sparkles, Trash2, X } from 'lucide-react';
import {
  actualizarEstadoConsultaFamiliaAdmin,
  ConsultaFamilia,
  eliminarConsultaFamiliaAdmin,
  EstadoConsultaFamilia,
  obtenerConsultasFamiliasAdmin,
  responderConsultaFamiliaAdmin,
  sugerirRespuestaConsultaFamiliaAdmin,
} from '../services/consultasFamiliasService';

const etiquetasEstado: Record<EstadoConsultaFamilia, string> = {
  nueva: 'Nueva',
  en_proceso: 'En proceso',
  resuelta: 'Resuelta',
  archivada: 'Archivada',
};

const estilosEstado: Record<EstadoConsultaFamilia, string> = {
  nueva: 'bg-amber-100 text-amber-800',
  en_proceso: 'bg-sky-100 text-sky-800',
  resuelta: 'bg-emerald-100 text-emerald-800',
  archivada: 'bg-slate-200 text-slate-600',
};

// Fecha de la última novedad de la conversación (mensaje más reciente, o la consulta misma).
function ultimaActividad(consulta: ConsultaFamilia): number {
  const fechas = [consulta.createdAt, ...consulta.mensajes.map((m) => m.createdAt)].map((f) => new Date(f).getTime()).filter((n) => !Number.isNaN(n));
  return fechas.length ? Math.max(...fechas) : 0;
}

function fechaCorta(ms: number): string {
  if (!ms) return '';
  const fecha = new Date(ms);
  const hoy = new Date();
  if (fecha.toDateString() === hoy.toDateString()) {
    return fecha.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
  }
  return fecha.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
}

/**
 * Bandeja de consultas de familias. Pedido de Pablo (24/9): "los emails siempre están
 * desplegados, no como en Gmail... tampoco puedo borrarlos ni archivarlos". Ahora cada consulta
 * es una fila compacta (nombre, asunto, último mensaje, fecha) que se abre al tocarla, y se puede
 * archivar (sale de la bandeja sin borrarse; vuelve sola si la familia responde) o borrar.
 */
export default function AdminConsultasFamiliasTab() {
  const [estado, setEstado] = useState<EstadoConsultaFamilia | 'todas'>('nueva');
  const [consultas, setConsultas] = useState<ConsultaFamilia[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState('');
  const [abiertaId, setAbiertaId] = useState<string | null>(null);
  const [procesandoId, setProcesandoId] = useState<string | null>(null);
  const [respondiendoId, setRespondiendoId] = useState<string | null>(null);
  const [respuesta, setRespuesta] = useState('');
  const [respuestaEnviadaId, setRespuestaEnviadaId] = useState<string | null>(null);
  const [generandoSugerenciaId, setGenerandoSugerenciaId] = useState<string | null>(null);
  const [avisoSugerencia, setAvisoSugerencia] = useState('');

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
    const lista = termino
      ? consultas.filter((consulta) =>
          [consulta.nombre, consulta.email, consulta.colegio, consulta.numeroPedido, consulta.asunto, consulta.mensaje]
            .filter(Boolean)
            .some((valor) => String(valor).toLocaleLowerCase('es').includes(termino))
        )
      : consultas;
    // Como en cualquier bandeja de email: arriba la conversación con la novedad más reciente.
    return [...lista].sort((a, b) => ultimaActividad(b) - ultimaActividad(a));
  }, [busqueda, consultas]);

  const quitarDeLaVista = (id: string) => {
    setConsultas((actuales) => actuales.filter((item) => item.id !== id));
    if (abiertaId === id) setAbiertaId(null);
    if (respondiendoId === id) { setRespondiendoId(null); setRespuesta(''); }
  };

  const cambiarEstado = async (consulta: ConsultaFamilia, nuevoEstado: EstadoConsultaFamilia) => {
    setProcesandoId(consulta.id);
    setError('');
    try {
      await actualizarEstadoConsultaFamiliaAdmin(consulta.id, nuevoEstado);
      if (estado === 'todas') {
        setConsultas((actuales) => actuales.map((item) => item.id === consulta.id ? { ...item, estado: nuevoEstado } : item));
      } else {
        quitarDeLaVista(consulta.id);
      }
    } catch (err: any) {
      setError(err?.message || 'No se pudo actualizar la consulta.');
    } finally {
      setProcesandoId(null);
    }
  };

  const borrar = async (consulta: ConsultaFamilia) => {
    if (!window.confirm(`¿Borrar definitivamente la consulta de ${consulta.nombre} y toda su conversación? Esto no se puede deshacer.\n\nSi solo querés sacarla de la bandeja, usá "Archivar".`)) return;
    setProcesandoId(consulta.id);
    setError('');
    try {
      await eliminarConsultaFamiliaAdmin(consulta.id);
      quitarDeLaVista(consulta.id);
    } catch (err: any) {
      setError(err?.message || 'No se pudo borrar la consulta.');
    } finally {
      setProcesandoId(null);
    }
  };

  const generarSugerencia = async (consulta: ConsultaFamilia) => {
    setGenerandoSugerenciaId(consulta.id);
    setError('');
    try {
      const { sugerencia, aviso } = await sugerirRespuestaConsultaFamiliaAdmin(consulta.id);
      setRespuesta(sugerencia);
      setAvisoSugerencia(sugerencia ? '' : aviso || 'La IA considera que no hace falta responder.');
      // Trae la verificación actualizada de los datos de la familia.
      const actualizadas = await obtenerConsultasFamiliasAdmin(estado);
      setConsultas(actualizadas);
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
          <p className="text-xs text-sky-800 mt-0.5">Cada consulta se revisa sola con los datos de la familia: si todo está bien y es una duda sobre cómo funciona la página, se responde automáticamente; si no, te queda un borrador listo. Archivá las terminadas: si la familia vuelve a escribir, reaparecen como nuevas.</p>
        </div>
      </div>

      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        <div className="flex flex-wrap gap-1 bg-slate-100 rounded-xl p-1">
          {(['nueva', 'en_proceso', 'resuelta', 'archivada', 'todas'] as const).map((opcion) => (
            <button key={opcion} type="button" onClick={() => { setEstado(opcion); setAbiertaId(null); }} className={`px-3 py-1.5 rounded-lg text-xs font-bold cursor-pointer ${estado === opcion ? 'bg-white text-slate-900 shadow-2xs' : 'text-slate-500 hover:text-slate-800'}`}>
              {opcion === 'todas' ? 'Todas' : opcion === 'archivada' ? 'Archivadas' : etiquetasEstado[opcion]}
            </button>
          ))}
        </div>
        <div className="flex gap-2">
          <label className="relative min-w-0 flex-1 sm:w-72">
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
        <div className="bg-white border border-slate-200 rounded-2xl shadow-2xs divide-y divide-slate-100 overflow-hidden">
          {filtradas.map((consulta) => {
            const abierta = abiertaId === consulta.id;
            const ultimo = consulta.mensajes[consulta.mensajes.length - 1];
            const resumen = ultimo
              ? `${ultimo.direccion === 'entrante' ? 'Familia' : 'Vos'}: ${ultimo.contenido}`
              : consulta.mensaje;
            const sinLeer = consulta.estado === 'nueva';
            const ocupada = procesandoId === consulta.id;
            const asuntoRespuesta = `Re: ${consulta.asunto}${consulta.numeroPedido ? ` · Pedido ${consulta.numeroPedido}` : ''}`;
            return (
              <article key={consulta.id} className={abierta ? 'bg-slate-50/60' : ''}>
                <div className="flex items-center gap-2 px-3 sm:px-4 hover:bg-slate-50">
                  <button
                    type="button"
                    onClick={() => setAbiertaId(abierta ? null : consulta.id)}
                    aria-expanded={abierta}
                    className="flex-1 min-w-0 flex items-center gap-3 py-3 text-left cursor-pointer"
                  >
                    <span className={`w-2 h-2 rounded-full shrink-0 ${sinLeer ? 'bg-sky-500' : 'bg-transparent'}`} aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`text-sm truncate ${sinLeer ? 'font-extrabold text-slate-900' : 'font-semibold text-slate-700'}`}>{consulta.nombre}</span>
                        {consulta.mensajes.length > 0 && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-400 shrink-0"><MessageSquare className="w-3 h-3" />{consulta.mensajes.length}</span>
                        )}
                        <span className={`hidden sm:inline px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 ${estilosEstado[consulta.estado]}`}>{etiquetasEstado[consulta.estado]}</span>
                        {ultimo?.automatica && (
                          <span className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-sky-50 text-sky-700 text-[10px] font-bold shrink-0"><Bot className="w-3 h-3" />Respondida sola</span>
                        )}
                        {consulta.borradorIa && (
                          <span className="hidden sm:inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-violet-50 text-violet-700 text-[10px] font-bold shrink-0"><Sparkles className="w-3 h-3" />Borrador listo</span>
                        )}
                      </div>
                      <p className="text-xs truncate mt-0.5">
                        <span className={sinLeer ? 'font-bold text-slate-800' : 'font-medium text-slate-700'}>{consulta.asunto}</span>
                        <span className="text-slate-400"> — {resumen.replace(/\s+/g, ' ')}</span>
                      </p>
                    </div>
                    <span className={`text-[11px] shrink-0 ${sinLeer ? 'font-bold text-slate-800' : 'text-slate-400'}`}>{fechaCorta(ultimaActividad(consulta))}</span>
                    <ChevronDown className={`w-4 h-4 text-slate-400 shrink-0 transition-transform ${abierta ? 'rotate-180' : ''}`} />
                  </button>
                  <div className="flex items-center shrink-0">
                    {consulta.estado === 'archivada' ? (
                      <button type="button" disabled={ocupada} onClick={() => void cambiarEstado(consulta, 'resuelta')} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer" title="Desarchivar (pasa a Resuelta)" aria-label="Desarchivar">
                        <ArchiveRestore className="w-4 h-4" />
                      </button>
                    ) : (
                      <button type="button" disabled={ocupada} onClick={() => void cambiarEstado(consulta, 'archivada')} className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 disabled:opacity-40 cursor-pointer" title="Archivar" aria-label="Archivar">
                        <Archive className="w-4 h-4" />
                      </button>
                    )}
                    <button type="button" disabled={ocupada} onClick={() => void borrar(consulta)} className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40 cursor-pointer" title="Borrar" aria-label="Borrar">
                      {ocupada ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                    </button>
                  </div>
                </div>

                {abierta && (
                  <div className="px-4 sm:px-9 pb-4">
                    <div className="flex flex-col xl:flex-row xl:items-start justify-between gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`sm:hidden px-2 py-0.5 rounded-full text-[10px] font-bold ${estilosEstado[consulta.estado]}`}>{etiquetasEstado[consulta.estado]}</span>
                          <span className="text-[10px] text-slate-400 uppercase font-bold">{consulta.origen === 'web' ? 'Formulario web' : consulta.origen === 'panel' ? 'Iniciada por vos desde el panel' : 'Email'}</span>
                        </div>
                        {consulta.origen !== 'panel' && <p className="text-xs text-slate-600 mt-1 whitespace-pre-wrap break-words">{consulta.mensaje}</p>}
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-3 text-[11px] text-slate-500">
                          <a className="inline-flex items-center gap-1 hover:text-sky-700 hover:underline" href={`mailto:${consulta.email}?subject=${encodeURIComponent(asuntoRespuesta)}`}><Mail className="w-3 h-3" />{consulta.email}</a>
                          {consulta.telefono && <span>{consulta.telefono}</span>}
                          {consulta.colegio && <span>Colegio: {consulta.colegio}</span>}
                          {consulta.numeroPedido && <span>Pedido: {consulta.numeroPedido}</span>}
                          <span className="inline-flex items-center gap-1"><Clock3 className="w-3 h-3" />{new Date(consulta.createdAt).toLocaleString('es-AR')}</span>
                        </div>
                      </div>
                      <div className="flex flex-wrap items-center gap-2 shrink-0">
                        <button type="button" onClick={() => { setRespondiendoId(consulta.id); setRespuesta(consulta.borradorIa || ''); setAvisoSugerencia(''); setRespuestaEnviadaId(null); }} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"><Mail className="w-3.5 h-3.5" />Responder</button>
                        <select value={consulta.estado} disabled={ocupada} onChange={(event) => void cambiarEstado(consulta, event.target.value as EstadoConsultaFamilia)} className="px-3 py-2 border border-slate-200 rounded-xl bg-white text-xs font-bold disabled:opacity-50">
                          <option value="nueva">Nueva</option>
                          <option value="en_proceso">En proceso</option>
                          <option value="resuelta">Resuelta</option>
                          <option value="archivada">Archivada</option>
                        </select>
                      </div>
                    </div>

                    {consulta.verificacionIa && (
                      <div className={`mt-4 rounded-xl border p-3 ${consulta.verificacionIa.todoOk ? 'border-emerald-200 bg-emerald-50/60' : 'border-amber-200 bg-amber-50/70'}`}>
                        <p className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800">
                          <Bot className="h-3.5 w-3.5" />
                          Revisión automática de los datos de la familia
                        </p>
                        <ul className="mt-2 space-y-1">
                          {consulta.verificacionIa.chequeos.map((chequeo, i) => (
                            <li key={i} className="flex items-start gap-1.5 text-[11px] text-slate-700">
                              {chequeo.ok
                                ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600 shrink-0 mt-px" />
                                : <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0 mt-px" />}
                              <span>{chequeo.texto}</span>
                            </li>
                          ))}
                        </ul>
                        {consulta.verificacionIa.datos.length > 0 && (
                          <ul className="mt-2 space-y-0.5 border-t border-black/5 pt-2">
                            {consulta.verificacionIa.datos.map((dato, i) => (
                              <li key={i} className="text-[11px] text-slate-500">• {dato}</li>
                            ))}
                          </ul>
                        )}
                        <p className="mt-2 text-[11px] font-semibold text-slate-700">
                          {consulta.verificacionIa.enviadaAutomaticamente
                            ? '✅ Se respondió automáticamente.'
                            : consulta.borradorIa
                              ? `✍️ Borrador listo para revisar — tocá "Responder". ${consulta.verificacionIa.motivoNoEnvio || ''}`
                              : consulta.verificacionIa.motivoNoEnvio || consulta.verificacionIa.motivo || ''}
                        </p>
                      </div>
                    )}

                    {consulta.mensajes.length > 0 && (
                      <div className="mt-4 space-y-2 border-t border-slate-100 pt-3">
                        <p className="text-[10px] font-bold uppercase tracking-wide text-slate-400">Conversación</p>
                        {consulta.mensajes.map((mensaje) => (
                          <div key={mensaje.id} className={`max-w-3xl rounded-xl border p-3 ${mensaje.direccion === 'entrante' ? 'border-emerald-200 bg-emerald-50' : 'ml-auto border-sky-200 bg-sky-50'}`}>
                            <div className="mb-1 flex flex-wrap items-center justify-between gap-2 text-[10px] font-bold">
                              <span className={`inline-flex items-center gap-1 ${mensaje.direccion === 'entrante' ? 'text-emerald-700' : 'text-sky-700'}`}>
                                {mensaje.direccion === 'entrante' ? 'Familia' : 'Retrato Escolar'}
                                {mensaje.automatica && <span className="inline-flex items-center gap-0.5 rounded-full bg-sky-100 px-1.5 py-px font-bold text-sky-800"><Bot className="h-3 w-3" />Automática</span>}
                              </span>
                              <span className="font-normal text-slate-400">{new Date(mensaje.createdAt).toLocaleString('es-AR')}</span>
                            </div>
                            <p className="whitespace-pre-wrap break-words text-xs text-slate-700">{mensaje.contenido}</p>
                          </div>
                        ))}
                      </div>
                    )}

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
                          <button type="button" disabled={respuesta.trim().length < 2 || ocupada} onClick={() => void enviarRespuesta(consulta)} className="inline-flex items-center gap-2 rounded-xl bg-slate-950 px-4 py-2 text-xs font-bold text-white hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer">
                            {ocupada ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                            {ocupada ? 'Enviando...' : 'Enviar respuesta'}
                          </button>
                        </div>
                        {avisoSugerencia && <p className="mt-1.5 text-[11px] font-semibold text-amber-700">{avisoSugerencia}</p>}
                        <p className="mt-1.5 text-[10px] text-slate-400">La IA solo redacta un borrador acá — revisalo (y editalo si hace falta) antes de enviarlo, nunca se manda solo.</p>
                      </div>
                    )}
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
