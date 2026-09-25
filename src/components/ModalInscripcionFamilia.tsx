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
import { irAConsultasConDatos } from '../utils/consultaPrefill';
import { copiarAlPortapapeles } from '../utils/portapapeles';
import { sugerirCorreccionEmail } from '../utils/emailSugerencia';

// Deja sólo los dígitos del DNI (acepta que la familia lo escriba con puntos, ej: "38.456.789")
// y valida que tenga un largo razonable (los DNI argentinos tienen 7 u 8 dígitos).
const limpiarDni = (valor: string): string => valor.replace(/\D/g, '');
const dniEsValido = (valor: string): boolean => {
  const limpio = limpiarDni(valor);
  return limpio.length >= 6 && limpio.length <= 9;
};

interface ModalInscripcionFamiliaProps {
  isOpen: boolean;
  onClose: () => void;
  onInscripcionExitosa: (familia: InscripcionFamilia, codigoCurso?: string) => void;
  // Auditoría 2026-09-22 (pedido de Pablo, viendo la landing real: "este botón me envía al
  // formulario de inscripción también, al igual que el botón 'anotarme con mis hijos'"): el link
  // "¿Ya te inscribiste? Consultar código" de Hero.tsx llamaba al mismo `onOpenInscripcion` sin
  // parámetros que "Anotarme con mis hijos", y el modal siempre abría en la pestaña "Inscribirme"
  // — quien ya se había inscripto terminaba en el formulario de alta en vez de en la pestaña para
  // consultar su código. Con esto, quien lo abre puede pedir la pestaña "Ya me inscribí" directo.
  initialTab?: 'registro' | 'login';
}

