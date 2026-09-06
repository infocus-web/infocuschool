import React, { useState } from 'react';
import {
  X,
  UserPlus,
  LogIn,
  CheckCircle2,
  ShieldCheck,
  ArrowRight,
  Phone,
  Mail,
  User,
  GraduationCap,
  Clock,
  School,
  AlertCircle,
  MessageCircle,
  Key,
  Copy,
  Check,
  UserCheck,
  Users,
  Trash2,
  Plus,
  RefreshCw,
  Loader2
} from 'lucide-react';
import {
  InscripcionFamilia,
  AlumnoHermano,
  validarEInscribirFamilia,
  buscarMiInscripcion,
  guardarFamiliaActiva,
  obtenerFamiliaActiva
} from '../services/inscripcionesService';
import { useColegiosLista, COLEGIO_POR_DEFECTO } from '../services/colegiosService';
import { useWhatsAppConfig } from '../services/configuracionService';

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
  const [paso, setPaso] = useState<'formulario' | 'resultado'>('formulario');
  const [familiaCreada, setFamiliaCreada] = useState<InscripcionFamilia | null>(null);
  const [enviandoRegistro, setEnviandoRegistro] = useState(false);

  // Form states for New Inscription
  const [padreNombre, setPadreNombre] = useState('');
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState('');
  const [email, setEmail] = useState('');
  const [alumnoNombre, setAlumnoNombre] = useState('');
  const [alumnoApellido, setAlumnoApellido] = useState('');
  const [turno, setTurno] = useState('Tarde');
  const [grado, setGrado] = useState('Sala 5 años');
  const [division, setDivision] = useState('A');
  const { colegios } = useColegiosLista();
  const { config: configWhatsApp } = useWhatsAppConfig();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || 'col-divino-pastor-2026');

  // Sibling states (1 access code for all children)
  const [hermanos, setHermanos] = useState<
    Array<{
      id: string;
      alumnoNombre: string;
      alumnoApellido: string;
      turno: string;
      grado: string;
      division: string;
    }>
  >([]);
  const [solicitaFotoHermanos, setSolicitaFotoHermanos] = useState(true);

  const handleAgregarHermano = () => {
    setHermanos((prev) => [
      ...prev,
      {
        id: `hermano-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        alumnoNombre: '',
        alumnoApellido: alumnoApellido.trim() || '',
        turno: turno || turnosDisponibles[0] || 'Mañana',
        grado: gradosDisponibles[0] || 'Sala 4 años',
        division: divisionesDisponibles[0] || 'A'
      }
    ]);
  };

  const handleActualizarHermano = (
    id: string,
    campo: 'alumnoNombre' | 'alumnoApellido' | 'turno' | 'grado' | 'division',
    valor: string
  ) => {
    setHermanos((prev) =>
      prev.map((h) => (h.id === id ? { ...h, [campo]: valor } : h))
    );
  };

  const handleEliminarHermano = (id: string) => {
    setHermanos((prev) => prev.filter((h) => h.id !== id));
  };

  const selectedColegio = colegios.find((c) => c.id === colegioId) || colegios[0];
  const whatsappDestino = selectedColegio?.whatsappContacto || configWhatsApp.whatsappSolicitudCodigo || '5491128625916';

  const divisionesDisponibles = selectedColegio?.divisiones && selectedColegio.divisiones.length > 0
    ? selectedColegio.divisiones
    : ['A', 'B', 'C', 'Jornada Extendida'];

  const turnosDisponibles = selectedColegio?.turnos && selectedColegio.turnos.length > 0
    ? selectedColegio.turnos
    : ['Mañana', 'Tarde', 'Jornada Extendida'];

  const gradosDisponibles = selectedColegio?.grados && selectedColegio.grados.length > 0
    ? selectedColegio.grados
    : [
        'Sala 3 años', 'Sala 4 años', 'Sala 5 años',
        '1° Grado', '2° Grado', '3° Grado', '4° Grado', '5° Grado', '6° Grado', '7° Grado',
      ];

  React.useEffect(() => {
    if (colegios.length > 0 && (!colegioId || !colegios.some((c) => c.id === colegioId))) {
      setColegioId(colegios[0].id);
    }
  }, [colegios, colegioId]);

  React.useEffect(() => {
    if (!division || !divisionesDisponibles.includes(division)) {
      setDivision(divisionesDisponibles[0] || 'A');
    }
  }, [divisionesDisponibles, division]);

  React.useEffect(() => {
    if (!turno || !turnosDisponibles.includes(turno)) {
      setTurno(turnosDisponibles[0] || 'Mañana');
    }
  }, [turnosDisponibles, turno]);

  React.useEffect(() => {
    if (!grado || !gradosDisponibles.includes(grado)) {
      setGrado(gradosDisponibles[0] || 'Sala 3 años');
    }
  }, [gradosDisponibles, grado]);

  const handleCambioTurno = (nuevoTurno: string) => {
    setTurno(nuevoTurno);
    if (nuevoTurno === 'Mañana') {
      setDivision('A');
    } else if (nuevoTurno === 'Tarde') {
      if (division !== 'B' && division !== 'C') {
        setDivision('B');
      }
    } else if (nuevoTurno.toLowerCase().includes('jornada') || nuevoTurno.toLowerCase().includes('extendida')) {
      setDivision('Jornada Extendida');
    }
  };

  const [mensajeCopiado, setMensajeCopiado] = useState(false);

  // Login states
  const [loginQuery, setLoginQuery] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [verificandoLogin, setVerificandoLogin] = useState(false);

  // Refresh pending status
  const [verificandoEstado, setVerificandoEstado] = useState(false);

  // Form errors
  const [formError, setFormError] = useState<string | null>(null);

  if (!isOpen) return null;

  const colegioSeleccionado = colegios.find((c) => c.id === colegioId) || colegios[0] || COLEGIO_POR_DEFECTO;

  const handleRegistroSubmit = async (e: React.FormEvent) => {
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

    const hermanosValidados: AlumnoHermano[] = hermanos
      .filter((h) => h.alumnoNombre.trim())
      .map((h) => ({
        id: h.id,
        alumnoNombre: h.alumnoNombre.trim(),
        alumnoApellido: h.alumnoApellido.trim() || alumnoApellido.trim(),
        grado: h.grado,
        division: h.division,
        turno: h.turno,
        colegioId: colegioSeleccionado.id,
        colegioNombre: colegioSeleccionado.nombre
      }));

    setEnviandoRegistro(true);
    const resultado = await validarEInscribirFamilia({
      colegioId: colegioSeleccionado.id,
      colegioNombre: colegioSeleccionado.nombre,
      padreNombre: padreNombre.trim(),
      telefonoWhatsApp: telefonoWhatsApp.trim(),
      email: email.trim(),
      alumnoNombre: alumnoNombre.trim(),
      alumnoApellido: alumnoApellido.trim(),
      turno,
      grado,
      division,
      hermanos: hermanosValidados,
      solicitaFotoHermanos: hermanosValidados.length > 0 ? solicitaFotoHermanos : false
    });
    setEnviandoRegistro(false);

    if (!resultado.success || !resultado.inscripcion) {
      setFormError(resultado.error || 'No pudimos registrar la inscripción. Intentá nuevamente.');
      return;
    }

    setFamiliaCreada(resultado.inscripcion);
    setPaso('resultado');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!loginQuery.trim()) {
      setLoginError('Ingresá tu código de acceso, teléfono o correo para ingresar.');
      return;
    }

    setVerificandoLogin(true);
    const encontrada = await buscarMiInscripcion(loginQuery);
    setVerificandoLogin(false);

    if (encontrada) {
      guardarFamiliaActiva(encontrada);
      setFamiliaCreada(encontrada);
      setPaso('resultado');
    } else {
      setLoginError('No encontramos una inscripción con ese código, teléfono o correo. Verificá los datos o completá la pestaña "Inscribirme".');
    }
  };

  const handleVerificarEstado = async () => {
    if (!familiaCreada) return;
    setVerificandoEstado(true);
    const query = familiaCreada.email || familiaCreada.telefonoWhatsApp;
    const actualizada = await buscarMiInscripcion(query);
    setVerificandoEstado(false);
    if (actualizada) {
      setFamiliaCreada(actualizada);
      guardarFamiliaActiva(actualizada);
    }
  };

  // Display helpers (reflect either the confirmed registration or the in-progress form)
  const alumnoDisplay = familiaCreada
    ? `${familiaCreada.alumnoNombre} ${familiaCreada.alumnoApellido}`
    : `${alumnoNombre} ${alumnoApellido}`;
  const gradoDisplay = familiaCreada ? familiaCreada.grado : grado;
  const divisionDisplay = familiaCreada ? familiaCreada.division : division;
  const turnoDisplay = familiaCreada ? familiaCreada.turno : turno;
  const tutorDisplay = familiaCreada ? familiaCreada.padreNombre : padreNombre;
  const colegioDisplay = familiaCreada ? familiaCreada.colegioNombre : colegioSeleccionado.nombre;

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
              {paso === 'resultado' ? (
                <Key className="w-6 h-6 stroke-[2.2]" />
              ) : (
                <UserPlus className="w-6 h-6 stroke-[2.2]" />
              )}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-xl font-extrabold font-['Outfit'] tracking-tight">
                  {paso === 'resultado'
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
                {paso === 'resultado'
                  ? familiaCreada?.estado === 'aceptado'
                    ? 'Tu inscripción fue confirmada. Código despachado por WhatsApp y Email.'
                    : 'Tu inscripción quedó pendiente de validación por el equipo fotográfico.'
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
        {paso === 'resultado' ? (
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
                  : 'Validación en curso'}
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
          {paso === 'resultado' ? (
            /* Step: Result of validation against the authorized parent list */
            <div className="space-y-6 text-left">
              {/* Registration confirmation banner */}
              <div className="p-4 bg-gradient-to-r from-emerald-500/10 via-emerald-50 to-amber-50 border border-emerald-300 rounded-2xl flex items-start gap-3.5">
                <div className="w-10 h-10 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/20">
                  <CheckCircle2 className="w-6 h-6" />
                </div>
                <div className="space-y-1">
                  <div className="flex items-center gap-2">
                    <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                      Inscripción Familiar Registrada
                    </span>
                    <span className="text-xs text-slate-500 font-medium">1 Código para toda la familia</span>
                  </div>
                  <h3 className="text-base sm:text-lg font-extrabold text-slate-900 mt-1">
                    ¡Hola {tutorDisplay}! Registramos a tu familia
                  </h3>
                  <div className="text-xs text-slate-700 space-y-0.5">
                    <p className="font-semibold text-slate-800">
                      • {alumnoDisplay} ({gradoDisplay} "{divisionDisplay}" · Turno {turnoDisplay})
                    </p>
                    {familiaCreada?.hermanos && familiaCreada.hermanos.length > 0 && (
                      familiaCreada.hermanos.map((h, i) => (
                        <p key={h.id || i} className="font-semibold text-slate-800">
                          • {h.alumnoNombre} {h.alumnoApellido} ({h.grado} "{h.division}" · Turno {h.turno})
                        </p>
                      ))
                    )}
                    {familiaCreada?.solicitaFotoHermanos && (
                      <span className="inline-block mt-1 text-[11px] font-bold text-amber-800 bg-amber-100/80 px-2 py-0.5 rounded-md border border-amber-200">
                        📸 Foto especial de hermanos juntos: Solicitada
                      </span>
                    )}
                  </div>
                </div>
              </div>

              {/* Adaptive Card: Auto-approved (matched authorized parent list) vs Pending manual review */}
              {familiaCreada?.estado === 'aceptado' ? (
                <div className="bg-gradient-to-b from-emerald-50 via-white to-emerald-50/50 border-2 border-emerald-400 rounded-3xl p-5 sm:p-6 space-y-4 shadow-sm">
                  <div className="flex items-start gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                          Inscripción Aprobada
                        </span>
                        <span className="text-xs text-emerald-800 font-semibold">Código de Acceso Habilitado</span>
                      </div>
                      <h4 className="text-lg font-black text-slate-900 font-['Outfit']">
                        ¡Tu Código de Acceso ya está activo!
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                        Verificamos tus datos contra el padrón del colegio. Te despachamos tu <strong>Código de Acceso</strong> por WhatsApp al <strong>{familiaCreada.telefonoWhatsApp}</strong> y por correo a <strong>{familiaCreada.email}</strong>.
                      </p>
                    </div>
                  </div>

                  {/* Highlighted Code Box */}
                  <div className="p-4 bg-emerald-500/10 border-2 border-emerald-300 rounded-2xl flex flex-col sm:flex-row items-center justify-between gap-3">
                    <div>
                      <span className="text-[10px] uppercase tracking-wider font-extrabold text-emerald-900 block">
                        Tu Código de Acceso para todos tus hijos:
                      </span>
                      <span className="text-2xl sm:text-3xl font-black font-mono tracking-widest text-emerald-950">
                        {familiaCreada.codigoAsignado || familiaCreada.codigoFamiliar}
                      </span>
                      <span className="text-[11px] text-emerald-800 font-medium block mt-0.5">
                        Acceso unificado para todos tus hijos en {colegioDisplay}
                      </span>
                    </div>
                    <div className="flex items-center gap-2 w-full sm:w-auto">
                      <button
                        type="button"
                        onClick={() => {
                          const code = familiaCreada.codigoAsignado || familiaCreada.codigoFamiliar;
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
                          const code = familiaCreada.codigoAsignado || familiaCreada.codigoFamiliar;
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
                          Pendiente de validación
                        </span>
                      </div>
                      <h4 className="text-base sm:text-lg font-black text-slate-900 font-['Outfit']">
                        Tu solicitud está en revisión
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                        No encontramos automáticamente tus datos en el padrón del colegio, así que tu solicitud quedó pendiente de revisión manual por el equipo fotográfico. En cuanto sea validada, vas a recibir tu <strong>Código de Acceso</strong> por WhatsApp y por Email.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
                    <div className="p-3 bg-emerald-50/80 border border-emerald-200 rounded-2xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500 text-white flex items-center justify-center shrink-0">
                        <Phone className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <span className="text-[10px] font-bold text-emerald-900 uppercase block">Te avisaremos por WhatsApp:</span>
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
                        <span className="text-[10px] font-bold text-sky-900 uppercase block">Y por Email:</span>
                        <span className="text-xs font-black text-slate-900 truncate block">
                          {familiaCreada?.email || email}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="pt-2 flex flex-col sm:flex-row gap-2.5">
                    <button
                      type="button"
                      onClick={handleVerificarEstado}
                      disabled={verificandoEstado}
                      className="flex-1 py-3 px-4 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-amber-300 hover:text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                    >
                      {verificandoEstado ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <RefreshCw className="w-4 h-4" />
                      )}
                      <span>Verificar si ya fue aprobada</span>
                    </button>
                    <a
                      href={`https://wa.me/${whatsappDestino}?text=${encodeURIComponent(
                        `Hola, completé la inscripción para las fotos de ${alumnoDisplay} (${gradoDisplay} "${divisionDisplay}", Turno ${turnoDisplay}, ${colegioDisplay}). ¿Podrían confirmarme si mi inscripción ya fue validada? ¡Muchas gracias!`
                      )}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 py-3 px-4 bg-[#25D366] hover:bg-[#20ba5a] text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                    >
                      <MessageCircle className="w-4 h-4 fill-white" />
                      <span>Consultar por WhatsApp</span>
                    </a>
                  </div>
                </div>
              )}

              {/* Bottom navigation actions */}
              <div className="pt-2 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPaso('formulario')}
                  className="text-slate-500 hover:text-slate-800 underline font-medium cursor-pointer"
                >
                  ← Modificar datos de inscripción
                </button>

                {familiaCreada?.estado !== 'aceptado' && (
                  <button
                    type="button"
                    onClick={() => {
                      setPaso('formulario');
                      setTab('login');
                      setLoginQuery(familiaCreada?.email || familiaCreada?.telefonoWhatsApp || '');
                    }}
                    className="text-amber-800 hover:text-amber-950 font-bold underline cursor-pointer"
                  >
                    Ya tengo mi código, ingresar ahora →
                  </button>
                )}
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
                      <p className="text-[10px] text-slate-500 mt-1">
                        Usá el mismo número que el colegio tiene registrado, así te reconocemos automáticamente.
                      </p>
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
                      <p className="text-[10px] text-slate-500 mt-1">
                        Usá el mismo correo que el colegio tiene registrado.
                      </p>
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
                    <label className="block text-xs font-bold text-slate-700 mb-1 flex items-center justify-between">
                      <span className="flex items-center gap-1">
                        <School className="w-3.5 h-3.5 text-slate-500" />
                        <span>Colegio o Institución</span>
                      </span>
                      <span className="text-[11px] font-medium text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                        Colegio asignado
                      </span>
                    </label>
                    <select
                      value={colegioId}
                      onChange={(e) => setColegioId(e.target.value)}
                      className="w-full px-3.5 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold text-slate-800"
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
                        onChange={(e) => handleCambioTurno(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-800"
                      >
                        {turnosDisponibles.map((t) => (
                          <option key={t} value={t}>{t}</option>
                        ))}
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
                        {gradosDisponibles.map((g) => (
                          <option key={g} value={g}>{g}</option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        División asignada <span className="text-red-500">*</span>
                      </label>
                      <select
                        value={division}
                        onChange={(e) => setDivision(e.target.value)}
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold text-slate-800"
                      >
                        {divisionesDisponibles.map((div) => (
                          <option key={div} value={div}>
                            {div.toLowerCase().includes('extendida') || div.toLowerCase().includes('jornada')
                              ? div
                              : `División ${div}`}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              {/* Sibling Section / Múltiples Hijos (Un solo código de acceso) */}
              <div className="bg-white p-5 rounded-2xl border-2 border-amber-200/90 space-y-4 text-left shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-amber-100 pb-3">
                  <div>
                    <h4 className="text-xs font-bold text-slate-800 uppercase tracking-wider flex items-center gap-1.5">
                      <Users className="w-4 h-4 text-amber-600" />
                      <span>Hermanos en la Institución</span>
                    </h4>
                    <p className="text-[11px] text-slate-500 mt-0.5">
                      ¿Tenés más de un hijo en el colegio? Agregalos aquí para recibir <strong>un único código de acceso</strong> y acceder a todos juntos.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={handleAgregarHermano}
                    className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-xs transition-all flex items-center gap-1.5 cursor-pointer shrink-0 active:scale-98"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>+ Agregar Hermano/a</span>
                  </button>
                </div>

                {hermanos.length === 0 ? (
                  <div className="p-3.5 bg-amber-50/50 rounded-xl border border-dashed border-amber-300 flex items-center justify-between gap-3 text-xs text-amber-900">
                    <span className="text-[11px] text-slate-600">
                      Si tenés otro hijo/a en otra sala, grado o turno, hacé clic en <strong>+ Agregar Hermano/a</strong>.
                    </span>
                    <button
                      type="button"
                      onClick={handleAgregarHermano}
                      className="text-xs font-extrabold text-amber-700 hover:text-amber-900 underline shrink-0 cursor-pointer"
                    >
                      Agregar ahora
                    </button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {hermanos.map((hermano, idx) => (
                      <div
                        key={hermano.id}
                        className="p-4 bg-slate-50 border border-slate-300 rounded-2xl space-y-3 relative text-left"
                      >
                        <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                          <span className="text-xs font-extrabold text-slate-800 flex items-center gap-2">
                            <span className="w-5 h-5 rounded-full bg-amber-400 text-slate-950 font-black text-[11px] flex items-center justify-center">
                              {idx + 2}
                            </span>
                            <span>Hermano/a #{idx + 1}</span>
                          </span>
                          <button
                            type="button"
                            onClick={() => handleEliminarHermano(hermano.id)}
                            className="text-slate-400 hover:text-red-600 text-xs flex items-center gap-1 cursor-pointer transition-colors"
                            title="Quitar este hermano"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>Quitar</span>
                          </button>
                        </div>

                        {/* Nombre y Apellido Hermano */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                              Nombre <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={hermano.alumnoNombre}
                              onChange={(e) =>
                                handleActualizarHermano(hermano.id, 'alumnoNombre', e.target.value)
                              }
                              placeholder="Ej: Sofía"
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-slate-700 mb-1">
                              Apellido <span className="text-red-500">*</span>
                            </label>
                            <input
                              type="text"
                              value={hermano.alumnoApellido}
                              onChange={(e) =>
                                handleActualizarHermano(hermano.id, 'alumnoApellido', e.target.value)
                              }
                              placeholder="Ej: Gómez"
                              className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                            />
                          </div>
                        </div>

                        {/* Turno, Grado, División Hermano */}
                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Turno
                            </label>
                            <select
                              value={hermano.turno}
                              onChange={(e) =>
                                handleActualizarHermano(hermano.id, 'turno', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                            >
                              {turnosDisponibles.map((t) => (
                                <option key={t} value={t}>{t}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              Grado / Sala
                            </label>
                            <select
                              value={hermano.grado}
                              onChange={(e) =>
                                handleActualizarHermano(hermano.id, 'grado', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                            >
                              {gradosDisponibles.map((g) => (
                                <option key={g} value={g}>{g}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="block text-[11px] font-bold text-slate-700 mb-1">
                              División
                            </label>
                            <select
                              value={hermano.division}
                              onChange={(e) =>
                                handleActualizarHermano(hermano.id, 'division', e.target.value)
                              }
                              className="w-full px-2.5 py-1.5 text-xs bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-semibold"
                            >
                              {divisionesDisponibles.map((div) => (
                                <option key={div} value={div}>
                                  {div.toLowerCase().includes('extendida') || div.toLowerCase().includes('jornada')
                                    ? div
                                    : `División ${div}`}
                                </option>
                              ))}
                            </select>
                          </div>
                        </div>
                      </div>
                    ))}

                    {/* Checkbox Foto Hermanos */}
                    <div className="p-3.5 bg-amber-50/80 border border-amber-300 rounded-xl flex items-center gap-3">
                      <input
                        type="checkbox"
                        id="chk-foto-hermanos"
                        checked={solicitaFotoHermanos}
                        onChange={(e) => setSolicitaFotoHermanos(e.target.checked)}
                        className="w-4 h-4 rounded text-amber-600 focus:ring-amber-500 cursor-pointer shrink-0"
                      />
                      <label
                        htmlFor="chk-foto-hermanos"
                        className="text-xs text-amber-950 font-semibold cursor-pointer select-none leading-tight"
                      >
                        📸 Deseamos la toma especial de <strong>Foto de Hermanos juntos</strong> durante la sesión fotográfica escolar
                      </label>
                    </div>
                  </div>
                )}
              </div>

              {/* Security Privacy Notice */}
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-500 text-[11px] leading-relaxed">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <span>
                  <strong>Privacidad y Seguridad:</strong> Tus datos se almacenan de forma segura y confidencial, y se validan contra el padrón autorizado por el colegio. Cada familia accede únicamente al espacio y pedidos de sus propios hijos.
                </span>
              </div>

              {/* Submit CTA */}
              <button
                type="submit"
                id="btn-confirmar-inscripcion"
                disabled={enviandoRegistro}
                className="w-full py-3.5 px-6 bg-gradient-to-r from-amber-400 via-amber-300 to-amber-400 hover:from-amber-300 hover:to-amber-200 disabled:opacity-60 text-slate-950 font-extrabold text-sm rounded-2xl shadow-lg shadow-amber-400/30 transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
              >
                {enviandoRegistro ? (
                  <Loader2 className="w-4 h-4 animate-spin" />
                ) : (
                  <>
                    <span>Completar Inscripción</span>
                    <ArrowRight className="w-4 h-4" />
                  </>
                )}
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
                    Ingresá tu Código de Acceso, WhatsApp o Correo registrado
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={loginQuery}
                      onChange={(e) => setLoginQuery(e.target.value)}
                      placeholder="11 2345-6789, tu-email@correo.com o tu código"
                      className="w-full px-4 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Si ya completaste la inscripción de tu hijo/a previamente, podés ingresar directamente con tu número, correo o código de acceso.
                  </p>

                  <button
                    type="submit"
                    disabled={verificandoLogin}
                    className="w-full py-3 px-6 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 text-white font-bold text-xs rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                  >
                    {verificandoLogin ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <>
                        <LogIn className="w-4 h-4" />
                        <span>Ingresar</span>
                      </>
                    )}
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
                      setPaso('resultado');
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
