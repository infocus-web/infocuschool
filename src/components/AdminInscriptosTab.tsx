import React, { useState, useEffect, useMemo } from 'react';
import {
  UserCheck,
  CheckCircle2,
  Clock,
  Search,
  Key,
  Mail,
  Send,
  Sparkles,
  Check,
  RefreshCw,
  Eye,
  MessageCircle,
  ShieldCheck,
  UserPlus,
  ExternalLink,
  Copy,
  AlertCircle,
  School,
  X
} from 'lucide-react';
import {
  InscripcionFamilia,
  obtenerInscripciones,
  aprobarInscripcion,
  rechazarInscripcion,
  generarEnlaceWhatsAppAprobacion,
  generarMensajeWhatsAppAprobacion,
  simularEnvioEmailAprobacion,
  determinarCodigoParaInscripcion,
  guardarInscripcion
} from '../services/inscripcionesService';
import { getCodigosCursos } from '../data/codigosCursos';

interface AdminInscriptosTabProps {
  onProbarCodigo?: (codigo: string) => void;
}

export default function AdminInscriptosTab({ onProbarCodigo }: AdminInscriptosTabProps) {
  const [inscripciones, setInscripciones] = useState<InscripcionFamilia[]>(() => obtenerInscripciones());
  const [filtroEstado, setFiltroEstado] = useState<'todos' | 'pendiente' | 'aceptado'>('todos');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastNotificacion, setToastNotificacion] = useState<{
    titulo: string;
    mensaje: string;
    tipo: 'success' | 'info';
  } | null>(null);

  // Modal for previewing sent email / whatsapp dispatch
  const [detalleEnvioModal, setDetalleEnvioModal] = useState<{
    familia: InscripcionFamilia;
    codigo: string;
    emailData: ReturnType<typeof simularEnvioEmailAprobacion>;
    whatsappMsg: string;
    whatsappUrl: string;
  } | null>(null);

  // Editable codes for pending items
  const [codigosEditables, setCodigosEditables] = useState<Record<string, string>>({});

  // Listen to cross-modal storage updates
  useEffect(() => {
    const handleStorageChange = () => {
      setInscripciones(obtenerInscripciones());
    };
    window.addEventListener('infocus_inscripciones_updated', handleStorageChange);
    window.addEventListener('storage', handleStorageChange);
    return () => {
      window.removeEventListener('infocus_inscripciones_updated', handleStorageChange);
      window.removeEventListener('storage', handleStorageChange);
    };
  }, []);

  const totalInscriptos = inscripciones.length;
  const pendientes = useMemo(() => inscripciones.filter((i) => i.estado === 'pendiente'), [inscripciones]);
  const aceptados = useMemo(() => inscripciones.filter((i) => i.estado === 'aceptado'), [inscripciones]);

  // Filtered list
  const inscripcionesFiltradas = useMemo(() => {
    return inscripciones.filter((item) => {
      const matchEstado =
        filtroEstado === 'todos' || item.estado === filtroEstado;

      if (!matchEstado) return false;

      if (!searchQuery.trim()) return true;
      const q = searchQuery.toLowerCase().trim();
      return (
        item.alumnoNombre.toLowerCase().includes(q) ||
        item.alumnoApellido.toLowerCase().includes(q) ||
        item.padreNombre.toLowerCase().includes(q) ||
        item.email.toLowerCase().includes(q) ||
        item.telefonoWhatsApp.toLowerCase().includes(q) ||
        item.grado.toLowerCase().includes(q) ||
        item.division.toLowerCase().includes(q) ||
        item.colegioNombre.toLowerCase().includes(q) ||
        (item.codigoAsignado && item.codigoAsignado.toLowerCase().includes(q))
      );
    });
  }, [inscripciones, filtroEstado, searchQuery]);

  const handleAprobar = (item: InscripcionFamilia, abrirWhatsAppAuto = true) => {
    const codigoElegido =
      codigosEditables[item.id] ||
      item.codigoAsignado ||
      determinarCodigoParaInscripcion(item);

    const resultado = aprobarInscripcion(item.id, codigoElegido);
    if (!resultado) return;

    const actualizadas = obtenerInscripciones();
    setInscripciones(actualizadas);

    const emailData = simularEnvioEmailAprobacion(resultado.familia, resultado.codigo);
    const whatsappMsg = generarMensajeWhatsAppAprobacion(resultado.familia, resultado.codigo);
    const whatsappUrl = generarEnlaceWhatsAppAprobacion(resultado.familia, resultado.codigo);

    // Show modal preview
    setDetalleEnvioModal({
      familia: resultado.familia,
      codigo: resultado.codigo,
      emailData,
      whatsappMsg,
      whatsappUrl
    });

    setToastNotificacion({
      titulo: `¡Inscripción aprobada para ${item.alumnoNombre}!`,
      mensaje: `Código ${resultado.codigo} asignado y despachado por WhatsApp (+${item.telefonoWhatsApp}) y por Email (${item.email}).`,
      tipo: 'success'
    });

    setTimeout(() => {
      setToastNotificacion(null);
    }, 6000);

    // If requested, open WhatsApp in a new window/tab
    if (abrirWhatsAppAuto) {
      try {
        window.open(whatsappUrl, '_blank', 'noopener,noreferrer');
      } catch (e) {
        console.log('Popup prevented, accessible from detail modal');
      }
    }
  };

  const handleAprobarTodosLosPendientes = () => {
    if (pendientes.length === 0) return;
    pendientes.forEach((item) => {
      aprobarInscripcion(item.id);
    });
    setInscripciones(obtenerInscripciones());
    setToastNotificacion({
      titulo: '¡Todas las solicitudes fueron aprobadas!',
      mensaje: `Se asignaron y enviaron los códigos correspondientes a las ${pendientes.length} familias pendientes.`,
      tipo: 'success'
    });
    setTimeout(() => setToastNotificacion(null), 5000);
  };

  const handleCrearInscripcionPrueba = () => {
    const nombres = ['Valentina', 'Joaquín', 'Martina', 'Lucas', 'Camila', 'Santiago'];
    const apellidos = ['Fernández', 'Álvarez', 'Romero', 'Sosa', 'Torres', 'Navarro'];
    const salas = [
      { grado: 'Sala 3 años', turno: 'Mañana', div: 'Amarilla' },
      { grado: 'Sala 4 años', turno: 'Tarde', div: 'Verde' },
      { grado: 'Sala 5 años', turno: 'Tarde', div: 'Celeste' },
    ];
    const rndNombre = nombres[Math.floor(Math.random() * nombres.length)];
    const rndApellido = apellidos[Math.floor(Math.random() * apellidos.length)];
    const rndSala = salas[Math.floor(Math.random() * salas.length)];

    const nueva = guardarInscripcion({
      padreNombre: `Lucía ${rndApellido}`,
      telefonoWhatsApp: `+54 9 11 ${Math.floor(2000 + Math.random() * 8000)}-${Math.floor(1000 + Math.random() * 9000)}`,
      email: `familia.${rndApellido.toLowerCase()}@ejemplo.com`,
      alumnoNombre: rndNombre,
      alumnoApellido: rndApellido,
      turno: rndSala.turno,
      grado: rndSala.grado,
      division: rndSala.div,
      colegioId: 'col-modelo-2026',
      colegioNombre: 'Colegio Modelo'
    });

    setInscripciones(obtenerInscripciones());
    setToastNotificacion({
      titulo: 'Inscripción de prueba creada',
      mensaje: `Se registró a ${nueva.alumnoNombre} ${nueva.alumnoApellido}. Aparece como "Pendiente" lista para aprobar y enviar código.`,
      tipo: 'info'
    });
    setTimeout(() => setToastNotificacion(null), 5000);
  };

  return (
    <div className="space-y-6 text-slate-900">
      {/* Toast feedback banner */}
      {toastNotificacion && (
        <div
          className={`p-4 rounded-2xl border text-left flex items-start justify-between gap-3 shadow-md animate-in slide-in-from-top-2 duration-200 ${
            toastNotificacion.tipo === 'success'
              ? 'bg-emerald-50 border-emerald-300 text-emerald-950'
              : 'bg-amber-50 border-amber-300 text-amber-950'
          }`}
        >
          <div className="flex items-start gap-3">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
            <div>
              <p className="font-bold text-sm">{toastNotificacion.titulo}</p>
              <p className="text-xs opacity-90 mt-0.5">{toastNotificacion.mensaje}</p>
            </div>
          </div>
          <button
            onClick={() => setToastNotificacion(null)}
            className="text-slate-400 hover:text-slate-700 p-1 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Summary Metrics Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
        <div className="p-4 rounded-2xl bg-white border border-slate-200 shadow-2xs text-left">
          <div className="flex items-center justify-between text-slate-500 mb-1">
            <span className="text-xs font-semibold">Total Inscriptos</span>
            <UserCheck className="w-4 h-4 text-slate-400" />
          </div>
          <div className="text-2xl font-black text-slate-900 font-['Outfit']">
            {totalInscriptos}{' '}
            <span className="text-xs font-normal text-slate-500">familias</span>
          </div>
          <p className="text-[11px] text-slate-500 mt-1">Registrados en la plataforma</p>
        </div>

        <div className="p-4 rounded-2xl bg-amber-50/70 border-2 border-amber-300 shadow-2xs text-left">
          <div className="flex items-center justify-between text-amber-800 mb-1">
            <span className="text-xs font-extrabold flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
              Pendientes de Aceptación
            </span>
            <Clock className="w-4 h-4 text-amber-600" />
          </div>
          <div className="text-2xl font-black text-amber-950 font-['Outfit']">
            {pendientes.length}{' '}
            <span className="text-xs font-normal text-amber-700">esperando código</span>
          </div>
          <p className="text-[11px] text-amber-800 mt-1">
            Revisá los datos y hacé clic en el check para enviarles el código
          </p>
        </div>

        <div className="p-4 rounded-2xl bg-emerald-50/70 border border-emerald-200 shadow-2xs text-left">
          <div className="flex items-center justify-between text-emerald-800 mb-1">
            <span className="text-xs font-bold">Aprobados & Enviados</span>
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
          </div>
          <div className="text-2xl font-black text-emerald-950 font-['Outfit']">
            {aceptados.length}{' '}
            <span className="text-xs font-normal text-emerald-700">con código activo</span>
          </div>
          <p className="text-[11px] text-emerald-700 mt-1">
            Notificados por WhatsApp y Correo Electrónico
          </p>
        </div>
      </div>

      {/* Control Bar: Filters & Actions */}
      <div className="bg-slate-50 p-4 rounded-2xl border border-slate-200 flex flex-col md:flex-row md:items-center justify-between gap-3 text-left">
        {/* State Tabs */}
        <div className="flex items-center gap-1.5 bg-white p-1 rounded-xl border border-slate-200 shadow-2xs">
          <button
            type="button"
            onClick={() => setFiltroEstado('todos')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
              filtroEstado === 'todos'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100'
            }`}
          >
            Todos ({totalInscriptos})
          </button>
          <button
            type="button"
            onClick={() => setFiltroEstado('pendiente')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filtroEstado === 'pendiente'
                ? 'bg-amber-500 text-slate-950 shadow-xs'
                : 'text-amber-800 hover:bg-amber-100/60'
            }`}
          >
            <Clock className="w-3 h-3" />
            <span>Pendientes ({pendientes.length})</span>
          </button>
          <button
            type="button"
            onClick={() => setFiltroEstado('aceptado')}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
              filtroEstado === 'aceptado'
                ? 'bg-emerald-600 text-white shadow-xs'
                : 'text-emerald-700 hover:bg-emerald-100/60'
            }`}
          >
            <CheckCircle2 className="w-3 h-3" />
            <span>Aprobados ({aceptados.length})</span>
          </button>
        </div>

        {/* Search & Actions */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Buscar por alumno, tutor, curso..."
              className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
            />
          </div>

          {pendientes.length > 0 && (
            <button
              type="button"
              onClick={handleAprobarTodosLosPendientes}
              className="px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl shadow-xs transition-colors flex items-center gap-1.5 cursor-pointer"
            >
              <Check className="w-3.5 h-3.5" />
              <span>Aceptar Todos ({pendientes.length})</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleCrearInscripcionPrueba}
            className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 border border-slate-300 text-xs font-semibold rounded-xl shadow-2xs transition-colors flex items-center gap-1.5 cursor-pointer"
            title="Genera una inscripción ficticia para probar la aceptación"
          >
            <UserPlus className="w-3.5 h-3.5 text-amber-600" />
            <span>Simular Inscripción</span>
          </button>
        </div>
      </div>

      {/* Main Table / Ficha de Inscriptos */}
      <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white shadow-2xs text-left">
        <table className="w-full text-xs">
          <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
            <tr>
              <th className="py-3 px-4">Estado & Aprobación</th>
              <th className="py-3 px-4">Alumno & Curso</th>
              <th className="py-3 px-4">Tutor / Contacto</th>
              <th className="py-3 px-4">Código de Curso</th>
              <th className="py-3 px-4">Envíos (WhatsApp / Email)</th>
              <th className="py-3 px-4 text-right">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {inscripcionesFiltradas.length === 0 ? (
              <tr>
                <td colSpan={6} className="py-12 text-center text-slate-400 space-y-2">
                  <UserCheck className="w-8 h-8 mx-auto text-slate-300" />
                  <p className="text-sm font-semibold text-slate-600">
                    No se encontraron inscripciones con el criterio seleccionado.
                  </p>
                  <button
                    onClick={handleCrearInscripcionPrueba}
                    className="text-xs text-amber-600 font-bold hover:underline"
                  >
                    Crear una inscripción de prueba
                  </button>
                </td>
              </tr>
            ) : (
              inscripcionesFiltradas.map((item) => {
                const esPendiente = item.estado === 'pendiente';
                const codigoSugerido =
                  codigosEditables[item.id] ||
                  item.codigoAsignado ||
                  determinarCodigoParaInscripcion(item);

                return (
                  <tr
                    key={item.id}
                    className={`transition-colors ${
                      esPendiente ? 'bg-amber-50/30 hover:bg-amber-50/60' : 'hover:bg-slate-50/70'
                    }`}
                  >
                    {/* Status & Check Action */}
                    <td className="py-3.5 px-4 align-top">
                      <div className="space-y-1.5">
                        {esPendiente ? (
                          <div className="space-y-2">
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-extrabold bg-amber-100 text-amber-900 border border-amber-300">
                              <Clock className="w-3 h-3 text-amber-600 animate-pulse" />
                              <span>Pendiente</span>
                            </span>
                            <button
                              type="button"
                              onClick={() => handleAprobar(item, true)}
                              className="w-full px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-[11px] rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
                              title="Aprobar y enviar código de acceso por WhatsApp y Email"
                            >
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>Aceptar y Enviar</span>
                            </button>
                          </div>
                        ) : (
                          <div className="space-y-1">
                            <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-100 text-emerald-900 border border-emerald-200">
                              <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                              <span>Aprobado</span>
                            </span>
                            <p className="text-[10px] text-slate-400">
                              {item.fechaAprobacion || item.fechaInscripcion}
                            </p>
                          </div>
                        )}
                        <span className="text-[10px] font-mono text-slate-400 block">
                          ID: {item.id}
                        </span>
                      </div>
                    </td>

                    {/* Alumno & Curso */}
                    <td className="py-3.5 px-4 align-top">
                      <div>
                        <h4 className="font-extrabold text-sm text-slate-900">
                          {item.alumnoNombre} {item.alumnoApellido}
                        </h4>
                        <p className="text-xs text-slate-600 font-medium mt-0.5">
                          {item.grado} · Div. {item.division} · Turno {item.turno}
                        </p>
                        <p className="text-[11px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <School className="w-3 h-3 text-slate-400" />
                          <span>{item.colegioNombre}</span>
                        </p>
                        <span className="text-[10px] text-slate-400 block mt-1">
                          Inscripto: {item.fechaInscripcion}
                        </span>
                      </div>
                    </td>

                    {/* Tutor & Contacts */}
                    <td className="py-3.5 px-4 align-top">
                      <div className="space-y-1">
                        <p className="font-bold text-slate-900">{item.padreNombre}</p>
                        <div className="flex items-center gap-1.5 text-slate-600 text-xs font-mono">
                          <MessageCircle className="w-3.5 h-3.5 text-[#25D366] shrink-0" />
                          <span>{item.telefonoWhatsApp}</span>
                        </div>
                        <div className="flex items-center gap-1.5 text-slate-600 text-xs">
                          <Mail className="w-3.5 h-3.5 text-blue-500 shrink-0" />
                          <span className="break-all">{item.email}</span>
                        </div>
                      </div>
                    </td>

                    {/* Course Code Assigned */}
                    <td className="py-3.5 px-4 align-top">
                      {esPendiente ? (
                        <div className="space-y-1">
                          <span className="text-[10px] text-amber-800 font-semibold uppercase tracking-wider block">
                            Código a Asignar:
                          </span>
                          <input
                            type="text"
                            value={codigoSugerido}
                            onChange={(e) =>
                              setCodigosEditables((prev) => ({
                                ...prev,
                                [item.id]: e.target.value.toUpperCase()
                              }))
                            }
                            className="px-2 py-1 text-xs font-mono font-bold uppercase tracking-wider bg-white border-2 border-amber-300 rounded-lg w-28 text-slate-900 focus:outline-hidden focus:ring-2 focus:ring-amber-500"
                          />
                          <span className="text-[10px] text-slate-400 block">
                            Sugerido por sala y turno
                          </span>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <div className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-slate-900 text-amber-300 font-mono font-extrabold text-xs shadow-2xs">
                            <Key className="w-3 h-3 text-amber-400" />
                            <span>{item.codigoAsignado}</span>
                          </div>
                          {onProbarCodigo && item.codigoAsignado && (
                            <button
                              type="button"
                              onClick={() => onProbarCodigo(item.codigoAsignado!)}
                              className="text-[10px] text-amber-700 hover:text-amber-900 hover:underline flex items-center gap-1 font-semibold cursor-pointer"
                            >
                              <Eye className="w-2.5 h-2.5" />
                              <span>Ver en Portal</span>
                            </button>
                          )}
                        </div>
                      )}
                    </td>

                    {/* Delivery channels state */}
                    <td className="py-3.5 px-4 align-top">
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              item.notificacionWhatsAppEnviada ? 'bg-emerald-500' : 'bg-slate-300'
                            }`}
                          />
                          <span
                            className={`font-semibold ${
                              item.notificacionWhatsAppEnviada
                                ? 'text-emerald-800'
                                : 'text-slate-400'
                            }`}
                          >
                            WhatsApp:{' '}
                            {item.notificacionWhatsAppEnviada ? 'Enviado ✓' : 'Pendiente'}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-xs">
                          <span
                            className={`w-2 h-2 rounded-full ${
                              item.notificacionEmailEnviada ? 'bg-blue-500' : 'bg-slate-300'
                            }`}
                          />
                          <span
                            className={`font-semibold ${
                              item.notificacionEmailEnviada ? 'text-blue-800' : 'text-slate-400'
                            }`}
                          >
                            Email:{' '}
                            {item.notificacionEmailEnviada ? 'Despachado ✓' : 'Pendiente'}
                          </span>
                        </div>
                      </div>
                    </td>

                    {/* Action Buttons */}
                    <td className="py-3.5 px-4 align-top text-right">
                      <div className="flex flex-col items-end gap-1.5">
                        {esPendiente ? (
                          <button
                            type="button"
                            onClick={() => handleAprobar(item, true)}
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs transition-colors flex items-center gap-1 cursor-pointer"
                          >
                            <Check className="w-3 h-3" />
                            <span>Aceptar</span>
                          </button>
                        ) : (
                          <>
                            <a
                              href={generarEnlaceWhatsAppAprobacion(
                                item,
                                item.codigoAsignado || 'SALA3TM'
                              )}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="px-2.5 py-1 bg-[#25D366]/15 hover:bg-[#25D366]/25 text-[#128C7E] font-bold text-[11px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                              title="Reenviar mensaje por WhatsApp"
                            >
                              <MessageCircle className="w-3 h-3 fill-current" />
                              <span>Reenviar WhatsApp</span>
                            </a>

                            <button
                              type="button"
                              onClick={() => {
                                const codigo = item.codigoAsignado || 'SALA3TM';
                                setDetalleEnvioModal({
                                  familia: item,
                                  codigo,
                                  emailData: simularEnvioEmailAprobacion(item, codigo),
                                  whatsappMsg: generarMensajeWhatsAppAprobacion(item, codigo),
                                  whatsappUrl: generarEnlaceWhatsAppAprobacion(item, codigo)
                                });
                              }}
                              className="px-2.5 py-1 bg-blue-50 hover:bg-blue-100 text-blue-700 font-bold text-[11px] rounded-lg transition-colors flex items-center gap-1 cursor-pointer"
                            >
                              <Mail className="w-3 h-3" />
                              <span>Ver Email Enviado</span>
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {/* MODAL: Dispatch Details (WhatsApp & Email dispatched view) */}
      {detalleEnvioModal && (
        <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-2xl border border-slate-200 text-left animate-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center">
                  <CheckCircle2 className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-bold text-slate-900 font-['Outfit']">
                    Aprobación & Código Despachado
                  </h3>
                  <p className="text-xs text-slate-500">
                    Familia de {detalleEnvioModal.familia.alumnoNombre}{' '}
                    {detalleEnvioModal.familia.alumnoApellido}
                  </p>
                </div>
              </div>
              <button
                onClick={() => setDetalleEnvioModal(null)}
                className="p-2 text-slate-400 hover:text-slate-700 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Code Highlight */}
            <div className="p-4 bg-linear-to-r from-amber-500/10 via-amber-100/60 to-white rounded-xl border border-amber-300 flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wider block">
                  Código de Curso Desbloqueado
                </span>
                <span className="text-2xl font-mono font-black text-slate-950 tracking-wider">
                  {detalleEnvioModal.codigo}
                </span>
                <span className="text-xs text-slate-600 block mt-0.5">
                  Asignado para {detalleEnvioModal.familia.grado} (
                  {detalleEnvioModal.familia.turno})
                </span>
              </div>
              <button
                type="button"
                onClick={() => {
                  navigator.clipboard.writeText(detalleEnvioModal.codigo);
                  setToastNotificacion({
                    titulo: 'Código copiado',
                    mensaje: `Código ${detalleEnvioModal.codigo} copiado al portapapeles.`,
                    tipo: 'info'
                  });
                }}
                className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-amber-300 text-xs font-bold rounded-lg flex items-center gap-1 cursor-pointer"
              >
                <Copy className="w-3.5 h-3.5" />
                <span>Copiar</span>
              </button>
            </div>

            {/* Canal 1: WhatsApp */}
            <div className="space-y-2 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageCircle className="w-4 h-4 text-[#25D366] fill-current" />
                  <span>Mensaje de WhatsApp ({detalleEnvioModal.familia.telefonoWhatsApp})</span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800">
                  Listo para Enviar
                </span>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs font-mono whitespace-pre-line text-slate-700 max-h-32 overflow-y-auto">
                {detalleEnvioModal.whatsappMsg}
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <a
                  href={detalleEnvioModal.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3.5 py-2 bg-[#25D366] hover:bg-[#20ba5a] text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 cursor-pointer"
                >
                  <MessageCircle className="w-3.5 h-3.5 fill-white" />
                  <span>Abrir Chat de WhatsApp con la Familia</span>
                </a>
              </div>
            </div>

            {/* Canal 2: Email */}
            <div className="space-y-2 border border-slate-200 rounded-xl p-4 bg-slate-50/50">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-blue-600" />
                  <span>Correo Electrónico ({detalleEnvioModal.familia.email})</span>
                </span>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800">
                  Despachado
                </span>
              </div>
              <div className="p-3 bg-white border border-slate-200 rounded-lg text-xs space-y-1">
                <p className="font-bold text-slate-800">
                  Asunto: {detalleEnvioModal.emailData.asunto}
                </p>
                <div className="pt-2 border-t border-slate-100 whitespace-pre-line text-slate-600 font-mono text-[11px] max-h-36 overflow-y-auto">
                  {detalleEnvioModal.emailData.contenido}
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setDetalleEnvioModal(null)}
                className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl"
              >
                Cerrar Ventana
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