export default function ModalInscripcionFamilia({
  isOpen,
  onClose,
  onInscripcionExitosa,
  initialTab
}: ModalInscripcionFamiliaProps) {
  const [tab, setTab] = useState<'registro' | 'login'>('registro');
  const [paso, setPaso] = useState<'formulario' | 'resultado'>('formulario');
  const [familiaCreada, setFamiliaCreada] = useState<InscripcionFamilia | null>(null);
  const [enviandoRegistro, setEnviandoRegistro] = useState(false);

  // Form states for New Inscription
  const [padreNombre, setPadreNombre] = useState('');
  // Auditoría 2026-09-22 (segunda ronda del mismo pedido de Pablo — el DNI del tutor se había
  // agregado sólo al ingreso posterior, no acá): se pide también al inscribirse, para que quede
  // cargado desde el primer momento y sirva de entrada directamente por DNI + código sin
  // depender de identificar por nombre la primera vez.
  const [padreDni, setPadreDni] = useState('');
  const [telefonoWhatsApp, setTelefonoWhatsApp] = useState('');
  const [email, setEmail] = useState('');
  const [alumnoNombre, setAlumnoNombre] = useState('');
  const [alumnoApellido, setAlumnoApellido] = useState('');
  const [alumnoDni, setAlumnoDni] = useState('');
  // Auditoría 2026-09-24 (bug real en datos de producción): el curso arrancaba preseleccionado
  // ("Tarde" / "Sala 5 años" / "A") y muchas familias lo enviaban sin cambiarlo — 1 de cada 3
  // inscripciones que figuran en la nómina quedó en una división que no era la suya (y con el
  // código de acceso de OTRO curso). Ahora arranca vacío y hay que elegirlo a propósito.
  const [turno, setTurno] = useState('');
  const [grado, setGrado] = useState('');
  const [division, setDivision] = useState('');
  const { colegios } = useColegiosLista();
  const { config: configWhatsApp } = useWhatsAppConfig();
  const [colegioId, setColegioId] = useState(() => colegios[0]?.id || 'col-divino-pastor-2026');

  // Sibling states (1 access code for all children)
  const [hermanos, setHermanos] = useState<
    Array<{
      id: string;
      alumnoNombre: string;
      alumnoApellido: string;
      alumnoDni: string;
      turno: string;
      grado: string;
      division: string;
    }>
  >([]);
  // Auditoría 2026-09-22 (pedido de Pablo, repaso de pantalla real: "por defecto debería estar
  // desactivada, es opción"): es un adicional pago, no algo que la familia deba destildar.
  const [solicitaFotoHermanos, setSolicitaFotoHermanos] = useState(false);

  const handleAgregarHermano = () => {
    setHermanos((prev) => [
      ...prev,
      {
        id: `hermano-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        alumnoNombre: '',
        alumnoApellido: alumnoApellido.trim() || '',
        alumnoDni: '',
        turno: '',
        grado: '',
        division: ''
      }
    ]);
  };

  const handleActualizarHermano = (
    id: string,
    campo: 'alumnoNombre' | 'alumnoApellido' | 'alumnoDni' | 'turno' | 'grado' | 'division',
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
    const whatsappDestino = selectedColegio?.whatsappContacto || configWhatsApp.whatsappSolicitudCodigo || '';

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

  // Si el valor elegido deja de existir (se cambió de colegio), se vacía para que la familia lo
  // vuelva a elegir — antes se reemplazaba en silencio por el primero de la lista.
  React.useEffect(() => {
    if (division && !divisionesDisponibles.includes(division)) setDivision('');
  }, [divisionesDisponibles, division]);

  React.useEffect(() => {
    if (turno && !turnosDisponibles.includes(turno)) setTurno('');
  }, [turnosDisponibles, turno]);

  React.useEffect(() => {
    if (grado && !gradosDisponibles.includes(grado)) setGrado('');
  }, [gradosDisponibles, grado]);

  // Auditoría 2026-09-24: antes, elegir el turno cambiaba sola la división ("Mañana" → A, "Tarde"
  // → B, "Jornada" → "Jornada Extendida"). En la nómina real los chicos de Jornada Extendida son de
  // la división C, y los de la tarde no siempre de la B: la familia terminaba con la división
  // equivocada sin darse cuenta. El turno ya no toca la división.
  const handleCambioTurno = (nuevoTurno: string) => {
    setTurno(nuevoTurno);
  };

  const [mensajeCopiado, setMensajeCopiado] = useState(false);

  // Login states
  const [loginQuery, setLoginQuery] = useState('');
  // Auditoría 2026-09-22 (pedido de Pablo: "que cada vez que vayan a ingresar, lo hagan con
  // nombre y apellido del padre/tutor/encargado, el DNI del padre/tutor/encargado, y el código
  // generado"): el código de curso lo comparte toda la sección, así que hacen falta estos dos
  // datos más, junto al código, para que el servidor identifique a la familia exacta.
  const [loginTutorNombre, setLoginTutorNombre] = useState('');
  const [loginTutorDni, setLoginTutorDni] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [verificandoLogin, setVerificandoLogin] = useState(false);

  // Refresh pending status
  const [verificandoEstado, setVerificandoEstado] = useState(false);
  const [mensajeVerificacionEstado, setMensajeVerificacionEstado] = useState<string | null>(null);

  // Form errors
  const [formError, setFormError] = useState<string | null>(null);

  // Auditoría 2026-09-09: el código real ya no viaja en `familiaCreada` cuando la inscripción se
  // aprueba automáticamente — guardamos acá sólo si se pudo mandar el correo con el código y a
  // qué dirección, para poder mostrárselo a la familia sin exponer el código en pantalla.
  const [envioCodigoInfo, setEnvioCodigoInfo] = useState<{ enviado: boolean; destino: string | null } | null>(null);

  // Al abrir el modal, si esta familia ya tiene una inscripción activa en este navegador,
  // precargamos sus datos en el formulario (así "Cambiar datos" edita lo que ya cargó,
  // en vez de mostrarse en blanco como si fuera una familia nueva).
  React.useEffect(() => {
    if (!isOpen) return;
    // Auditoría 2026-09-22: `setPaso`/`setTab`/la limpieza del login deben correr siempre que se
    // abre el modal, tenga o no esta familia una sesión guardada en este navegador — antes
    // quedaban dentro del `if (!activa) return` de abajo, así que alguien sin sesión guardada acá
    // (por ejemplo, ya inscripto desde OTRO dispositivo) que pedía la pestaña "Ya me inscribí"
    // igual terminaba en "Inscribirme", porque el efecto cortaba antes de llegar a `setTab`.
    setPaso('formulario');
    setTab(initialTab || 'registro');
    setFormError(null);
    setLoginQuery('');
    setLoginTutorNombre('');
    setLoginTutorDni('');
    setLoginError(null);

    const activa = obtenerFamiliaActiva();
    if (!activa) return;

    setPadreNombre(activa.padreNombre || '');
    setPadreDni(activa.padreDni || '');
    setTelefonoWhatsApp(activa.telefonoWhatsApp || '');
    setEmail(activa.email || '');
    setAlumnoNombre(activa.alumnoNombre || '');
    setAlumnoApellido(activa.alumnoApellido || '');
    setAlumnoDni(activa.alumnoDni || '');
    setTurno(activa.turno || '');
    setGrado(activa.grado || '');
    setDivision(activa.division || '');
    setColegioId(activa.colegioId || colegios[0]?.id || 'col-divino-pastor-2026');
    setHermanos(
      (activa.hermanos || []).map((h) => ({
        id: h.id || `hermano-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        alumnoNombre: h.alumnoNombre,
        alumnoApellido: h.alumnoApellido,
        alumnoDni: h.alumnoDni || '',
        turno: h.turno,
        grado: h.grado,
        division: h.division
      }))
    );
    setSolicitaFotoHermanos(activa.solicitaFotoHermanos ?? false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

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
    if (!dniEsValido(padreDni)) {
      setFormError('Por favor ingresá un número de DNI válido del padre, madre o tutor (sin puntos).');
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
    if (!dniEsValido(alumnoDni)) {
      setFormError('Por favor ingresá un número de DNI válido del alumno/a (sin puntos).');
      return;
    }
    if (!turno || !grado || !division) {
      setFormError('Elegí el turno, el grado/sala y la división de tu hijo/a. Revisalo bien: el código que vas a recibir es el de ese curso.');
      return;
    }
    const hermanoSinCurso = hermanos.find((h) => h.alumnoNombre.trim() && (!h.turno || !h.grado || !h.division));
    if (hermanoSinCurso) {
      setFormError(`Elegí el turno, el grado/sala y la división de ${hermanoSinCurso.alumnoNombre}.`);
      return;
    }
    const hermanoConDniInvalido = hermanos.find((h) => h.alumnoNombre.trim() && !dniEsValido(h.alumnoDni));
    if (hermanoConDniInvalido) {
      setFormError(`Por favor ingresá un DNI válido para ${hermanoConDniInvalido.alumnoNombre || 'el/la hermano/a agregado/a'}.`);
      return;
    }

    const hermanosValidados: AlumnoHermano[] = hermanos
      .filter((h) => h.alumnoNombre.trim())
      .map((h) => ({
        id: h.id,
        alumnoNombre: h.alumnoNombre.trim(),
        alumnoApellido: h.alumnoApellido.trim() || alumnoApellido.trim(),
        alumnoDni: limpiarDni(h.alumnoDni),
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
      padreDni: limpiarDni(padreDni),
      telefonoWhatsApp: telefonoWhatsApp.trim(),
      email: email.trim(),
      alumnoNombre: alumnoNombre.trim(),
      alumnoApellido: alumnoApellido.trim(),
      alumnoDni: limpiarDni(alumnoDni),
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

    setEnvioCodigoInfo({ enviado: Boolean(resultado.emailEnviado), destino: resultado.emailDestino || null });
    setFamiliaCreada(resultado.inscripcion);
    setPaso('resultado');
  };

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError(null);

    if (!loginQuery.trim()) {
      setLoginError('Ingresá tu código de acceso (o tu teléfono/correo para pedir el reenvío).');
      return;
    }

    setVerificandoLogin(true);
    // Auditoría 2026-09-09 (hallazgo reportado por Pablo): esta pestaña aceptaba un teléfono o
    // email en vez del código y, si coincidía con una familia ya aprobada, mostraba su código
    // real de inmediato — el teléfono de un padre empadronado no es secreto. Ahora el servidor
    // sólo devuelve la familia completa si lo que se escribió ES el código real; si se escribió
    // un teléfono/email de una familia ya aprobada, el servidor reenvía el código por correo
    // pero no lo entrega acá.
    // Auditoría 2026-09-22 (pedido de Pablo): si lo que se escribió ES un código de curso, ya no
    // alcanza solo — el servidor pide también nombre y DNI del tutor para identificar a la
    // familia exacta dentro del curso (`requiereDatosTutor`). El teléfono/email siguen andando
    // igual que antes (ese camino nunca entrega el código directo, ver más arriba).
    const resultado = await buscarMiInscripcion(loginQuery, loginTutorNombre, loginTutorDni);
    setVerificandoLogin(false);

    if (resultado.requiereDatosTutor) {
      const curso = resultado.cursoInfo;
      const descCurso = curso ? `${curso.grado || ''} "${curso.division || ''}" · Turno ${curso.turno || ''}${curso.colegioNombre ? ` (${curso.colegioNombre})` : ''}`.trim() : null;
      setLoginError(
        resultado.datosNoCoinciden
          ? `El nombre y DNI que ingresaste no coinciden con ninguna familia registrada con este código${descCurso ? ` (${descCurso})` : ''}. Revisá que estén escritos igual que en tu inscripción.`
          : `Este código es de todo el curso${descCurso ? ` (${descCurso})` : ''}. Completá también el nombre y el DNI del tutor con el que te inscribiste para identificar a tu familia.`
      );
    } else if (resultado.inscripcion) {
      guardarFamiliaActiva(resultado.inscripcion);
      setEnvioCodigoInfo(null); // se encontró por el código real: se muestra directo, no hace falta el aviso de "revisá tu correo"
      setFamiliaCreada(resultado.inscripcion);
      setPaso('resultado');
    } else if (resultado.yaRegistrado) {
      setLoginError(
        resultado.emailReenviado
          ? `Por seguridad no mostramos el código escribiendo el teléfono o email. Ya te lo reenviamos a ${resultado.emailDestino || 'tu correo registrado'} — copialo desde ahí.`
          : 'Encontramos tu inscripción, pero no pudimos reenviarte el código por correo ahora. Contactá al equipo fotográfico para que te lo reenvíen desde el panel.'
      );
    } else {
      setLoginError('No encontramos una inscripción con ese código, teléfono o correo. Verificá los datos o completá la pestaña "Inscribirme".');
    }
  };

  const handleVerificarEstado = async () => {
    if (!familiaCreada) return;
    setVerificandoEstado(true);
    setMensajeVerificacionEstado(null);
    const query = familiaCreada.email || familiaCreada.telefonoWhatsApp;
    const resultado = await buscarMiInscripcion(query);
    setVerificandoEstado(false);
    if (resultado.inscripcion) {
      setFamiliaCreada(resultado.inscripcion);
      guardarFamiliaActiva(resultado.inscripcion);
    } else if (resultado.yaRegistrado && resultado.emailReenviado) {
      // Ya fue aprobada mientras tanto: por seguridad el código no llega acá, se reenvió por
      // correo — se lo hacemos saber a la familia en vez de dejar el botón sin efecto visible.
      // Auditoría 2026-09-22 (pedido de Pablo: "son personas tontas, debe ser muy concisa la info
      // de las ventanas" — este mensaje sonaba técnico para alguien que no sabe qué es "reenviar
      // por seguridad"): directo al grano, con un solo dato accionable (dónde buscar el código).
      setMensajeVerificacionEstado(`¡Ya está aprobado! Te enviamos el código a ${resultado.emailDestino || 'tu correo'}. Buscalo ahí (revisá también spam) y pegalo para entrar.`);
    } else {
      setMensajeVerificacionEstado('Todavía sigue pendiente de revisión por el equipo fotográfico.');
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-xs p-0 sm:p-4 overflow-y-auto">
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-white border-0 sm:border border-slate-200 w-full max-w-2xl rounded-none sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col h-full sm:h-auto sm:max-h-[92vh] text-slate-900 animate-in fade-in zoom-in-95 duration-150 text-left"
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
                    ? 'Tu inscripción fue confirmada. Código despachado por Email.'
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
              {/* Auditoría 2026-09-22 (pedido de Pablo, repaso de pantalla real: "demasiada
                  información, extremadamente confuso" en esta pantalla, y luego, sobre la versión
                  ya aprobada, "otra ventana más! con muchísima información... no tiene sentido"):
                  antes había DOS tarjetas apiladas mostrando la misma info de la familia dos veces
                  (una tarjeta genérica de "registro" arriba, y abajo la de aprobado/pendiente que
                  repetía el saludo y agregaba la suya propia). Ahora es una sola tarjeta por
                  estado, con el saludo, un resumen de una línea de los hijos, y lo único accionable
                  (el código o el estado de la revisión) — nada se repite dos veces. */}
              {familiaCreada?.estado === 'aceptado' ? (
                <div className="bg-gradient-to-b from-emerald-50 via-white to-emerald-50/50 border-2 border-emerald-400 rounded-3xl p-5 sm:p-6 space-y-4 shadow-sm">
                  <div className="flex items-start gap-3.5">
                    <div className="w-12 h-12 rounded-2xl bg-emerald-500 text-white flex items-center justify-center shrink-0 shadow-md shadow-emerald-500/25">
                      <CheckCircle2 className="w-7 h-7" />
                    </div>
                    <div className="space-y-1">
                      <span className="text-[10px] uppercase font-black tracking-wider px-2 py-0.5 rounded-full bg-emerald-600 text-white">
                        Código de acceso activo
                      </span>
                      <h4 className="text-lg font-black text-slate-900 font-['Outfit']">
                        ¡Hola {tutorDisplay}! Ya podés ver las fotos
                      </h4>
                      <p className="text-xs sm:text-sm text-slate-600">
                        {alumnoDisplay}
                        {familiaCreada?.hermanos && familiaCreada.hermanos.length > 0
                          ? ` y ${familiaCreada.hermanos.length} hermano${familiaCreada.hermanos.length > 1 ? 's' : ''} más`
                          : ''}
                        {' · '}{colegioDisplay}
                      </p>
                    </div>
                  </div>

                  {(familiaCreada.codigoAsignado || familiaCreada.codigoFamiliar) ? (
                    /* Se llegó acá escribiendo el código real (pestaña "Ya me inscribí"): ya lo tiene, es seguro mostrarlo */
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
                            // Sólo se muestra "Copiado" si de verdad se copió (en navegadores de
                            // apps como Instagram la API del portapapeles no existe).
                            void copiarAlPortapapeles(code).then((ok) => {
                              if (!ok) {
                                window.prompt('Copiá tu código:', code);
                                return;
                              }
                              setMensajeCopiado(true);
                              setTimeout(() => setMensajeCopiado(false), 2000);
                            });
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
                  ) : (
                    /* Aprobación recién hecha por este mismo envío: por seguridad no se muestra el
                       código acá — se mandó únicamente por correo al email ya validado contra el padrón. */
                    <div className="p-4 bg-emerald-500/10 border-2 border-emerald-300 rounded-2xl space-y-3">
                      <div className="flex items-start gap-2.5">
                        <Mail className="w-5 h-5 text-emerald-700 shrink-0 mt-0.5" />
                        <p className="text-xs sm:text-sm text-emerald-900 font-semibold leading-relaxed">
                          {envioCodigoInfo?.enviado
                            ? <>Por seguridad no mostramos el código acá: te lo mandamos por correo a <strong>{envioCodigoInfo.destino || familiaCreada.email}</strong>. Revisá tu bandeja de entrada (y la carpeta de spam).</>
                            : <>Tu inscripción quedó aprobada, pero no pudimos enviarte el código por correo en este momento. Contactá al equipo fotográfico para que te lo reenvíen.</>}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => onInscripcionExitosa(familiaCreada)}
                        className="w-full px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-black text-xs sm:text-sm rounded-xl shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <span>Ya tengo mi código, ingresar</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                  {/* Pedido de Pablo (25/9): contarle las dos formas de pago justo cuando recibe su código. */}
                  <div className="p-3.5 rounded-2xl bg-white border border-amber-200 text-xs text-slate-600 leading-relaxed">
                    <p className="font-bold text-slate-900">¿Cómo se paga?</p>
                    <p className="mt-1">
                      <strong>Al elegir las fotos:</strong> cuando las fotos del curso estén online, entrás, elegís tus 3 favoritas y pagás ahí.
                    </p>
                    <p className="mt-1">
                      <strong>Por adelantado:</strong> si las fotos todavía no están, entrá con tu código y vas a ver <em>"Reservá tu kit ahora"</em>: lo dejás pago y, cuando se suban, elegís tus fotos sin volver a pagar.
                    </p>
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
                        ¡Hola {tutorDisplay}! Tu solicitud está en revisión
                      </h4>
                      <p className="text-xs text-slate-500">
                        {alumnoDisplay}
                        {familiaCreada?.hermanos && familiaCreada.hermanos.length > 0
                          ? ` y ${familiaCreada.hermanos.length} hermano${familiaCreada.hermanos.length > 1 ? 's' : ''} más`
                          : ''}
                        {' · '}{colegioDisplay}
                      </p>
                      <p className="text-xs sm:text-sm text-slate-600 leading-relaxed">
                        El equipo fotográfico la va a revisar y te vamos a mandar tu <strong>Código de Acceso</strong> por email.
                      </p>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-2.5 pt-1">
                    <div className="p-3 bg-sky-50/80 border border-sky-200 rounded-2xl flex items-center gap-2.5">
                      <div className="w-8 h-8 rounded-xl bg-sky-500 text-white flex items-center justify-center shrink-0">
                        <Mail className="w-4 h-4" />
                      </div>
                      <div className="overflow-hidden">
                        <span className="text-[10px] font-bold text-sky-900 uppercase block">Te avisaremos por Email:</span>
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
                                        {/* Auditoría 2026-09-18 (pedido de Pablo): se sacó la rama de WhatsApp —
                        las familias no deben tener ningún punto de contacto por WhatsApp en la
                        web, solo por email o el sistema de mensajería propio del sitio
                        (Consultas). Antes esto elegía WhatsApp automáticamente cuando el
                        colegio tenía un número configurado; ahora siempre usa mail.
                        Auditoría 2026-09-18 (reporte de Pablo, mismo día): un mailto: no hace
                        nada visible sin cliente de correo configurado — reemplazado por el
                        formulario de Consultas del sitio, con los datos ya precargados. Ver
                        src/utils/consultaPrefill.ts. */}
                    <button
                      type="button"
                      onClick={() =>
                        irAConsultasConDatos(
                          {
                            nombre: tutorDisplay || '',
                            colegio: colegioDisplay,
                            asunto: 'Otro motivo',
                            mensaje: `Hola, completé la inscripción para las fotos de ${alumnoDisplay} (${gradoDisplay} "${divisionDisplay}", Turno ${turnoDisplay}, ${colegioDisplay}). ¿Podrían confirmarme si mi inscripción ya fue validada? ¡Muchas gracias!`,
                          },
                          onClose
                        )
                      }
                      className="flex-1 py-3 px-4 bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                    >
                      <Mail className="w-4 h-4" />
                      <span>Escribinos por mail</span>
                    </button>
                  </div>

                  {mensajeVerificacionEstado && (
                    <div className="flex items-start gap-2 p-3 bg-sky-50 border border-sky-200 rounded-xl text-xs font-semibold text-sky-900">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{mensajeVerificacionEstado}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Auditoría 2026-09-22 (pedido de Pablo: "si ya tiene el código, este botón es muy
                  muy discreto, debería estar más visible, como los demás"): antes era un texto
                  subrayado chiquito al lado de "Modificar datos", muy por debajo en peso visual de
                  los dos botones negros de arriba. Ahora es un botón con el mismo tamaño, sólo que
                  en estilo secundario (contorno) para no competir con "Verificar si ya fue
                  aprobada", que sigue siendo la acción principal mientras está pendiente.
                  También se saca el precargado del campo con el email/teléfono (ver bug reportado
                  por Pablo: "figura mi correo electrónico en el lugar donde va el código, no lo
                  puse yo, solo apareció") — ese campo es para el código real; precargarlo con el
                  email de un paso distinto (pedir reenvío) confundía appareciendo ahí después. */}
              {familiaCreada?.estado !== 'aceptado' && (
                <button
                  type="button"
                  onClick={() => {
                    setPaso('formulario');
                    setTab('login');
                    setLoginQuery('');
                    setLoginError(null);
                  }}
                  className="w-full py-3 px-4 bg-white hover:bg-amber-50 text-amber-900 border-2 border-amber-400 font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <Key className="w-4 h-4" />
                  <span>Ya tengo mi código, ingresar ahora</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
              )}

              {/* Bottom navigation actions */}
              <div className="pt-2 flex items-center justify-center text-xs border-t border-slate-200">
                <button
                  type="button"
                  onClick={() => setPaso('formulario')}
                  className="text-slate-500 hover:text-slate-800 underline font-medium cursor-pointer"
                >
                  ← Modificar datos de inscripción
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
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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

                    {/* Auditoría 2026-09-22 (pedido de Pablo): el código de acceso real termina
                        siendo compartido por todo el curso — este DNI, junto con el código, es lo
                        que después permite identificar a la familia exacta al ingresar (ver
                        `/api/inscripciones/buscar`). Se pide acá, de entrada, para no depender de
                        identificar por nombre en el primer ingreso. */}
                    <div>
                      <label className="block text-xs font-bold text-slate-700 mb-1">
                        DNI del padre / madre / tutor <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="text"
                        inputMode="numeric"
                        required
                        value={padreDni}
                        onChange={(e) => setPadreDni(e.target.value)}
                        placeholder="Sin puntos, ej: 30456789"
                        autoComplete="off"
                        className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                      />
                    </div>
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
                      {sugerirCorreccionEmail(email) && (
                        <p className="text-[11px] text-sky-900 bg-sky-50 border border-sky-200 rounded-lg px-2 py-1 mt-1">
                          ¿Quisiste decir <strong>{sugerirCorreccionEmail(email)}</strong>?{' '}
                          <button type="button" onClick={() => setEmail(sugerirCorreccionEmail(email) || email)} className="font-bold underline cursor-pointer">
                            Corregir
                          </button>
                        </p>
                      )}
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

                  {/* DNI del alumno/a */}
                  <div>
                    <label className="block text-xs font-bold text-slate-700 mb-1">
                      DNI del alumno/a <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      inputMode="numeric"
                      required
                      value={alumnoDni}
                      onChange={(e) => setAlumnoDni(e.target.value)}
                      placeholder="Ej: 45123456 (sin puntos)"
                      className="w-full px-3.5 py-2.5 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                    />
                    <p className="text-[10px] text-slate-500 mt-1">
                      Lo pedimos para identificar con seguridad al alumno/a, ya que puede haber más de un/a chico/a con el mismo nombre y apellido en el colegio. Así evitamos confundir a tu hijo/a con otro/a y que reciba fotos que no le corresponden.
                    </p>
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
                        <option value="" disabled>Elegí el turno</option>
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
                        <option value="" disabled>Elegí el grado o sala</option>
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
                        <option value="" disabled>Elegí la división</option>
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
                  <div className="p-3.5 bg-amber-50/50 rounded-xl border border-dashed border-amber-300 text-xs text-amber-900">
                    <span className="text-[11px] text-slate-600">
                      Si tenés otro hijo/a en otra sala, grado o turno, hacé clic en <strong>+ Agregar Hermano/a</strong>.
                    </span>
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

                        {/* DNI Hermano */}
                        <div>
                          <label className="block text-xs font-bold text-slate-700 mb-1">
                            DNI <span className="text-red-500">*</span>
                          </label>
                          <input
                            type="text"
                            inputMode="numeric"
                            value={hermano.alumnoDni}
                            onChange={(e) =>
                              handleActualizarHermano(hermano.id, 'alumnoDni', e.target.value)
                            }
                            placeholder="Ej: 45123456 (sin puntos)"
                            className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                          />
                          <p className="text-[10px] text-slate-500 mt-1">
                            Para identificarlo/a sin confundirlo/a con otro/a alumno/a que tenga el mismo nombre.
                          </p>
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
                              <option value="" disabled>Elegí</option>
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
                              <option value="" disabled>Elegí</option>
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
                              <option value="" disabled>Elegí</option>
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
                  {/* Auditoría 2026-09-09: el texto de acá invitaba a escribir el WhatsApp o correo
                      como si fuera un acceso directo — ya no lo es (ver seguridad más arriba), así
                      que ahora el código va primero y el teléfono/correo se explica aparte, como lo
                      que realmente hacen: pedir el reenvío por correo, nunca entrar directo.
                      Auditoría 2026-09-22 (pedido de Pablo): el código lo comparte todo el curso,
                      así que ahora también hacen falta el nombre y DNI del tutor con el que se
                      inscribió la familia, para identificar exactamente a tus hijos. */}
                  <label className="block text-xs font-bold text-slate-700">
                    Nombre y apellido del tutor
                  </label>
                  <input
                    type="text"
                    value={loginTutorNombre}
                    onChange={(e) => setLoginTutorNombre(e.target.value)}
                    placeholder="Ej: María Gómez"
                    autoComplete="name"
                    className="w-full px-4 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                  />

                  <label className="block text-xs font-bold text-slate-700">
                    DNI del tutor
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={loginTutorDni}
                    onChange={(e) => setLoginTutorDni(e.target.value)}
                    placeholder="Sin puntos, ej: 30456789"
                    autoComplete="off"
                    className="w-full px-4 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                  />

                  <label className="block text-xs font-bold text-slate-700">
                    Código de Acceso
                  </label>
                  <div className="relative">
                    <input
                      type="text"
                      value={loginQuery}
                      onChange={(e) => setLoginQuery(e.target.value)}
                      placeholder="Ej: 88BU-M8TF"
                      className="w-full px-4 py-3 text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                    />
                  </div>
                  <p className="text-[11px] text-slate-500">
                    ¿No tenés el código a mano? Escribí tu WhatsApp o correo registrado: si tu inscripción ya fue aprobada, te reenviamos el código por correo (por seguridad, nunca se muestra acá).
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
      </div>
    </div>
  );
}
