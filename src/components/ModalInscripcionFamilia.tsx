import React, { useState } from 'react';
import {
  X,
  UserPlus,
  LogIn,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Sparkles,
  Phone,
  Mail,
  User,
  GraduationCap,
  Clock,
  School,
  AlertCircle,
  MessageCircle,
  Key,
  ExternalLink,
  Copy,
  Check,
  Send,
  UserCheck
} from 'lucide-react';
import {
  InscripcionFamilia,
  guardarInscripcion,
  buscarFamiliaPorContacto,
  guardarFamiliaActiva,
  obtenerFamiliaActiva,
  obtenerInscripciones,
  aprobarInscripcion,
  generarEnlaceWhatsAppAprobacion,
  generarMensajeWhatsAppAprobacion
} from '../services/inscripcionesService';
import { useColegiosLista, COLEGIO_POR_DEFECTO } from '../services/colegiosService';
import { useWhatsAppConfig } from '../services/configuracionService';
import { buscarSeccionPorCodigo } from '../data/codigosCursos';

interface ModalInscripcionFamiliaProps {
  isOpen: boolean;
  onClose: () => void;
  onInscripcionExitosa: (familia: InscripcionFamilia, codigoCurso?: string) => void;
}

export default function ModalInscripcionFamilia({
  isOpen,
  onClose,
  onInscripcionExitosa
}: ModalInscripcionFamiliaProps) {
  const [tab, setTab] = useState<'registro' | 'login'>('registro');
  const [paso, setPaso] = useState<'formulario' | 'solicitar_codigo'>('formulario');
  const [familiaCreada, setFamiliaCreada] = useState<InscripcionFamilia | null>(null);

  // Form states for New Inscription
  const [padreNombre, setPadreNombre] = useState('');
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState('');
  const [email, setEmail] = useState('');
  const [alumnoNombre, setAlumnoNombre] = useState('');
  const [alumnoApellido, setAlumnoApellido] = useState('');
  const [turno, setTurno] = useState('Tarde');
  const [grado, setGrado] = useState('Sala 5 años');
  const [division, setDivision] = useState('Celeste');
  const { colegios } = useColegiosLista();
  const { config: configWhatsApp } = useWhatsAppConfig();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || 'col-isba-2026');

  const selectedColegio = colegios.find((c) => c.id === colegioId);
  const whatsappDestino = selectedColegio?.whatsappContacto || configWhatsApp.whatsappSolicitudCodigo || '5491128625916';

  // Code verification states in Step "solicitar_codigo"
  const [codigoIngresado, setCodigoIngresado] = useState('');
  const [codigoValidado, setCodigoValidado] = useState<{ seccionNombre: string; codigoValido: string } | null>(null);
  const [codigoError, setCodigoError] = useState<string | null>(null);
  const [mensajeCopiado, setMensajeCopiado] = useState(false);

  // Login states
  const [loginQuery, setLoginQuery] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);

  // Form errors
  const [formError, setFormError] = useState<string | null>(null);

  // Auto-sync when photographer accepts in the admin panel
  React.useEffect(() => {
    const syncInscripcion = () => {
      if (familiaCreada) {
        const todas = obtenerInscripciones();
        const encontrada = todas.find((i) => i.id === familiaCreada.id);
        if (encontrada) {
          setFamiliaCreada(encontrada);
          if (encontrada.estado === 'aceptado' && encontrada.codigoAsignado) {
            setCodigoIngresado(encontrada.codigoAsignado);
            handleVerificarCodigo(encontrada.codigoAsignado);
          }
        }
      }
    };
    window.addEventListener('infocus_inscripciones_updated', syncInscripcion);
    return () => {
      window.removeEventListener('infocus_inscripciones_updated', syncInscripcion);
    };
  }, [familiaCreada]);

  if (!isOpen) return null;

  const colegioSeleccionado = colegios.find((c) => c.id === colegioId) || colegios[0] || COLEGIO_POR_DEFECTO;

  const handleRegistroSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    // Validations
    if (!padreNombre.trim()) {
      setFormError('Por favor ingresá el nombre y apellido del padre, madre o tutor.');
      return;
    }
    if (!telefonoWhatsApp.trim() || telefonoWhatsApp.trim().length < 8) {
      setFormError('Por favor ingresá un número de teléfono de WhatsApp válido.');
      return;
    }
    if (!email.trim() || !email.includes('@')) {
      setFormError('Por favor ingresá un correo electrónico válido.');
      return;
    }
    if (!alumnoNombre.trim()) {
      setFormError('Por favor ingresá el nombre del alumno/a.');
      return;
    }
    if (!alumnoApellido.trim()) {
      setFormError('Por favor ingresá el apellido del alumno/a.');
      return;
    }

    const nuevaFamilia = guardarInscripcion({
      padreNombre: padreNombre.trim(),
      telefonoWhatsApp: telefonoWhatsApp.trim(),
      email: email.trim(),
      alumnoNombre: alumnoNombre.trim(),
      alumnoApellido: alumnoApellido.trim(),
      turno,
      grado,
      division,
      colegioId: colegioSeleccionado.id,
      colegioNombre: colegioSeleccionado.nombre
    });

    setFamiliaCreada(nuevaFamilia);
    setPaso('solicitar_codigo');
  };

  const handleVerificarCodigo = (codigoAProbar?: string) => {
    const raw = codigoAProbar !== undefined ? codigoAProbar : codigoIngresado;
    const clean = raw.trim().toUpperCase();
    if (!clean) {
      setCodigoError('Ingresá el código de curso provisto por la institución.');
      setCodigoValidado(null);
      return;
    }

    // 1. Search in course sections (e.g. SALA3TM, SALA4A, SALA5B...)
    const match = buscarSeccionPorCodigo(clean);
    if (match) {
      setCodigoValidado({
        seccionNombre: match.seccion.nombreCompleto,
        codigoValido: match.codigoValido
      });
      setCodigoError(null);
      return;
    }

    // 2. Search general school code (e.g. ISBA2026, etc.)
    const colFound = colegios.find((c) => c.codigoAcceso.toUpperCase() === clean);
    if (colFound) {
      setCodigoValidado({
        seccionNombre: `${colFound.nombre} (${grado} "${division}")`,
        codigoValido: colFound.codigoAcceso
      });
      setCodigoError(null);
      return;
    }

    setCodigoError(`El código "${raw}" no fue encontrado. Verificá si está bien escrito o solicitalo a la institución por WhatsApp.`);
    setCodigoValidado(null);
  };

  const handleAccederConCodigo = () => {
    if (!familiaCreada) return;
    const cod = codigoValidado?.codigoValido || codigoIngresado.trim().toUpperCase();
    onInscripcionExitosa(familiaCreada, cod);
  };

  const handleLoginSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!loginQuery.trim()) {
      setLoginError('Ingresá tu teléfono o correo para buscar tu usuario.');
      return;
    }

    const encontrada = buscarFamiliaPorContacto(loginQuery);
    if (encontrada) {
      guardarFamiliaActiva(encontrada);
      setFamiliaCreada(encontrada);
      setPaso('solicitar_codigo');
    } else {
      setLoginError('No encontramos una inscripción con ese teléfono o correo. Verificá los datos o completá la pestaña "Inscribirme".');
    }
  };

  // Pre-configured WhatsApp message to request the course code
  const alumnoDisplay = familiaCreada
    ? `${familiaCreada.alumnoNombre} ${familiaCreada.alumnoApellido}`
    : `${alumnoNombre} ${alumnoApellido}`;
  const gradoDisplay = familiaCreada ? familiaCreada.grado : grado;
  const divisionDisplay = familiaCreada ? familiaCreada.division : division;
  const turnoDisplay = familiaCreada ? familiaCreada.turno : turno;
  const tutorDisplay = familiaCreada ? familiaCreada.padreNombre : padreNombre;
  const colegioDisplay = familiaCreada ? familiaCreada.colegioNombre : colegioSeleccionado.nombre;

  const mensajeWhatsApp = `Hola, me acabo de inscribir en el portal de fotos escolares para mi hijo/a ${alumnoDisplay} de ${gradoDisplay} (División ${divisionDisplay}, Turno ${turnoDisplay}) en ${colegioDisplay}. Soy ${tutorDisplay}. ¿Me podrían facilitar el código de curso para poder acceder a ver las fotos? ¡Muchas gracias!`;
  const urlWhatsApp = `https://wa.me/5491128625916?text=${encodeURIComponent(mensajeWhatsApp)}`;

  const handleCopiarMensaje = () => {
    navigator.clipboard.writeText(mensajeWhatsApp);
    setMensajeCopiado(true);
    setTimeout(() => setMensajeCopiado(false), 2500);
  };

  // Active family session on this browser
  const miFamiliaActiva = obtenerFamiliaActiva();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-3 sm:p-4 overflow-y-auto">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border border-slate-200 w-full max-w-2xl rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh] text-slate-900 animate-in fade-in zoom-in-95 duration-150 text-left"
      >
        {/* Header */}
        <div className="p-5 sm:p-6 bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white flex items-center justify-between border-b border-slate-800">
          <div className="flex items-center gap-3.5">
            <div className="w-11 h-11 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md shadow-amber-500/20 shrink-0">
              {paso === 'solicitar_codigo' ? (
                <Key className="w-6 h-6 stroke-[2.2]" />
              ) : (
                <UserPlus className="w-6 h-6 stroke-[2.2]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold font-['Outfit'] tracking-tight">
                  {paso === 'solicitar_codigo'
                    ? familiaCreada?.estado === 'aceptado'
                      ? 'Código de Acceso Disponible'
                      : 'Solicitud Registrada'
                    : 'Inscripción de Familias'}
                </h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-amber-400/20 text-amber-300 border border-amber-400/30">
                  Ciclo 2026
                </span>
              </div>
              <p className="text-xs text-slate-300 mt-0.5">
                {paso === 'solicitar_codigo'
                  ? familiaCreada?.estado === 'aceptado'
                    ? 'Tu inscripción fue confirmada. Código despachado por WhatsApp y Email.'
                    : 'Recibirás tu código de acceso a la brevedad por WhatsApp y correo electrónico.'
                  : 'Paso inicial para acceder a las fotos del curso de tu hijo/a'}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="w-8 h-8 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white flex items-center justify-center transition-colors cursor-pointer"
            aria-label="Cerrar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Switcher / Step indicator */}
        {paso === 'solicitar_codigo' ? (
          <div className="bg-amber-50/80 px-4 py-2.5 border-b border-amber-200/80 flex items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="w-5 h-5 rounded-full bg-emerald-500 text-white flex items-center justify-center text-[10px] font-bold">
                ✓
              </span>
              <span className="text-slate-600 font-medium hidden sm:inline">1. Registro asentado</span>
              <span className="text-slate-400">→</span>
              <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-extrabold ${
                familiaCreada?.estado === 'aceptado' ? 'bg-emerald-500 text-white' : 'bg-amber-500 text-slate-950'
              }`}>
                {familiaCreada?.estado === 'aceptado' ? '✓' : '2'}
              </span>
              <span className="font-extrabold text-amber-950">
                {familiaCreada?.estado === 'aceptado'
                  ? 'Código Confirmado'
                  : 'Validación y Envío de Código'}
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPaso('formulario')}
              className="text-[11px] font-semibold text-slate-600 hover:text-slate-900 underline cursor-pointer"
            >
              Editar datos
            </button>
          </div>
        ) : (
          <div className="bg-slate-100 p-2 border-b border-slate-200 flex gap-2">
            <button
              type="button"
              onClick={() => {
                setTab('registro');
                setFormError(null);
              }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                tab === 'registro'
                  ? 'bg-white text-slate-950 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <UserPlus className="w-4 h-4 text-amber-600" />
              <span>Inscribirme (Crear usuario)</span>
            </button>
            <button
              type="button"
              onClick={() => {
                setTab('login');
                setLoginError(null);
              }}
              className={`flex-1 py-2.5 px-4 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer ${
                tab === 'login'
                  ? 'bg-white text-slate-950 shadow-sm border border-slate-200/80'
                  : 'text-slate-600 hover:text-slate-900'
              }`}
            >
              <LogIn className="w-4 h-4 text-sky-600" />
              <span>Ya me inscribí (Ingresar)</span>
            </button>
          </div>
        )}

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-6">
          {paso === 'solicitar_codigo' ? (
            /* Step: Contact school via WhatsApp to get the course code */
            <div className="space-y-6 text-left">
              {/* Registration confirmation banner */}
              <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-emerald-50 to-amber-50 border border-emerald-300 rounded-2xl flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/20">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                      Inscripción Registrada
                    </span>
                    <span className="text-xs text-slate-500">Listo para el siguiente paso</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-1">
                    ¡Hola {tutorDisplay}! Registramos a {alumnoDisplay}
                  </h3>
                  <p className="text-xs text-slate-600 mt-0.5">
                    {gradoDisplay} "{divisionDisplay}" · Turno {turnoDisplay} · {colegioDisplay}
                  </p>
                </div>
              </div>

              {/* Adaptive Card: Web Photographer Registration Sheet & Approval */}
              {familiaCreada?.estado === 'aceptado' ? (
                <div className="bg-gradient-to-b from-emerald-50 via-white to-emerald-50/50 border-2 border-emerald-400 rounded-3xl p-5 sm:p-6 space-y-4 shadow-sm">
                  <div className="flex items-start gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                          Inscripción Confirmada
                        </span>
                        <span className="text-xs text-emerald-800 font-semibold">Código Despachado</span>
                      </div>
                      <h4 className="text-lg font-black text-slate-900 font-['Outfit']">
                        ¡Tu inscripción fue confirmada con éxito!
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                        Tu solicitud fue verificada y despachamos tu <strong>Código de Curso</strong> por WhatsApp al <strong>{familiaCreada.telefonoWhatsApp}</strong> y por correo a <strong>{familiaCreada.email}</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Highlighted Code Box */}
                  <div className="p-4 bg-emerald-500/10 border-2 border-emerald-300 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-900 block">
                        Tu Código de Curso para ver las fotos:
                      </span>
                      <span className="text-2xl sm:text-3xl font-black font-mono tracking-widest text-emerald-950">
                        {familiaCreada.codigoAsignado || 'SALA5B'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => {
                          const code = familiaCreada.codigoAsignado || 'SALA5B';
                          navigator.clipboard.writeText(code);
                          setMensajeCopiado(true);
                          setTimeout(() => setMensajeCopiado(false), 2000);
                        }}
                        className="px-3.5 py-2.5 bg-white hover:bg-emerald-100 text-emerald-900 border border-emerald-300 rounded-xl text-xs font-bold transition-colors flex items-center gap-1.5 cursor-pointer shadow-xs"
                      >
                        {mensajeCopiado ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                        <span>{mensajeCopiado ? 'Copiado' : 'Copiar código'}</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          const code = familiaCreada.codigoAsignado || 'SALA5B';
                          onInscripcionExitosa(familiaCreada, code);
                        }}
                        className="flex-1 sm:flex-initial px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <span>Ingresar a ver fotos</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-gradient-to-b from-amber-50/90 via-white to-amber-50/50 border-2 border-amber-400/90 rounded-3xl p-5 sm:p-6 space-y-4 shadow-sm">
                  <div className="flex items-start gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-amber-500 to-amber-400 text-slate-950 flex items-center justify-center shrink-0 shadow-md shadow-amber-500/20">
                      <UserCheck className="w-6 h-6 stroke-[2.2]" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-amber-500 text-slate-950">
                          Inscripción Recibida
                        </span>
                        <span className="text-xs text-amber-900 font-semibold flex items-center gap-1">
                          <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse"></span>
                          Pendiente de entrega de código
                        </span>
                      </div>
                      <h4 className="text-base sm:text-lg font-black text-slate-900 font-['Outfit']">
                        ¡Recibimos tus datos correctamente!
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                        Tu registro quedó completado. A la brevedad te enviaremos tu <strong>Código de Curso</strong> por WhatsApp y por Email para que puedas acceder de inmediato a la galería y pedidos de tu curso.
                      </p>
                    </div>
                  </div>

                  {/* Dispatch Channels Summary */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <span className="text-[10px] font-bold text-emerald-900 uppercase block">Envío por WhatsApp:</span>
                        <span className="text-xs font-black text-slate-900 truncate block">
                          {familiaCreada?.telefonoWhatsApp || telefonoWhatsApp}
                        </span>
                      </div>
                    </div>
                    <div className="p-3 bg-sky-50/80 border border-sky-200 rounded-2xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-sky-500 text-white flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <span className="text-[10px] font-bold text-sky-900 uppercase block">Envío por Email:</span>
                        <span className="text-xs font-black text-slate-900 truncate block">
                          {familiaCreada?.email || email}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Direct WhatsApp button to request course code */}
                  <div className="pt-2">
                    <a
                      href={`https://wa.me/${whatsappDestino}?text=${encodeURIComponent(
                        `Hola, completé la inscripción para las fotos de ${alumnoNombre.trim()} ${alumnoApellido.trim()} (${grado} "${division}", Turno ${turno}, ${selectedColegio?.nombre || 'Colegio'}). ¿Me podrían indicar el código de curso para poder acceder a ver las fotos? ¡Muchas gracias!`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="w-full py-3 px-4 bg-[#25D366] hover:bg-[#20ba5a] text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                    >
                      <MessageCircle className="w-4 h-4 fill-white" />
                      <span>Solicitar Código por WhatsApp ahora</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Enter course code received from school */}
              <div className="bg-slate-50 border border-slate-200 rounded-3xl p-5 sm:p-6 space-y-4">
                <div className="flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-amber-500" />
                  <h4 className="text-xs sm:text-sm font-extrabold text-slate-900 uppercase tracking-wide">
                    ¿Ya te respondieron con tu Código de Curso?
                  </h4>
                </div>
                <p className="text-xs text-slate-600">
                  Ingresá el código de curso que te entregaron para desbloquear la galería y ver las fotos de tu hijo/a:
                </p>

                <div className="flex flex-col sm:flex-row gap-2.5">
                  <div className="relative flex-1">
                    <input
                      type="text"
                      value={codigoIngresado}
                      onChange={(e) => {
                        setCodigoIngresado(e.target.value.toUpperCase());
                        setCodigoError(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleVerificarCodigo();
                        }
                      }}
                      placeholder="Ej: SALA3TM"
                      className="w-full px-4 py-3 text-sm uppercase font-mono font-extrabold tracking-wider bg-white border-2 border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleVerificarCodigo()}
                    className="px-6 py-3 bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white font-bold text-xs rounded-xl shadow-md transition-colors flex items-center justify-center gap-2 cursor-pointer shrink-0"
                  >
                    <Key className="w-4 h-4" />
                    <span>Validar Código</span>
                  </button>
                </div>

                {/* Code Error */}
                {codigoError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Código no reconocido</p>
                      <p className="mt-0.5">{codigoError}</p>
                    </div>
                  </div>
                )}

                {/* Code Validated Success */}
                {codigoValidado && (
                  <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-2xl flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-2.5">
                      <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-emerald-950">
                          ¡Código de curso reconocido: <span className="font-mono font-black">{codigoValidado.codigoValido}</span>!
                        </p>
                        <p className="text-[11px] text-emerald-800">
                          {codigoValidado.seccionNombre} · Galería lista para visualizar
                        </p>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={handleAccederConCodigo}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl shadow-md flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 shrink-0"
                    >
                      <span>Ver fotos de {familiaCreada?.alumnoNombre}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                )}
              </div>

              {/* Bottom navigation actions */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPaso('formulario')}
                  className="text-slate-500 hover:text-slate-800 underline font-medium cursor-pointer"
                >
                  ← Modificar datos de inscripción
                </button>

                <button
                  type="button"
                  onClick={() => {
                    if (familiaCreada) {
                      onInscripcionExitosa(familiaCreada, codigoValidado?.codigoValido);
                    }
                  }}
                  className="text-amber-800 hover:text-amber-950 font-bold underline cursor-pointer"
                >
                  Ingresar al portal para colocar el código luego →
                </button>
              </div>
            </div>
          ) : tab === 'registro' ? (
            <form onSubmit={handleRegistroSubmit} className="space-y-6">
              {/* Error Alert */}
              {formError && (
                <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                  <span>{formError}</span>
                </div>
              )}

              {/* Group 1: Tutor / Padre / Madre */}
              <div className="bg-amber-50/50 border border-amber-200/70 rounded-2xl p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-extrabold text-amber-950 uppercase tracking-wider">
                  <User className="w-4 h-4 text-amber-600" />
                  <span>1. Datos del Padre, Madre o Tutor</span>
                </div>

                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      Nombre y apellido del padre / madre <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={padreNombre}
                      onChange={(e) => setPadreNombre(e.target.value)}
                      placeholder="Ej: Mariana Gómez"
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Número de WhatsApp <span className="text-red-500">*</span></span>
                      </label>
                      <input
                        type="tel"
                        required
                        value={telefonoWhatsApp}
                        onChange={(e) => setTelefonoWhatsApp(e.target.value)}
                        placeholder="Ej: 11 5489-3210"
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <Mail className="w-3.5 h-3.5 text-sky-600" />
                        <span>Correo electrónico <span className="text-red-500">*</span></span>
                      </label>
                      <input
                        type="email"
                        required
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="Ej: mariana.gomez@gmail.com"
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Group 2: Alumno */}
              <div className="bg-sky-50/40 border border-sky-200/70 rounded-2xl p-4 sm:p-5 space-y-3.5">
                <div className="flex items-center gap-2 text-xs font-extrabold text-sky-950 uppercase tracking-wider">
                  <GraduationCap className="w-4 h-4 text-sky-600" />
                  <span>2. Datos del Alumno/a</span>
                </div>

                <div className="space-y-3">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Nombre del alumno/a <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={alumnoNombre}
                        onChange={(e) => setAlumnoNombre(e.target.value)}
                        placeholder="Ej: Benjamín"
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Apellido del alumno/a <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={alumnoApellido}
                        onChange={(e) => setAlumnoApellido(e.target.value)}
                        placeholder="Ej: Gómez"
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                      />
                    </div>
                  </div>

                  {/* Colegio */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                      <School className="w-3.5 h-3.5 text-slate-500" />
                      <span>Colegio o Institución</span>
                    </label>
                    <select
                      value={colegioId}
                      onChange={(e) => setColegioId(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-800"
                    >
                      {colegios.map((col) => (
                        <option key={col.id} value={col.id}>
                          {col.nombre} ({col.localidad})
                        </option>
                      ))}
                    </select>
                  </div>

                  {/* Turno, Grado, División */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Turno <span className="text-red-500">*</span></span>
                      </label>
                      <select
                        value={turno}
                        onChange={(e) => setTurno(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-800"
                      >
                        <option value="Tarde">Tarde</option>
                        <option value="Mañana">Mañana</option>
                        <option value="Jornada Completa">Jornada Completa</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        Grado / Sala <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={grado}
                        onChange={(e) => setGrado(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-800"
                      >
                        <option value="Sala 3 años">Sala 3 años</option>
                        <option value="Sala 4 años">Sala 4 años</option>
                        <option value="Sala 5 años">Sala 5 años</option>
                        <option value="1° Grado">1° Grado</option>
                        <option value="2° Grado">2° Grado</option>
                        <option value="3° Grado">3° Grado</option>
                        <option value="4° Grado">4° Grado</option>
                        <option value="5° Grado">5° Grado</option>
                        <option value="6° Grado">6° Grado</option>
                        <option value="7° Grado">7° Grado</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        División / Color <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={division}
                        onChange={(e) => setDivision(e.target.value)}
                        placeholder="Ej: Celeste, A, B..."
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Security Privacy Notice */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-[11px] leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Privacidad y Seguridad:</strong> Tus datos se almacenan de forma segura y confidencial. Cada familia accede únicamente al espacio y pedidos de sus propios hijos.
                </span>
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                id="btn-confirmar-inscripcion"
                className="w-full py-3.5 px-6 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 text-slate-950 font-extrabold text-sm rounded-2xl shadow-lg shadow-amber-400/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
              >
                <span>Completar Inscripción</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            </form>
          ) : (
            /* Tab: Ya me inscribí (Login) */
            <div className="space-y-6">
              <form onSubmit={handleLoginSubmit} className="space-y-4">
                {loginError && (
                  <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-red-500 shrink-0" />
                    <span>{loginError}</span>
                  </div>
                )}

                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-5 space-y-3">
                  <label className="block text-xs font-bold text-slate-700">
                    Ingresá tu WhatsApp o Correo registrado
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={loginQuery}
                      onChange={(e) => setLoginQuery(e.target.value)}
                      placeholder="11 2345-6789 o tu-email@correo.com"
                      className="w-full px-4 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Si ya completaste la inscripción de tu hijo/a previamente, podés ingresar directamente ingresando tu número o correo. Luego necesitarás tu código de curso para ver las fotos.
                  </p>

                  <button
                    type="submit"
                    className="w-full py-3 px-6 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    <LogIn className="w-4 h-4" />
                    <span>Ingresar y solicitar código</span>
                  </button>
                </div>
              </form>

              {/* Only show the current user's active session if already logged in on this browser */}
              {miFamiliaActiva && (
                <div className="space-y-2.5">
                  <h4 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                    Tu sesión guardada en este navegador:
                  </h4>
                  <div
                    onClick={() => {
                      setFamiliaCreada(miFamiliaActiva);
                      setPaso('solicitar_codigo');
                    }}
                    className="p-3.5 bg-amber-50/50 hover:bg-amber-100/60 border border-amber-200 hover:border-amber-300 rounded-xl transition-all flex items-center justify-between gap-3 cursor-pointer group shadow-xs"
                  >
                    <div className="flex items-center gap-3">
                      <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 font-bold flex items-center justify-center text-xs">
                        {miFamiliaActiva.alumnoNombre[0]}
                      </div>
                      <div>
                        <p className="text-xs font-extrabold text-slate-900">
                          {miFamiliaActiva.alumnoNombre} {miFamiliaActiva.alumnoApellido}
                        </p>
                        <p className="text-[11px] text-slate-600">
                          {miFamiliaActiva.grado} ({miFamiliaActiva.division}) · Turno {miFamiliaActiva.turno} · Tutor: {miFamiliaActiva.padreNombre}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-1 text-xs font-bold text-amber-900 group-hover:translate-x-0.5 transition-transform">
                      <span>Continuar</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer info */}
        <div className="p-4 bg-slate-50 border-t border-slate-200 text-center text-[11px] text-slate-500">
          ¿Tenés dudas o necesitás asistencia? Contactanos por{' '}
          <a
            href={`https://wa.me/${configWhatsApp.numeroTelefono}?text=Hola%20Retrato%20Escolar,%20necesito%20ayuda%20con%20la%20inscripción`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-emerald-600 font-bold hover:underline"
          >
            WhatsApp al {configWhatsApp.numeroFormateado}
          </a>
        </div>
      </div>
    </div>
  );
}
