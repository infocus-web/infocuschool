import { useState, useEffect, useRef, FormEvent } from 'react';
import { ViewfinderFocusIcon } from './RetratoEscolarLogo';
import {
  X,
  Search,
  School,
  User,
  Sparkles,
  Check,
  CheckCircle2,
  Lock,
  Eye,
  CreditCard,
  Building2,
  ArrowRight,
  ArrowLeft,
  Download,
  Smartphone,
  ShieldCheck,
  Heart,
  QrCode,
  Package,
  PackageCheck,
  Clock,
  Truck,
  FileText,
  Key,
  Layers,
  CheckCheck,
  AlertCircle,
  Mail,
  FolderCheck,
  Printer,
  Copy,
  Plus,
  Minus,
  ChevronDown,
  RefreshCw,
  Send,
  Images,
  ShoppingCart,
} from 'lucide-react';
import { KITS_DISPONIBLES } from '../data/colegiosData';
import { useColegiosLista } from '../services/colegiosService';
import { useWhatsAppConfig } from '../services/configuracionService';
import {
  registrarPedidoDesdePortal,
  registrarCarritoMultipleDesdePortal,
  obtenerPedidosGuardados,
  guardarPedidosEnStorage,
  cambiarMetodoPagoPedido,
  PedidoEscolarCompleto,
  buscarPedidoPorSeguimiento,
  ErrorLimiteBusqueda,
  verificarPedidoExistente,
  PedidoExistenteResumen,
  ItemCarritoHijo,
} from '../services/pedidosLabService';
import { crearPreferenciaMercadoPago, crearPreferenciaMercadoPagoMultiple } from '../services/mercadoPagoService';
import { crearIntencionPagoNave, crearIntencionPagoNaveMultiple } from '../services/naveService';
import {
  obtenerFamiliaActiva,
  cerrarSesionFamilia,
  InscripcionFamilia,
  buscarMiInscripcion,
  guardarFamiliaActiva,
  determinarCodigoParaInscripcion,
  obtenerHijosDeFamilia,
  HijoConCodigoSeccion
} from '../services/inscripcionesService';
import { enviarSolicitudCodigo } from '../services/solicitudesCodigoService';
import { obtenerGaleriaPublica } from '../services/fotosSubidasService';
import { irAConsultasConDatos } from '../utils/consultaPrefill';
import { Colegio, KitProducto, Foto } from '../types';

interface PortalFamiliasModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedColegioId?: string;
  preselectedKitId?: string;
  preselectedCodigo?: string;
  onOpenInscripcion?: () => void;
}

/**
 * Carrito multi-hijo ("un solo pedido, un solo pago" — pedido de Pablo 2026-09-16): cada vez que
 * la familia cambia de hijo con el selector del Paso 2, la selección de fotos/kit del hijo que
 * deja de estar activo se guarda con esta forma — antes se perdía por completo (ver el useEffect
 * de "Al cambiar de galería", que limpiaba fotoSeleccionadaIndividual/Grupal/Docente cada vez que
 * cambiaba `fotosDisponibles`, sin distinguir "cambié de hijo" de "esta foto ya no existe"). Al
 * llegar al pago (Paso 4), se arman todos los pedidos guardados acá más el del hijo actualmente
 * activo, y si hay más de uno se cobran juntos en un solo checkout combinado.
 */
interface SeleccionCarritoHijo {
  hijoId: string;
  nombreCompleto: string;
  colegioNombre?: string;
  grado?: string;
  division?: string;
  turno?: string;
  codigoSeccion: string;
  kitId: string;
  kitNombre: string;
  extraCarpetas: number;
  fotoSeleccionadaIndividual: string;
  fotoSeleccionadaGrupal: string;
  fotoSeleccionadaDocente: string;
  fotosSueltasSeleccionadas: string[];
  total: number;
  completo: boolean;
}

// Auditoría 2026-09-16: useState(...) en este archivo no está devolviendo un tipo genérico
// verificado por TypeScript (a diferencia de lo esperado, el estado sale tipado como `any` acá
// — algo preexistente en este proyecto, no algo que haya cambiado este carrito). Object.values()
// sobre un valor `any` infiere `unknown[]` en vez de `SeleccionCarritoHijo[]`, así que se pasa
// siempre por este helper (con un parámetro anotado de forma concreta) para que el carrito se seleccione con el tipo correcto.
function valoresDelCarrito(carrito: Record<string, SeleccionCarritoHijo>): SeleccionCarritoHijo[] {
  return Object.values(carrito);
}

/**
 * Auditoría 2026-09-20 (pedido de Pablo: "¿se puede aplicar un efecto lupa al pasar por la
 * miniatura?" en el resumen del pedido). Las miniaturas ahí son chiquitas (56x56px) y de baja
 * resolución (foto.thumbnail) — agrandar ESA imagen se vería borroso. En vez de eso: al pasar el
 * mouse se ve un ícono de lupa y un leve zoom como invitación (sólo cosmético, no depende de que
 * el dispositivo tenga mouse); al hacer clic o tocar se abre la vista ampliada reutilizando el
 * modal de vista previa que ya existía en la grilla de selección (foto.url, la versión más
 * grande con marca de agua) — así funciona igual en computadora que en el celular, donde el
 * "hover" no existe y una lupa que sigue el cursor no serviría de nada.
 */
function MiniaturaAmpliable({
  foto,
  alt,
  onAmpliar,
  className = 'h-14 w-14',
}: {
  foto: Foto;
  alt: string;
  onAmpliar: (foto: Foto) => void;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onAmpliar(foto)}
      className={`group relative ${className} shrink-0 rounded-lg overflow-hidden cursor-zoom-in focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400`}
      title="Tocá para ver la foto ampliada"
    >
      <img
        src={foto.thumbnail}
        alt={alt}
        className="h-full w-full object-cover transition-transform duration-200 ease-out group-hover:scale-125"
      />
      <span className="absolute inset-0 flex items-center justify-center bg-slate-950/0 group-hover:bg-slate-950/30 transition-colors duration-200">
        <Search className="w-4 h-4 text-white opacity-0 group-hover:opacity-100 transition-opacity duration-200 drop-shadow" />
      </span>
    </button>
  );
}

/**
 * Pedido "de respaldo" para la pantalla de confirmación cuando la familia vuelve de Mercado Pago /
 * Nave en un navegador que no tiene el pedido guardado (típico en el celular). Antes se armaba a
 * mano, incompleto (sin `archivosParaLaboratorio`, `tutorEmail`, etc.), y la pantalla explotaba al
 * leer esos campos. El estado real se consulta después al servidor.
 */
function pedidoDeRespaldo(datos: {
  referencia: string;
  esGrupo: boolean;
  metodoPago: PedidoEscolarCompleto['metodoPago'];
  estadoPago: PedidoEscolarCompleto['estadoPago'];
}): PedidoEscolarCompleto {
  return {
    id: datos.referencia,
    supabaseId: datos.referencia,
    grupoPagoId: datos.esGrupo ? datos.referencia : undefined,
    fecha: new Date().toLocaleDateString('es-AR'),
    colegioId: '',
    colegioNombre: '',
    cursoCodigo: '',
    grado: '',
    division: '',
    turno: '',
    alumnoNumeroLista: 0,
    alumnoNombre: datos.esGrupo ? 'tus hijos/as' : '',
    codigoAlumno: '',
    tutorNombre: '',
    tutorTelefono: '',
    tutorEmail: '',
    kitId: 'kit-clasico',
    kitNombre: datos.esGrupo ? 'Varios kits' : 'Kit Retrato Escolar',
    total: 0,
    metodoPago: datos.metodoPago,
    estadoPago: datos.estadoPago,
    estadoEntrega: 'laboratorio_listo',
    fotosSeleccionadas: { individualId: '', grupalId: '' },
    archivosParaLaboratorio: [],
    linkDescargaHD: '',
    emailEnviado: false,
  };
}

/**
 * Colegio de la familia: el de la lista pública si está; si no (colegio no marcado como público,
 * o la lista todavía no cargó / falló), uno armado con los datos de la propia inscripción. Antes se
 * caía a `colegios[0]` — el pedido quedaba registrado en OTRO colegio (y el .zip HD nunca se podía
 * armar) — o directamente no se mostraba nada en el Paso 1.
 */
function colegioDeLaFamilia(colegios: Colegio[], familia: InscripcionFamilia): Colegio | null {
  const enLista = colegios.find((c) => c.id === familia.colegioId);
  if (enLista) return enLista;
  if (!familia.colegioId) return null;
  return {
    id: familia.colegioId,
    slug: familia.colegioId,
    nombre: familia.colegioNombre || 'Colegio',
    localidad: '',
    zona: 'CABA',
    eventoActual: '',
    grados: familia.grado ? [familia.grado] : [],
    divisiones: familia.division ? [familia.division] : [],
    turnos: familia.turno ? [familia.turno] : [],
    codigoAcceso: '',
  };
}

export default function PortalFamiliasModal({
  isOpen,
  onClose,
  preselectedColegioId,
  preselectedKitId,
  preselectedCodigo,
  onOpenInscripcion,
}: PortalFamiliasModalProps) {
  // Navigation Steps
  // 1: Colegio y Alumno
  // 2: Galería y Selección de Fotos
  // 3: Selección de Kit y Adicionales
  // 4: Checkout y Pago
  // 5: Pedido Confirmado
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5>(1);

  // Mode: 'pedido' (order flow) | 'seguimiento' (order tracking tool)
  const [modalMode, setModalMode] = useState<'pedido' | 'seguimiento'>('pedido');
  const [trackingQuery, setTrackingQuery] = useState('');
  const [searchedOrder, setSearchedOrder] = useState<any | null>(null);
  const [trackingError, setTrackingError] = useState('');
  const [buscandoSeguimiento, setBuscandoSeguimiento] = useState(false);
  // Auditoría 2026-09-22 (pedido de Pablo: "por qué me deja volver a comprar si ya tengo un
  // pedido hecho? debería mostrarme el pedido que ya realicé y preguntarme si deseo hacer otro").
  // `pedidoExistente` se llena automáticamente (ver el useEffect más abajo) apenas se resuelve
  // el alumno/a activo, si ya hay un pedido registrado para él/ella en este curso — mientras esté
  // seteado se muestra un cartel de confirmación en la pantalla de "Acceso validado" en vez del
  // botón normal para pasar al Paso 2.
  const [pedidoExistente, setPedidoExistente] = useState<PedidoExistenteResumen | null>(null);
  const [verificandoPedidoExistente, setVerificandoPedidoExistente] = useState(false);

  // Step 1: School & Student Selection
  const [searchColegio, setSearchColegio] = useState('');
  const { colegios } = useColegiosLista();
  const { config: configWhatsApp } = useWhatsAppConfig();
  const [selectedColegio, setSelectedColegio] = useState<Colegio | null>(null);
  const [grado, setGrado] = useState('');
  const [division, setDivision] = useState('');
  const [turno, setTurno] = useState('');
  const [nombreAlumno, setNombreAlumno] = useState('');

  // Dynamic WhatsApp number: prioritized by selected school, or global configuration
  const whatsappDestino = selectedColegio?.whatsappContacto || configWhatsApp.whatsappSolicitudCodigo || '5491128625916';
  const [codigoAcceso, setCodigoAcceso] = useState('');
  // Auditoría 2026-09-22 (pedido de Pablo: "que cada vez que vayan a ingresar, lo hagan con
  // nombre y apellido del padre/tutor/encargado, el DNI del padre/tutor/encargado, y el código
  // generado"): el código de curso lo comparte toda la sección, así que ahora hacen falta estos
  // dos datos más, junto al código, para que el servidor identifique a la familia exacta.
  const [codigoTutorNombreInput, setCodigoTutorNombreInput] = useState('');
  const [codigoTutorDniInput, setCodigoTutorDniInput] = useState('');
  const [codigoValidadoMsg, setCodigoValidadoMsg] = useState<string | null>(null);
  const [codigoErrorMsg, setCodigoErrorMsg] = useState<string | null>(null);
  const [familiaActiva, setFamiliaActiva] = useState<InscripcionFamilia | null>(null);
  // Código real y secreto ya validado contra el servidor (ver `codigos_seccion` en server.ts).
  // Es la ÚNICA llave que habilita traer fotos reales — elegir grado/turno/división del
  // desplegable ya NO alcanza para verlas (antes sí, y ahí estaba el problema de seguridad).
  const [codigoSeccionValidado, setCodigoSeccionValidado] = useState<string | null>(null);

  // "No encuentro mi código de curso": recuperación y consultas únicamente por email.
  const [mostrarFormSolicitudCodigo, setMostrarFormSolicitudCodigo] = useState(false);
  const [solicitudNombre, setSolicitudNombre] = useState('');
  const [solicitudContacto, setSolicitudContacto] = useState('');
  const [enviandoSolicitudCodigo, setEnviandoSolicitudCodigo] = useState(false);
  const [solicitudCodigoEnviada, setSolicitudCodigoEnviada] = useState(false);
  const [solicitudCodigoMensaje, setSolicitudCodigoMensaje] = useState('');
  const [solicitudCodigoError, setSolicitudCodigoError] = useState<string | null>(null);

  // Step 2: Gallery
  const [categoriaActiva, setCategoriaActiva] = useState<'individual' | 'grupal' | 'docente' | 'patio'>('individual');
  const [fotoSeleccionadaIndividual, setFotoSeleccionadaIndividual] = useState<string>('');
  const [fotoSeleccionadaGrupal, setFotoSeleccionadaGrupal] = useState<string>('');
  const [fotoSeleccionadaDocente, setFotoSeleccionadaDocente] = useState<string>('');
  const [fotosSueltasSeleccionadas, setFotosSueltasSeleccionadas] = useState<string[]>([]);
  // Auditoría 2026-09-20 (pedido de Pablo: efecto "lupa" en las miniaturas del resumen del
  // pedido). "soloVista" es opcional para no romper el único llamado que ya existía (la grilla de
  // selección del paso 2, que sigue sin mandarlo y por lo tanto sigue mostrando "Elegir esta
  // foto" como siempre). Se usa desde el resumen del pedido para ampliar sin ofrecer ese botón —
  // ahí la foto ya está elegida, no tiene sentido "reelegirla" desde una pantalla de repaso.
  const [modalFotoPreview, setModalFotoPreview] = useState<(Foto & { soloVista?: boolean }) | null>(null);
  const [errorSeleccionFotos, setErrorSeleccionFotos] = useState('');

  // Sólo fotos reales del curso cargadas en Supabase; nunca se muestran fotos genéricas.
  const [fotosDisponibles, setFotosDisponibles] = useState<Foto[]>([]);

  useEffect(() => {
    let cancelado = false;
    // Sin un código real y validado no se expone ninguna galería.
    obtenerGaleriaPublica({ codigo: codigoSeccionValidado }).then((resultado) => {
      if (cancelado) return;
      setFotosDisponibles(resultado.fotos);
      // Auditoría 2026-09-23: el curso real de esta galería es el que resuelve el servidor a
      // partir del código (codigos_seccion). Se toma de ahí para que el pedido se registre con el
      // mismo grado/turno/división de las fotos: si el grado de la inscripción ya no figuraba
      // textual en la lista del colegio (el fotógrafo la editó), un efecto de más abajo lo
      // reemplazaba por el primero de la lista, y el pedido quedaba con un curso sin fotos (el
      // .zip HD nunca se podía armar).
      if (resultado.seccion) {
        const { grado: gradoSeccion, turno: turnoSeccion, division: divisionSeccion } = resultado.seccion;
        if (gradoSeccion) setGrado(gradoSeccion);
        if (turnoSeccion) setTurno(turnoSeccion);
        if (divisionSeccion !== undefined && divisionSeccion !== null) setDivision(divisionSeccion);
      }
    });
    return () => {
      cancelado = true;
    };
  }, [codigoSeccionValidado]);

  // Al cambiar de galería se conservan únicamente elecciones que sigan existiendo.
  // Nunca se elige automáticamente la primera foto: la decisión debe ser explícita.
  useEffect(() => {
    const inds = fotosDisponibles.filter((f) => f.categoria === 'individual');
    const grups = fotosDisponibles.filter((f) => f.categoria === 'grupal');
    const docs = fotosDisponibles.filter((f) => f.categoria === 'docente');

    setFotoSeleccionadaIndividual((actual) => inds.some((f) => f.id === actual) ? actual : '');
    setFotoSeleccionadaGrupal((actual) => grups.some((f) => f.id === actual) ? actual : '');
    setFotoSeleccionadaDocente((actual) => docs.some((f) => f.id === actual) ? actual : '');
    setFotosSueltasSeleccionadas((actuales) => actuales.filter((id) => fotosDisponibles.some((f) => f.id === id && f.categoria === 'patio')));
    if (!fotosDisponibles.some((f) => f.categoria === 'patio')) setCategoriaActiva('individual');
    setErrorSeleccionFotos('');
  }, [fotosDisponibles]);

  // Step 3: Kit & Extras
  const [selectedKit, setSelectedKit] = useState<KitProducto>(
    KITS_DISPONIBLES.find((k) => k.id === 'kit-clasico') || KITS_DISPONIBLES[0]
  );
  // Copia extra de la carpeta completa para abuelos o familiares
  const [extraCarpetas, setExtraCarpetas] = useState<number>(0);

  // Step 4: Checkout
  const [tutorNombre, setTutorNombre] = useState('');
  const [tutorWhatsapp, setTutorWhatsapp] = useState('');
  const [tutorEmail, setTutorEmail] = useState('');
  const [metodoPago, setMetodoPago] = useState<'mercadopago' | 'transferencia' | 'nave'>('mercadopago');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');
  const [pedidoGenerado, setPedidoGenerado] = useState<PedidoEscolarCompleto | null>(null);
  const [mpRedirectUrl, setMpRedirectUrl] = useState<string | null>(null);
  const [naveRedirectUrl, setNaveRedirectUrl] = useState<string | null>(null);
  const [pagoError, setPagoError] = useState<string | null>(null);
  const [verificandoPago, setVerificandoPago] = useState(false);
  const [mensajeEstadoPago, setMensajeEstadoPago] = useState<string | null>(null);
  const [generandoLinkPago, setGenerandoLinkPago] = useState(false);
  const [generandoLinkNave, setGenerandoLinkNave] = useState(false);
  const [cambiandoMetodoPago, setCambiandoMetodoPago] = useState(false);

  /**
   * Genera (o regenera) el link de Checkout Pro de Mercado Pago para un pedido ya registrado.
   * Hace falta porque el link original (mpRedirectUrl) vive solo en memoria del navegador:
   * si la familia recarga la página, vuelve más tarde, o Mercado Pago la devuelve con el pago
   * pendiente/rechazado, ese link se pierde y sin esto no había forma de volver a pagar.
   */
  const generarLinkDePago = async (pedido: PedidoEscolarCompleto, autoRedirigir = false) => {
    if (generandoLinkPago) return;
    setGenerandoLinkPago(true);
    setPagoError(null);
    try {
      // Auditoría 2026-09-23 (bug real): para un carrito de varios hijos esto regeneraba el link con
      // el id del PRIMER pedido del grupo — el reintento cobraba sólo a ese hijo, y los hermanos
      // quedaban sin pagar. Un pedido con grupo de pago se regenera como pago combinado.
      const res = pedido.grupoPagoId
        ? await crearPreferenciaMercadoPagoMultiple({
            grupoPagoId: pedido.grupoPagoId,
            items: [],
            tutorNombre: pedido.tutorNombre || 'Tutor',
            tutorEmail: pedido.tutorEmail,
            tutorTelefono: pedido.tutorTelefono || undefined,
          })
        : await crearPreferenciaMercadoPago({
        pedidoId: pedido.supabaseId || pedido.id,
        kitId: pedido.kitId,
        kitNombre: pedido.kitNombre,
        alumnoNombre: pedido.alumnoNombre || 'Alumno',
        colegioNombre: pedido.colegioNombre || 'Colegio',
        cursoCodigo: pedido.cursoCodigo,
        total: pedido.total,
        carpetasExtras: pedido.copiasExtras?.carpetasExtras || 0,
        // Auditoría 2026-09-20 (bug real, CRÍTICO): faltaba mandar esto — el servidor recalcula
        // el total SIEMPRE del lado propio (nunca confía en "total"), pero sin este dato trataba
        // cualquier pedido con "Otras Fotos" como si tuviera 0, cobrando de menos por Mercado
        // Pago aunque el .zip HD sí las incluyera igual. Ver calcularTotalPedido en server.ts.
        cantidadFotosSueltas: pedido.copiasExtras?.otras15x21 || 0,
        tutorNombre: pedido.tutorNombre || 'Tutor',
        tutorEmail: pedido.tutorEmail,
        tutorTelefono: pedido.tutorTelefono || undefined,
      });
      if (res.initPoint) {
        setMpRedirectUrl(res.initPoint);
        if (autoRedirigir) {
          window.location.href = res.initPoint;
        }
      } else {
        setPagoError(res.error || 'No se pudo generar el link de pago de Mercado Pago.');
      }
    } catch (err: any) {
      setPagoError(err?.message || 'Error de conexión con el servidor de pagos.');
    } finally {
      setGenerandoLinkPago(false);
    }
  };

  /**
   * Genera (o regenera) el link de Checkout de Nave para un pedido ya registrado.
   * Mismo motivo que generarLinkDePago: el link vive solo en memoria del navegador.
   */
  const generarLinkDeNave = async (pedido: PedidoEscolarCompleto, autoRedirigir = false) => {
    if (generandoLinkNave) return;
    setGenerandoLinkNave(true);
    setPagoError(null);
    try {
      // Mismo caso que generarLinkDePago: un carrito de varios hijos se cobra combinado.
      const res = pedido.grupoPagoId
        ? await crearIntencionPagoNaveMultiple({
            grupoPagoId: pedido.grupoPagoId,
            items: [],
            tutorNombre: pedido.tutorNombre || 'Tutor',
            tutorEmail: pedido.tutorEmail,
            tutorTelefono: pedido.tutorTelefono || undefined,
          })
        : await crearIntencionPagoNave({
        pedidoId: pedido.supabaseId || pedido.id,
        kitId: pedido.kitId,
        kitNombre: pedido.kitNombre,
        alumnoNombre: pedido.alumnoNombre || 'Alumno',
        colegioNombre: pedido.colegioNombre || 'Colegio',
        carpetasExtras: pedido.copiasExtras?.carpetasExtras || 0,
        // Auditoría 2026-09-20 (bug real, CRÍTICO): ver comentario equivalente en
        // generarLinkDePago (Mercado Pago) — mismo problema en Nave.
        cantidadFotosSueltas: pedido.copiasExtras?.otras15x21 || 0,
        tutorNombre: pedido.tutorNombre || 'Tutor',
        tutorEmail: pedido.tutorEmail,
        tutorTelefono: pedido.tutorTelefono || undefined,
      });
      if (res.checkoutUrl) {
        setNaveRedirectUrl(res.checkoutUrl);
        if (autoRedirigir) {
          window.location.href = res.checkoutUrl;
        }
      } else {
        setPagoError(res.error || 'No se pudo generar el link de pago de Nave.');
      }
    } catch (err: any) {
      setPagoError(err?.message || 'Error de conexión con el servidor de pagos.');
    } finally {
      setGenerandoLinkNave(false);
    }
  };

  // Consulta en tiempo real el estado del pedido en la base de datos (Supabase / Backend)
  const verificarEstadoRealPedido = async (idParaConsultar?: string) => {
    const id = idParaConsultar || pedidoGenerado?.supabaseId || pedidoGenerado?.id;
    if (!id) return;
    setVerificandoPago(true);
    setMensajeEstadoPago(null);
    try {
      const res = await fetch(`/api/pedidos/${encodeURIComponent(id)}/status`);
      const data = await res.json();
      if (data.success) {
        // Pantalla de respaldo (volvió del pago sin el pedido guardado): se completa el monto real.
        if (Number(data.total) > 0) {
          setPedidoGenerado((prev) => (prev && !(prev.total > 0) ? { ...prev, total: Number(data.total) } : prev));
        }
        if (data.estadoPago === 'aprobado') {
          // Auditoría 2026-09-18 (reporte de Pablo): "el botón de descarga inmediata no se
          // activa" — el .zip HD se termina de generar unos segundos después de que el pago
          // queda aprobado, así que acá se suma el link apenas el servidor lo tiene (además de
          // llegar por email), en vez de obligar a la familia a esperar el correo.
          setPedidoGenerado((prev) =>
            prev
              ? {
                  ...prev,
                  estadoPago: 'aprobado',
                  estadoEntrega: 'laboratorio_listo',
                  linkDescargaHD: data.linkDescargaHD || prev.linkDescargaHD,
                }
              : null
          );
          setMensajeEstadoPago(
            data.linkDescargaHD
              ? '¡Pago confirmado! Ya podés descargar tus fotos en alta resolución.'
              : '¡Pago confirmado y acreditado con éxito!'
          );
        } else if (data.estadoPago === 'rechazado') {
          setPedidoGenerado((prev) =>
            prev ? { ...prev, estadoPago: 'rechazado' } : null
          );
          setMensajeEstadoPago('El pago fue rechazado o cancelado.');
        } else {
          setMensajeEstadoPago('El pago aún se encuentra en procesamiento.');
        }
      }
    } catch (e) {
      console.warn('Error al verificar estado de pago:', e);
    } finally {
      setVerificandoPago(false);
    }
  };

  /**
   * Auditoría 2026-09-21 (pedido real de Pablo, probado en producción): "intenté pagar con
   * Mercado Pago, me arrepentí, cancelé el pago justo antes de apretar el botón, y volví a la
   * página — me queda el pendiente de pago pero no me da la opción de elegir otro medio de
   * pago, solo el botón de acceder a Mercado Pago nuevamente". El método de pago quedaba fijo
   * para siempre en lo elegido al crear el pedido. Esto llama al nuevo endpoint del servidor
   * (que sólo permite el cambio mientras el pedido siga sin pagarse), actualiza el pedido en
   * pantalla con el nuevo método, y limpia los links de pago viejos para que los efectos de
   * arriba generen uno nuevo del método recién elegido automáticamente.
   */
  const handleCambiarMetodoPago = async (nuevoMetodo: 'mercadopago' | 'nave' | 'transferencia') => {
    if (!pedidoGenerado || cambiandoMetodoPago || nuevoMetodo === pedidoGenerado.metodoPago) return;
    const id = pedidoGenerado.supabaseId || pedidoGenerado.id;
    if (!id) return;

    setCambiandoMetodoPago(true);
    setPagoError(null);
    try {
      const res = await cambiarMetodoPagoPedido(id, nuevoMetodo);
      if (!res.success) {
        setPagoError(res.error || 'No se pudo cambiar el método de pago.');
        return;
      }

      setPedidoGenerado((prev) => (prev ? { ...prev, metodoPago: nuevoMetodo } : null));
      setMetodoPago(nuevoMetodo);
      setMpRedirectUrl(null);
      setNaveRedirectUrl(null);

      // El servidor ya agrupa el cambio por grupo_pago_id cuando es un carrito multi-hijo (ver
      // /api/pedidos/:id/cambiar-metodo-pago) — acá solo se refleja en el localStorage el propio
      // pedido en pantalla, que es lo único que este navegador cachea localmente por id.
      const pedidosGuardados = obtenerPedidosGuardados();
      const actualizados = pedidosGuardados.map((p) =>
        p.supabaseId === id || p.id === id ? { ...p, metodoPago: nuevoMetodo } : p
      );
      guardarPedidosEnStorage(actualizados);
    } catch (err: any) {
      setPagoError(err?.message || 'Error de conexión al cambiar el método de pago.');
    } finally {
      setCambiandoMetodoPago(false);
    }
  };

  // Polling automático cuando la pantalla está en el paso 5 con pago pendiente. Auditoría
  // 2026-09-18 (reporte de Pablo): antes esto paraba apenas el pago quedaba "aprobado", así que
  // el botón de descarga inmediata se quedaba en "Preparando..." para siempre si el .zip HD
  // tardaba en generarse — nadie volvía a preguntarle al servidor si ya estaba listo. Ahora, si
  // ya está aprobado pero todavía no llegó el link, se lo sigue consultando (con un intervalo más
  // espaciado, y con un límite de intentos para no dejarlo sondeando para siempre si algo falla).
  useEffect(() => {
    if (step !== 5 || !pedidoGenerado) return;
    const pagoPendiente = pedidoGenerado.estadoPago !== 'aprobado' && pedidoGenerado.estadoPago !== 'rechazado';
    const aprobadoSinLink = pedidoGenerado.estadoPago === 'aprobado' && !pedidoGenerado.linkDescargaHD;
    if (!pagoPendiente && !aprobadoSinLink) return;

    // Auditoría 2026-09-23: antes se consultaba cada 4 s sin tope — una pantalla abierta agotaba
    // el límite de consultas de la IP (compartida con otras familias en celulares/WiFi del colegio).
    // Transferencia/efectivo no se acreditan solos (los aprueba el fotógrafo): se consulta más
    // espaciado. Siempre con tope; el botón "Verificar estado" sigue disponible.
    const esPagoManual = pedidoGenerado.metodoPago === 'transferencia' || pedidoGenerado.metodoPago === 'efectivo';
    const intervaloMs = aprobadoSinLink ? 8000 : esPagoManual ? 60000 : 10000;
    const maxIntentos = aprobadoSinLink ? 45 : esPagoManual ? 30 : 180; // ~6 min esperando el .zip; ~30 min esperando el pago
    let intentos = 0;
    const interval = setInterval(() => {
      intentos += 1;
      verificarEstadoRealPedido();
      if (intentos >= maxIntentos) clearInterval(interval);
    }, intervaloMs);
    return () => clearInterval(interval);
  }, [step, pedidoGenerado?.estadoPago, pedidoGenerado?.linkDescargaHD, pedidoGenerado?.id, pedidoGenerado?.supabaseId]);

  // Si se llega al paso 5 con un pedido de Mercado Pago pendiente pero sin link de pago a mano
  // (por ejemplo, al volver de Mercado Pago con el pago rechazado/pendiente, o tras recargar la
  // página), se genera un link nuevo automáticamente para que siempre haya forma de reintentar.
  useEffect(() => {
    if (
      step !== 5 ||
      !pedidoGenerado ||
      pedidoGenerado.metodoPago !== 'mercadopago' ||
      pedidoGenerado.estadoPago === 'aprobado' ||
      mpRedirectUrl ||
      generandoLinkPago
    ) {
      return;
    }
    generarLinkDePago(pedidoGenerado, false);
  }, [step, pedidoGenerado?.id, pedidoGenerado?.supabaseId, pedidoGenerado?.estadoPago, mpRedirectUrl]);

  // Mismo mecanismo que el de arriba, pero para pedidos pagados con Nave.
  useEffect(() => {
    if (
      step !== 5 ||
      !pedidoGenerado ||
      pedidoGenerado.metodoPago !== 'nave' ||
      pedidoGenerado.estadoPago === 'aprobado' ||
      naveRedirectUrl ||
      generandoLinkNave
    ) {
      return;
    }
    generarLinkDeNave(pedidoGenerado, false);
  }, [step, pedidoGenerado?.id, pedidoGenerado?.supabaseId, pedidoGenerado?.estadoPago, naveRedirectUrl]);

  // Detección automática al retornar de Mercado Pago (?mp_status=approved&pedido_id=...)
  // o de Nave (?nave_status=vuelta&pedido_id=...) — Nave no manda el resultado en la URL de
  // vuelta (ver additional_info.callback_url en server.ts), así que acá sólo se usa para
  // saber que hay que consultar el estado real contra el servidor.
  //
  // Auditoría 2026-09-22 (bug real, ALTA, encontrado en auditoría de código — no reportado por
  // Pablo): para un carrito multi-hijo (2+ hermanos, un solo pago combinado) la URL de vuelta de
  // Mercado Pago y de Nave NUNCA trae "pedido_id" — trae "grupo_pago_id" (ver
  // /api/mercadopago/crear-preferencia-multiple y /api/nave/crear-intencion-multiple en
  // server.ts). Como este efecto sólo miraba "pedido_id", para el caso insignia de esta función
  // ("un solo Código Familiar, un solo pago") NO PASABA NADA al volver del pago: no se mostraba
  // ninguna confirmación, no se consultaba el estado real, la familia quedaba mirando la pantalla
  // que sea que hubiera quedado antes de la redirección completa a la pasarela de pago — aunque
  // el pago y los pedidos en Supabase estuvieran perfectamente bien. Se agrega acá el mismo
  // manejo para "grupo_pago_id", buscando en localStorage TODOS los pedidos de ese grupo (ahora
  // sí se cachean ahí, ver registrarCarritoMultipleDesdePortal) para armar una confirmación con
  // los nombres y el total reales, igual que hace handleCompletarPagoMultiple antes de pagar.
  // Marca que este montaje viene de volver de una pasarela de pago (ver el efecto de abajo), para
  // que el efecto de "sesión familiar" no mande la pantalla de confirmación de vuelta al Paso 1.
  const retornoDePagoRef = useRef(false);
  useEffect(() => {
    try {
      const searchParams = new URLSearchParams(window.location.search);
      const mpStatus = searchParams.get('mp_status');
      const naveStatus = searchParams.get('nave_status');
      const pedidoId = searchParams.get('pedido_id');
      const grupoPagoId = searchParams.get('grupo_pago_id');
      if ((mpStatus || naveStatus) && (pedidoId || grupoPagoId)) retornoDePagoRef.current = true;

      const armarConfirmacionGrupo = (metodo: 'mercadopago' | 'nave', estadoInicial: 'aprobado' | 'pendiente') => {
        const pedidosGuardados = obtenerPedidosGuardados();
        const pedidosDelGrupo = pedidosGuardados.filter((item) => item.grupoPagoId === grupoPagoId);
        if (pedidosDelGrupo.length > 0) {
          const totalGrupo = pedidosDelGrupo.reduce((acc, p) => acc + (p.total || 0), 0);
          const nombreFriendly = pedidosDelGrupo.map((p) => p.id).join(', ');
          setPedidoGenerado({
            ...pedidosDelGrupo[0],
            id: nombreFriendly,
            alumnoNombre: pedidosDelGrupo.map((p) => p.alumnoNombre).join(', '),
            kitNombre: `${pedidosDelGrupo.length} hijos/as`,
            total: totalGrupo,
          });
          setNumeroPedido(nombreFriendly);
          setStep(5);
          // El estado real (aprobado/rechazado/pendiente) es el mismo para todo el grupo — el
          // webhook de pago marca todas las filas del grupo juntas con una sola confirmación —
          // así que alcanza con consultar por el primer pedido del grupo.
          verificarEstadoRealPedido(pedidosDelGrupo[0].supabaseId || pedidosDelGrupo[0].id);
        } else {
          // Mismo fallback genérico que ya existía para el camino de un solo hijo cuando no se
          // encuentra nada en localStorage (otro navegador/dispositivo, storage limpiado, etc.)
          // — acá no hay ningún id de pedido individual para consultar el estado real, sólo el
          // grupoPagoId, que /api/pedidos/:id/status no sabe buscar.
          setNumeroPedido(grupoPagoId || '');
          setPedidoGenerado(pedidoDeRespaldo({ referencia: grupoPagoId || '', esGrupo: true, metodoPago: metodo, estadoPago: estadoInicial }));
          // /api/pedidos/:id/status ahora también resuelve por grupo_pago_id.
          if (grupoPagoId) verificarEstadoRealPedido(grupoPagoId);
          setStep(5);
        }
      };

      if (naveStatus && grupoPagoId && !mpStatus && !pedidoId) {
        armarConfirmacionGrupo('nave', 'pendiente');
        return;
      }

      if (mpStatus && grupoPagoId && !pedidoId) {
        armarConfirmacionGrupo('mercadopago', mpStatus === 'approved' ? 'aprobado' : 'pendiente');
        return;
      }

      if (naveStatus && pedidoId && !mpStatus) {
        const pedidosGuardados = obtenerPedidosGuardados();
        const pEncontrado = pedidosGuardados.find(
          (item) => item.supabaseId === pedidoId || item.id === pedidoId
        );
        if (pEncontrado) {
          setPedidoGenerado(pEncontrado);
          setNumeroPedido(pEncontrado.id);
          setStep(5);
        } else {
          setNumeroPedido(pedidoId);
          setPedidoGenerado(pedidoDeRespaldo({ referencia: pedidoId, esGrupo: false, metodoPago: 'nave', estadoPago: 'pendiente' }));
          setStep(5);
        }
        verificarEstadoRealPedido(pedidoId);
        return;
      }

      if (mpStatus && pedidoId) {
        const pedidosGuardados = obtenerPedidosGuardados();
        const pEncontrado = pedidosGuardados.find(
          (item) => item.supabaseId === pedidoId || item.id === pedidoId
        );
        if (pEncontrado) {
          setPedidoGenerado(pEncontrado);
          setNumeroPedido(pEncontrado.id);
          setStep(5);
        } else {
          setNumeroPedido(pedidoId);
          setPedidoGenerado(pedidoDeRespaldo({ referencia: pedidoId, esGrupo: false, metodoPago: 'mercadopago', estadoPago: mpStatus === 'approved' ? 'aprobado' : 'pendiente' }));
          setStep(5);
        }
        verificarEstadoRealPedido(pedidoId);
      }
    } catch (err) {
      console.warn('Error leyendo query params de pago:', err);
    }
  }, []);

  // Sibling selector inside Family Portal (1 code for all children).
  // Auditoría 2026-09-16 (pedido de Pablo): la web y el mail de aprobación prometen "1 solo
  // Código Familiar... vas a poder alternar entre tus hijos con un solo toque" incluso si están
  // en secciones distintas, pero antes esta función solo actualizaba el nombre/grado que se
  // MUESTRA — la galería seguía mostrando siempre la sección del hijo principal, porque
  // `codigoSeccionValidado` (la única llave real que trae fotos) nunca se tocaba acá. Ahora
  // `hijosFamilia` trae, para cada hermano, el código real de SU PROPIA sección (resuelto por el
  // servidor en `/api/familia/hijos` — nunca se confía en un grado/turno/división suelto del
  // navegador para traer fotos), y cambiar de hijo cambia también esa llave.
  const [hijoSeleccionadoId, setHijoSeleccionadoId] = useState<string>('principal');
  const [hijosFamilia, setHijosFamilia] = useState<HijoConCodigoSeccion[]>([]);

  useEffect(() => {
    let cancelado = false;
    const codigoFamiliar = familiaActiva?.codigoAsignado || familiaActiva?.codigoFamiliar;
    if (!codigoFamiliar) {
      setHijosFamilia([]);
      return;
    }
    obtenerHijosDeFamilia(codigoFamiliar, familiaActiva?.padreDni).then((hijos) => {
      if (!cancelado) setHijosFamilia(hijos);
    });
    return () => {
      cancelado = true;
    };
  }, [familiaActiva?.codigoAsignado, familiaActiva?.codigoFamiliar, familiaActiva?.padreDni]);

  // Carrito multi-hijo (ver interfaz SeleccionCarritoHijo más arriba, fuera del componente).
  const [carritoHijos, setCarritoHijos] = useState<Record<string, SeleccionCarritoHijo>>({});
  // Espejo en un ref para poder leer el carrito más reciente dentro de efectos/callbacks sin
  // tener que agregar `carritoHijos` a sus dependencias (evita relanzar esos efectos de más).
  const carritoHijosRef = useRef(carritoHijos);
  useEffect(() => {
    carritoHijosRef.current = carritoHijos;
  }, [carritoHijos]);

  // Restaura, si existe, la selección de fotos guardada en el carrito para el hijo que acaba de
  // quedar activo. Se ejecuta DESPUÉS del efecto de arriba ("Al cambiar de galería..."), que
  // limpia fotoSeleccionadaIndividual/Grupal/Docente cada vez que cambia `fotosDisponibles` — así
  // esta restauración no queda pisada por esa limpieza. Sin esto, volver a elegir un hermano ya
  // configurado obligaba a re-elegir sus 3 fotos de nuevo.
  //
  // Auditoría 2026-09-21 (fix definitivo — fotos cruzadas entre hermanos del mismo curso, pedido
  // de Pablo: "elegí las fotos del primer hijo, pero me dice que ya elegí la de ambos, y no es
  // cierto, solo elegí la de uno de ellos"): las 4 condiciones de abajo antes solo LLAMABAN al
  // setter cuando el valor guardado era válido y no vacío — si el hermano al que se vuelve todavía
  // no había elegido, por ejemplo, la foto grupal (`fotoSeleccionadaGrupal === ''`), esa condición
  // daba `false` y el setter correspondiente JAMÁS se llamaba. El estado quedaba entonces con la
  // foto grupal/docente que había dejado puesta el hermano ANTERIOR (porque, al compartir sección,
  // `fotosDisponibles` no cambia de referencia y el efecto de limpieza de más arriba tampoco se
  // dispara). Ese resto ajeno terminaba marcando a este hermano como "completo" sin que la familia
  // hubiese elegido nada para él. Ahora cada campo se fija de forma explícita e incondicional —
  // con '' como resultado por defecto cuando no hay nada guardado o válido — así nunca queda un
  // valor del hermano anterior sin limpiar.
  useEffect(() => {
    const guardado = carritoHijosRef.current[hijoSeleccionadoId];
    if (!guardado) return;
    const inds = fotosDisponibles.filter((f) => f.categoria === 'individual');
    const grups = fotosDisponibles.filter((f) => f.categoria === 'grupal');
    const docs = fotosDisponibles.filter((f) => f.categoria === 'docente');
    const patio = fotosDisponibles.filter((f) => f.categoria === 'patio');
    setFotoSeleccionadaIndividual(
      guardado.fotoSeleccionadaIndividual && inds.some((f) => f.id === guardado.fotoSeleccionadaIndividual)
        ? guardado.fotoSeleccionadaIndividual
        : ''
    );
    setFotoSeleccionadaGrupal(
      guardado.fotoSeleccionadaGrupal && grups.some((f) => f.id === guardado.fotoSeleccionadaGrupal)
        ? guardado.fotoSeleccionadaGrupal
        : ''
    );
    setFotoSeleccionadaDocente(
      guardado.fotoSeleccionadaDocente && docs.some((f) => f.id === guardado.fotoSeleccionadaDocente)
        ? guardado.fotoSeleccionadaDocente
        : ''
    );
    setFotosSueltasSeleccionadas(
      guardado.fotosSueltasSeleccionadas?.length
        ? guardado.fotosSueltasSeleccionadas.filter((fid) => patio.some((f) => f.id === fid))
        : []
    );
  }, [fotosDisponibles, hijoSeleccionadoId]);

  const seleccionarHijo = (id: string) => {
    if (id === hijoSeleccionadoId) return;

    // El cartel de "ya tenés un pedido" es específico del alumno/a que estaba activo — al
    // cambiar de hijo/a se limpia, así no queda mostrado por error para otro hermano.
    setPedidoExistente(null);

    setCarritoHijos((prev) => ({
      ...prev,
      [hijoSeleccionadoId]: {
        hijoId: hijoSeleccionadoId,
        nombreCompleto: nombreAlumno,
        colegioNombre: selectedColegio?.nombre,
        grado,
        division,
        turno,
        codigoSeccion: codigoSeccionValidado || '',
        kitId: selectedKit.id,
        kitNombre: selectedKit.nombre,
        extraCarpetas,
        fotoSeleccionadaIndividual,
        fotoSeleccionadaGrupal,
        fotoSeleccionadaDocente,
        fotosSueltasSeleccionadas,
        total,
        completo: Boolean(fotoSeleccionadaIndividual && fotoSeleccionadaGrupal && fotoSeleccionadaDocente),
      },
    }));

    setHijoSeleccionadoId(id);
    const guardadoDestino = carritoHijosRef.current[id];
    const kitGuardado = guardadoDestino ? KITS_DISPONIBLES.find((k) => k.id === guardadoDestino.kitId) : null;
    setSelectedKit(kitGuardado || KITS_DISPONIBLES.find((k) => k.id === 'kit-clasico') || KITS_DISPONIBLES[0]);
    setExtraCarpetas(guardadoDestino?.extraCarpetas || 0);
    // Auditoría 2026-09-21 (refuerzo — hermanos gemelos/mismo curso — y fix definitivo del mismo
    // día, ver el useEffect de "Restaura..." más arriba): el efecto que limpia la selección de
    // fotos al "cambiar de galería" está enganchado a `fotosDisponibles`, así que cuando dos
    // hermanos comparten grado+turno+división (mismo curso, mismas fotos) ese array NO cambia de
    // referencia al pasar de uno a otro — ni el efecto de limpieza ni el de "cambió la galería" se
    // disparan. Por eso ACÁ, de forma síncrona y para los 4 campos de fotos, se calcula el valor
    // final explícitamente a partir de `guardadoDestino` (con '' si no hay nada guardado o si la
    // foto guardada ya no existe en la galería actual) en vez de dejarlo en manos exclusivamente
    // del useEffect de restauración — así no queda ni siquiera un frame con las fotos del hermano
    // anterior todavía puestas, y si el hermano destino tiene una sección distinta que recién va a
    // cargarse (`fotosDisponibles` desactualizado todavía), ese mismo useEffect vuelve a correr y
    // corrige una vez que llegue la galería nueva.
    const indsDestino = fotosDisponibles.filter((f) => f.categoria === 'individual');
    const grupsDestino = fotosDisponibles.filter((f) => f.categoria === 'grupal');
    const docsDestino = fotosDisponibles.filter((f) => f.categoria === 'docente');
    const patioDestino = fotosDisponibles.filter((f) => f.categoria === 'patio');
    setFotoSeleccionadaIndividual(
      guardadoDestino?.fotoSeleccionadaIndividual && indsDestino.some((f) => f.id === guardadoDestino.fotoSeleccionadaIndividual)
        ? guardadoDestino.fotoSeleccionadaIndividual
        : ''
    );
    setFotoSeleccionadaGrupal(
      guardadoDestino?.fotoSeleccionadaGrupal && grupsDestino.some((f) => f.id === guardadoDestino.fotoSeleccionadaGrupal)
        ? guardadoDestino.fotoSeleccionadaGrupal
        : ''
    );
    setFotoSeleccionadaDocente(
      guardadoDestino?.fotoSeleccionadaDocente && docsDestino.some((f) => f.id === guardadoDestino.fotoSeleccionadaDocente)
        ? guardadoDestino.fotoSeleccionadaDocente
        : ''
    );
    setFotosSueltasSeleccionadas(
      guardadoDestino?.fotosSueltasSeleccionadas?.length
        ? guardadoDestino.fotosSueltasSeleccionadas.filter((fid) => patioDestino.some((f) => f.id === fid))
        : []
    );

    const hijoConCodigo = hijosFamilia.find((h) => h.id === id);
    if (hijoConCodigo) {
      // Esta es la parte que antes faltaba: sin esto, la galería mostrada nunca cambiaba de
      // sección al tocar otro hijo, aunque el nombre de arriba sí se actualizara.
      setCodigoSeccionValidado(hijoConCodigo.codigoSeccion);
      if (hijoConCodigo.grado) setGrado(hijoConCodigo.grado);
      if (hijoConCodigo.division) setDivision(hijoConCodigo.division);
      if (hijoConCodigo.turno) setTurno(hijoConCodigo.turno);
      setNombreAlumno(hijoConCodigo.nombreCompleto);
      return;
    }
    // Respaldo (no debería pasar salvo que `hijosFamilia` todavía no haya terminado de cargar):
    // al menos deja el nombre/grado mostrados coherentes con lo que ya sabíamos localmente.
    if (!familiaActiva) return;
    if (id === 'principal') {
      setNombreAlumno(`${familiaActiva.alumnoNombre} ${familiaActiva.alumnoApellido}`);
      if (familiaActiva.grado) setGrado(familiaActiva.grado);
      if (familiaActiva.division) setDivision(familiaActiva.division);
      if (familiaActiva.turno) setTurno(familiaActiva.turno);
    } else {
      const h = familiaActiva.hermanos?.find((item) => item.id === id);
      if (h) {
        setNombreAlumno(`${h.alumnoNombre} ${h.alumnoApellido}`);
        if (h.grado) setGrado(h.grado);
        if (h.division) setDivision(h.division);
        if (h.turno) setTurno(h.turno);
      }
    }
  };

  // Sync preselected options and active family registration
  useEffect(() => {
    if (isOpen) {
      const fam = obtenerFamiliaActiva();
      setFamiliaActiva(fam);
      if (fam) {
        setTutorNombre(fam.padreNombre);
        setTutorWhatsapp(fam.telefonoWhatsApp);
        setTutorEmail(fam.email);
        setNombreAlumno(`${fam.alumnoNombre} ${fam.alumnoApellido}`);
        if (fam.turno) setTurno(fam.turno);
        if (fam.grado) setGrado(fam.grado);
        if (fam.division) setDivision(fam.division);
        if (fam.codigoFamiliar) {
          setCodigoAcceso(fam.codigoFamiliar);
          setCodigoValidadoMsg(`Código Familiar activo: ${fam.codigoFamiliar}`);
          // Al reabrir el portal, restaurar también la llave usada por la consulta de
          // galería. Antes sólo se completaba el campo visible y la pantalla quedaba
          // falsamente en "Esperando fotos" aunque el curso ya tuviera imágenes.
          setCodigoSeccionValidado(fam.codigoAsignado || fam.codigoFamiliar);
        }
        // Se vuelve a correr cuando carga la lista de colegios (dependencia `colegios`), así que
        // el colegio "de respaldo" se reemplaza por el real apenas llega.
        const col = colegioDeLaFamilia(colegios, fam);
        if (col) setSelectedColegio(col);
      } else {
        // El modal permanece montado cuando se cierra. Si ya no existe una sesión familiar,
        // eliminar todo dato sensible retenido por la instancia anterior antes de mostrarlo.
        setFamiliaActiva(null);
        setHijoSeleccionadoId('principal');
        setCarritoHijos({});
        setCodigoAcceso('');
        setCodigoValidadoMsg(null);
        setCodigoErrorMsg(null);
        setCodigoSeccionValidado(null);
        setFotosDisponibles([]);
        setFotoSeleccionadaIndividual('');
        setFotoSeleccionadaGrupal('');
        setFotoSeleccionadaDocente('');
        setFotosSueltasSeleccionadas([]);
        setNombreAlumno('');
        setTutorNombre('');
        setTutorWhatsapp('');
        setTutorEmail('');
        // Auditoría 2026-09-23 (bug real): al volver de Mercado Pago/Nave en un navegador sin la
        // sesión familiar guardada (muy común en el celular: la app de pago abre la vuelta en otro
        // navegador), el efecto de retorno ponía el Paso 5 (confirmación) y este efecto — que corre
        // después, y de nuevo cuando termina de cargar la lista de colegios — lo pisaba con el
        // Paso 1: la familia no veía nunca la confirmación de su pago.
        if (!retornoDePagoRef.current) setStep(1);
      }
    }
  }, [isOpen, colegios]);

  useEffect(() => {
    if (preselectedColegioId) {
      const col = colegios.find((c) => c.id === preselectedColegioId);
      if (col) setSelectedColegio(col);
    }
  }, [preselectedColegioId, colegios]);

  useEffect(() => {
    // Con un código de sección ya validado, el curso lo define el servidor (ver la carga de la
    // galería más arriba) — no se lo pisa con el primero de la lista del colegio.
    if (selectedColegio && !codigoSeccionValidado) {
      if (!grado || !selectedColegio.grados.includes(grado)) {
        setGrado(selectedColegio.grados[0] || '');
      }
      if (!division || !selectedColegio.divisiones.includes(division)) {
        setDivision(selectedColegio.divisiones[0] || '');
      }
      if (!turno || !selectedColegio.turnos.includes(turno)) {
        setTurno(selectedColegio.turnos[0] || '');
      }
    }
  }, [selectedColegio]);

  useEffect(() => {
    // Auditoría 2026-09-23 (bug real): la tarjeta "Fotos Sueltas de Eventos" de la home también
    // llama acá, pero ese kit no se vende suelto desde el portal (las fotos de eventos se suman
    // como "Otras Fotos" a cualquiera de los dos kits): quedaba preseleccionado un kit que el
    // servidor rechaza, y la familia recién se enteraba al querer pagar ("Kit no reconocido").
    if (preselectedKitId && preselectedKitId !== 'kit-evento-suelto') {
      const k = KITS_DISPONIBLES.find((item) => item.id === preselectedKitId);
      if (k) setSelectedKit(k);
    }
  }, [preselectedKitId]);

  // Function to validate and bind course code, family access code, or school code
  const validarCodigoIngresado = async (codigoInput: string, tutorNombreInput?: string, dniInput?: string) => {
    const clean = codigoInput.trim().toUpperCase();
    if (!clean) {
      setCodigoErrorMsg('Por favor ingresá un código para validar.');
      setCodigoValidadoMsg(null);
      return false;
    }

    // 0. Search for a registered family's access code (assigned via padrón o aprobación manual).
    // Este es el ÚNICO camino que desbloquea fotos reales: `famFound.codigoAsignado` es el
    // código real y secreto de la sección (ver `codigos_seccion` en server.ts), no una fórmula
    // adivinable a partir de grado/turno/división.
    // Auditoría 2026-09-09 (hallazgo reportado por Pablo): este cuadro aceptaba también un
    // teléfono o email en vez del código, y si coincidía con una familia ya aprobada, la
    // desbloqueaba directo — el teléfono de un padre empadronado no es secreto. Ahora el
    // servidor sólo devuelve la familia completa si lo que se escribió ES el código real; si se
    // escribió un teléfono/email de una familia que ya tiene código, el servidor lo reenvía por
    // correo pero no lo entrega acá (ver `buscarMiInscripcion`).
    // Auditoría 2026-09-22 (pedido de Pablo: "que cada vez que vayan a ingresar, lo hagan con
    // nombre y apellido del padre/tutor/encargado, el DNI del padre/tutor/encargado, y el código
    // generado... con eso solucionamos el problema de que con un solo código por curso no se
    // crucen los datos de los alumnos al momento de ingresar"): el código de curso lo comparte
    // toda la sección a propósito, así que ya no alcanza con acertarlo — se manda siempre junto
    // al nombre y DNI del tutor para que el servidor identifique a la familia exacta.
    const resultadoBusqueda = await buscarMiInscripcion(clean, tutorNombreInput, dniInput);
    if (resultadoBusqueda.requiereDatosTutor) {
      const curso = resultadoBusqueda.cursoInfo;
      const descCurso = curso ? `${curso.grado || ''} "${curso.division || ''}" · Turno ${curso.turno || ''} (${curso.colegioNombre || ''})`.trim() : null;
      setCodigoErrorMsg(
        resultadoBusqueda.datosNoCoinciden
          ? `El nombre y DNI que ingresaste no coinciden con ninguna familia registrada con este código${descCurso ? ` (${descCurso})` : ''}. Revisá que estén escritos igual que en tu inscripción.`
          : `Este código es de todo el curso${descCurso ? ` (${descCurso})` : ''}. Para identificar a tu familia, completá también el nombre y el DNI del tutor con el que te inscribiste.`
      );
      setCodigoValidadoMsg(null);
      setCodigoSeccionValidado(null);
      return false;
    }
    if (resultadoBusqueda.yaRegistrado) {
      setCodigoErrorMsg(
        resultadoBusqueda.emailReenviado
          ? `Por seguridad no mostramos el código acá escribiendo el teléfono o email. Ya te lo reenviamos a ${resultadoBusqueda.emailDestino || 'tu correo registrado'} — copialo desde ahí y pegalo en este casillero.`
          : 'Encontramos tu inscripción, pero no pudimos reenviarte el código por correo en este momento. Contactá al equipo fotográfico para que te lo reenvíen desde el panel.'
      );
      setCodigoValidadoMsg(null);
      setCodigoSeccionValidado(null);
      return false;
    }
    const famFound = resultadoBusqueda.inscripcion;
    if (famFound && famFound.estado === 'pendiente') {
      setCodigoErrorMsg('Tu inscripción todavía está pendiente de validación por el equipo fotográfico. Te avisaremos por email en cuanto tengas tu código de acceso.');
      setCodigoValidadoMsg(null);
      setCodigoSeccionValidado(null);
      return false;
    }
    if (famFound && famFound.estado === 'aceptado' && famFound.codigoAsignado) {
      guardarFamiliaActiva(famFound);
      setFamiliaActiva(famFound);
      setHijoSeleccionadoId('principal');

      setTutorNombre(famFound.padreNombre);
      setTutorWhatsapp(famFound.telefonoWhatsApp);
      setTutorEmail(famFound.email);
      setNombreAlumno(`${famFound.alumnoNombre} ${famFound.alumnoApellido}`);
      if (famFound.turno) setTurno(famFound.turno);
      if (famFound.grado) setGrado(famFound.grado);
      if (famFound.division) setDivision(famFound.division);

      const colMatch = colegioDeLaFamilia(colegios, famFound);
      if (colMatch) setSelectedColegio(colMatch);

      const totalHijos = 1 + (famFound.hermanos?.length || 0);
      const nombresHijos = [
        famFound.alumnoNombre,
        ...(famFound.hermanos?.map((h) => h.alumnoNombre) || [])
      ].join(', ');

      setCodigoValidadoMsg(
        `¡Código Familiar verificado (${famFound.codigoFamiliar})! Familia ${famFound.padreNombre} · ${totalHijos} hijo${totalHijos > 1 ? 's' : ''} (${nombresHijos})`
      );
      setCodigoErrorMsg(null);
      setCodigoSeccionValidado(famFound.codigoAsignado);
      setSolicitudCodigoEnviada(false);
      setSolicitudCodigoMensaje('');
      setMostrarFormSolicitudCodigo(false);
      return true;
    }

    // Auditoría 2026-09-09: acá había un paso más que buscaba el código contra el sistema
    // viejo de secciones de nivel inicial (códigos inventados en localStorage, ver antiguo
    // src/data/codigosCursos.ts). Ya no desbloqueaba fotos reales por sí solo, y además
    // siempre asumía que el colegio era el primero de la lista (`colegios[0]`), lo cual es
    // incorrecto para cualquier colegio que no sea ese. Se saca del todo: si el código no es
    // ni una familia real ni el código general de un colegio, se informa el error de una.

    // 2. Código general de institución (ej: ISBA2026): sólo identifica el colegio para
    // facilitar la búsqueda — tampoco desbloquea fotos reales por sí solo.
    const colFound = colegios.find(
      (c) => c.codigoAcceso.toUpperCase() === clean
    );
    if (colFound) {
      setSelectedColegio(colFound);
      setCodigoValidadoMsg(`Institución reconocida: ${colFound.nombre}. Para ver las fotos reales, ingresá el código de acceso de tu curso.`);
      setCodigoErrorMsg(null);
      setCodigoSeccionValidado(null);
      setSolicitudCodigoEnviada(false);
      setSolicitudCodigoMensaje('');
      setMostrarFormSolicitudCodigo(false);
      return true;
    }

    setCodigoErrorMsg(`Código "${codigoInput}" no encontrado. Verificá si está bien escrito o seleccioná tu curso abajo.`);
    setCodigoValidadoMsg(null);
    setCodigoSeccionValidado(null);
    return false;
  };

  useEffect(() => {
    // Auditoría 2026-09-22: un código que llega precargado por URL (link compartido) ya no
    // alcanza por sí solo para validar — ahora hace falta también el nombre y DNI del tutor (ver
    // `validarCodigoIngresado`), que nadie manda por ese link. Se precarga el casillero del
    // código para que la familia no tenga que volver a escribirlo, pero se le pide igual que
    // complete sus datos antes de poder entrar.
    if (preselectedCodigo) {
      setCodigoAcceso(preselectedCodigo);
    }
  }, [preselectedCodigo]);

  // Auditoría 2026-09-22 (pedido de Pablo, tras ver el cartel sólo aparecer al tocar el botón:
  // "esto es lo primero que se ve cuando ingreso, debería aparecer mi pedido como primera
  // vista"). El chequeo de si ya existe un pedido para el alumno/a activo ya no espera a que se
  // toque "Abrir Galería de Fotos" — se dispara solo apenas se resuelve el alumno/a (incluso
  // antes de que la familia haga nada), para que el cartel de "ya tenés un pedido" sea lo primero
  // que se ve en esta pantalla de "Acceso validado", no algo que aparece recién después de un
  // click. Se repite cada vez que cambia el alumno/a activo (`nombreAlumno`) o su código de
  // sección real, así que también cubre cambiar de hijo/a en una familia con más de uno.
  // Auditoría 2026-09-23 (bug crítico reportado por Pablo: "queda en blanco la página" — la web
  // entera, no sólo el modal): este useEffect estaba declarado DESPUÉS del `if (!isOpen) return
  // null;` de más abajo, violando las Reglas de los Hooks de React (todo hook debe ejecutarse en
  // el mismo orden en cada render, nunca depender de una condición/return anterior). Mientras el
  // modal permanece montado y sólo alterna `isOpen`, React ejecuta 0 hooks en el render con
  // `isOpen=false` (corta en el return de arriba) y este hook de más en el render con
  // `isOpen=true` — apenas se abre el portal, React detecta el desfasaje y tira "Error #310:
  // Rendered more hooks than during the previous render", lo cual desmonta TODA la app (no hay
  // Error Boundary) dejando la pantalla en blanco. Reproducido en forma determinística con un
  // navegador headless contra producción: alcanza con abrir el modal (botón "Ingresar al
  // Portal"), sin llegar siquiera a escribir un código. Se soluciona moviendo el hook a ANTES del
  // `if (!isOpen) return null;`, junto con el resto — así se ejecuta siempre, en cada render, sin
  // condicionarlo a `isOpen`.
  useEffect(() => {
    // `codigoSeccionValidado` sólo actúa de guardia (hubo una identificación real); la consulta
    // usa colegio/grado/turno/división — ver verificarPedidoExistente (fix 23/9).
    if (!codigoSeccionValidado || !nombreAlumno || !selectedColegio?.id || !grado || !turno) {
      setPedidoExistente(null);
      return;
    }
    let cancelado = false;
    setVerificandoPedidoExistente(true);
    verificarPedidoExistente({ colegioId: selectedColegio.id, grado, turno, division, alumnoNombre: nombreAlumno })
      .then((existente) => {
        if (!cancelado) setPedidoExistente(existente);
      })
      .finally(() => {
        if (!cancelado) setVerificandoPedidoExistente(false);
      });
    return () => {
      cancelado = true;
    };
  }, [codigoSeccionValidado, nombreAlumno, selectedColegio?.id, grado, turno, division]);

  if (!isOpen) return null;

  // Filtered schools
  const colegiosFiltrados = colegios.filter(
    (c) =>
      c.nombre.toLowerCase().includes(searchColegio.toLowerCase()) ||
      c.localidad.toLowerCase().includes(searchColegio.toLowerCase()) ||
      c.codigoAcceso.toLowerCase().includes(searchColegio.toLowerCase())
  );

  // Calculate Total
  const PRECIO_CARPETA_EXTRA = 15000;
  const PRECIO_FOTO_EVENTO = 5000;
  // Mismos topes que aplica el servidor al cobrar (MAX_CARPETAS_EXTRA / MAX_FOTOS_SUELTAS en
  // server.ts): sin esto, pasando el tope la pantalla mostraba un total y se cobraba otro.
  const MAX_CARPETAS_EXTRA = 20;
  const MAX_FOTOS_SUELTAS = 50;
  const precioBase = selectedKit.precio;
  const totalCopiasExtrasCantidad = extraCarpetas;
  const precioCopiasExtras = extraCarpetas * PRECIO_CARPETA_EXTRA;
  const total = precioBase + precioCopiasExtras + (fotosSueltasSeleccionadas.length * PRECIO_FOTO_EVENTO);

  // Carrito multi-hijo: hermanos que ya quedaron con su selección completa guardada (ver
  // seleccionarHijo) además del hijo activo ahora mismo — es lo que decide si el Paso 4 muestra
  // un resumen de un solo pedido (de siempre) o de varios pedidos con un pago combinado.
  const otrosHijosEnCarrito = valoresDelCarrito(carritoHijos).filter(
    (c) => c.hijoId !== hijoSeleccionadoId && c.completo
  );
  const totalCombinadoCarrito = total + otrosHijosEnCarrito.reduce((acc, c) => acc + c.total, 0);

  // Cuántas de las 3 fotos del pack están realmente elegidas (es decir, la selección apunta a una
  // foto que existe de verdad en esta galería, no sólo un ID que quedó de otra galería/curso). El
  // badge de "X de 3 fotos seleccionadas" mostraba siempre "3 de 3" fijo, sin importar si el curso
  // todavía no tenía cargada alguna de las 3 categorías.
  const fotoGrupalSeleccionada = fotosDisponibles.find((f) => f.id === fotoSeleccionadaGrupal && f.categoria === 'grupal');
  const fotoIndividualSeleccionada = fotosDisponibles.find((f) => f.id === fotoSeleccionadaIndividual && f.categoria === 'individual');
  const fotoDocenteSeleccionada = fotosDisponibles.find((f) => f.id === fotoSeleccionadaDocente && f.categoria === 'docente');
  const fotoGrupalSeleccionadaValida = Boolean(fotoGrupalSeleccionada);
  const fotoIndividualSeleccionadaValida = Boolean(fotoIndividualSeleccionada);
  const fotoDocenteSeleccionadaValida = Boolean(fotoDocenteSeleccionada);
  const hayFotosDeEventos = fotosDisponibles.some((f) => f.categoria === 'patio');
  const cantidadFotosPackSeleccionadas = [fotoGrupalSeleccionadaValida, fotoIndividualSeleccionadaValida, fotoDocenteSeleccionadaValida].filter(Boolean).length;

  // Auditoría 2026-09-21 (pedido de Pablo): antes, la carpeta extra para abuelos/familiares se
  // asignaba siempre al hijo que estuviera activo en pantalla — si la familia tenía más de un
  // hijo, no había forma de ver ni sumarle una copia extra a UN hermano puntual sin pararse antes
  // en su pantalla. Estos helpers leen y modifican la cantidad de carpetas extra de CUALQUIER
  // hermano de la familia desde una sola lista con su nombre al lado, sin cambiar de pestaña: si
  // es el hijo activo, tocan el estado en vivo (`extraCarpetas`); si es otro hermano, tocan
  // directamente su entrada ya guardada en `carritoHijos` (sólo existe una vez que ese hermano
  // completó sus 3 fotos — no tiene sentido ofrecer una copia duplicada de fotos que todavía no
  // se eligieron, por eso el botón "+" queda deshabilitado para un hermano incompleto).
  const obtenerExtraCarpetasDeHijo = (id: string): number => {
    if (id === hijoSeleccionadoId) return extraCarpetas;
    return carritoHijos[id]?.extraCarpetas || 0;
  };

  const hijoTieneFotosCompletas = (id: string): boolean => {
    if (id === hijoSeleccionadoId) {
      return fotoGrupalSeleccionadaValida && fotoIndividualSeleccionadaValida && fotoDocenteSeleccionadaValida;
    }
    return Boolean(carritoHijos[id]?.completo);
  };

  const ajustarExtraCarpetasDeHijo = (id: string, delta: number) => {
    if (id === hijoSeleccionadoId) {
      setExtraCarpetas((prev) => Math.min(MAX_CARPETAS_EXTRA, Math.max(0, prev + delta)));
      return;
    }
    setCarritoHijos((prev) => {
      const entry = prev[id];
      if (!entry) return prev;
      const nuevaCantidad = Math.min(MAX_CARPETAS_EXTRA, Math.max(0, (entry.extraCarpetas || 0) + delta));
      const kitPrecio = KITS_DISPONIBLES.find((k) => k.id === entry.kitId)?.precio || 0;
      const nuevoTotal = kitPrecio + nuevaCantidad * PRECIO_CARPETA_EXTRA + entry.fotosSueltasSeleccionadas.length * PRECIO_FOTO_EVENTO;
      return { ...prev, [id]: { ...entry, extraCarpetas: nuevaCantidad, total: nuevoTotal } };
    });
  };

  // Sólo tiene sentido mostrar la lista con un renglón por hermano cuando hay más de un hijo en
  // esta familia — con uno solo se deja el control simple de siempre.
  const hijosParaCarpetasExtra = hijosFamilia.length > 1 ? hijosFamilia : [];
  const totalExtraCarpetasFamilia = hijosParaCarpetasExtra.length > 0
    ? hijosParaCarpetasExtra.reduce((acc, h) => acc + obtenerExtraCarpetasDeHijo(h.id), 0)
    : extraCarpetas;

  // Auditoría 2026-09-21 (Pablo, tras probar con sus 2 mellizos): el resumen decía "1 carpeta del
  // pack principal" sin importar cuántos hermanos hubiera — con 2 hijos, cada uno con su propio
  // Kit Impreso + Digital, en realidad hay 2 carpetas de "pack principal" (una por cada hijo, ya
  // incluida en su propio kit), no 1 sola para toda la familia. Este helper cuenta cuántos
  // hermanos de la lista realmente traen una carpeta base incluida en su kit — el hijo activo se
  // lee del `selectedKit` en vivo, el resto de su `carritoHijos` guardado; si un hermano todavía
  // no llegó a elegir kit, se asume el kit por defecto (Clásico), que es el mismo criterio que ya
  // usa `selectedKit` al inicializarse.
  const hijoTieneCarpetaBaseIncluida = (id: string): boolean => {
    if (id === hijoSeleccionadoId) return selectedKit.id === 'kit-clasico';
    const kitDeEseHijo = carritoHijos[id]?.kitId;
    return kitDeEseHijo === undefined || kitDeEseHijo === 'kit-clasico';
  };
  const totalCarpetasBaseFamilia = hijosParaCarpetasExtra.length > 0
    ? hijosParaCarpetasExtra.filter((h) => hijoTieneCarpetaBaseIncluida(h.id)).length
    : 1;

  const renderFilaCarpetaExtra = (hijo: HijoConCodigoSeccion, compacto = false) => {
    const cantidad = obtenerExtraCarpetasDeHijo(hijo.id);
    const completo = hijoTieneFotosCompletas(hijo.id);
    // Auditoría 2026-09-22 (bug real, MEDIA): el botón "+" de esta fila sólo miraba si ESE
    // hermano ya había elegido sus 3 fotos (`completo`), pero nunca si su propio kit trae carpeta
    // de base para duplicar — el mismo chequeo que ya existe para el hijo activo (ver comentario
    // más arriba de `hijoTieneCarpetaBaseIncluida`, "no tiene sentido en un kit que no trae
    // carpeta de base") no se aplicaba fila por fila acá. Con dos hermanos, uno en "Kit Impreso +
    // Digital" y el otro en "Solo Digital HD" (sin carpeta física), se podía agregar sin ningún
    // aviso una "Carpeta Escolar Extra" para el hermano que no tiene carpeta de base que duplicar
    // — un ítem que se cobra bien pero que en el laboratorio no tiene sentido, porque no hay
    // ninguna carpeta original de ese kit para hacerle una copia.
    const tieneCarpetaBase = hijoTieneCarpetaBaseIncluida(hijo.id);
    const puedeSumar = completo && tieneCarpetaBase;
    const tamañoBoton = compacto ? 'w-8 h-8' : 'w-9 h-9';
    const tamañoIcono = compacto ? 'w-3.5 h-3.5' : 'w-4 h-4';
    return (
      <div
        key={hijo.id}
        className="flex items-center justify-between gap-3 py-2 first:pt-0 last:pb-0 border-b last:border-b-0 border-amber-200/60"
      >
        <div className="min-w-0 pr-2">
          <span className="text-xs font-bold text-slate-900 truncate block">{hijo.nombreCompleto}</span>
          {!completo && (
            <span className="text-[10px] text-slate-500 block">Elegí primero sus 3 fotos para poder sumarle una copia</span>
          )}
          {completo && !tieneCarpetaBase && (
            <span className="text-[10px] text-slate-500 block">Su kit no incluye carpeta física para duplicar</span>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => ajustarExtraCarpetasDeHijo(hijo.id, -1)}
            disabled={cantidad === 0}
            className={`${tamañoBoton} rounded-lg border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-700 font-bold transition-colors cursor-pointer`}
            title={`Restar carpeta extra de ${hijo.nombreCompleto}`}
          >
            <Minus className={tamañoIcono} />
          </button>
          <div className="min-w-8 text-center">
            <span className="font-mono font-extrabold text-sm text-slate-900 block">{cantidad}</span>
          </div>
          <button
            type="button"
            onClick={() => ajustarExtraCarpetasDeHijo(hijo.id, 1)}
            disabled={!puedeSumar}
            className={`${tamañoBoton} rounded-lg bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold flex items-center justify-center transition-colors cursor-pointer shadow-xs disabled:opacity-30 disabled:cursor-not-allowed`}
            title={
              !completo
                ? 'Elegí primero sus 3 fotos'
                : !tieneCarpetaBase
                  ? 'Su kit no incluye carpeta física para duplicar'
                  : `Sumar carpeta extra para ${hijo.nombreCompleto}`
            }
          >
            <Plus className={tamañoIcono} />
          </button>
        </div>
      </div>
    );
  };

  const handleContinuarAlKit = () => {
    const faltantes = [
      !fotoGrupalSeleccionadaValida ? 'una foto grupal' : null,
      !fotoIndividualSeleccionadaValida ? 'un retrato individual' : null,
      !fotoDocenteSeleccionadaValida ? 'una foto con docente' : null,
    ].filter(Boolean);
    if (faltantes.length > 0) {
      setErrorSeleccionFotos(`Antes de continuar, elegí ${faltantes.join(', ').replace(/, ([^,]*)$/, ' y $1')}.`);
      return;
    }
    // Auditoría 2026-09-21 (pedido de Pablo, tras probar con sus mellizos): hasta acá esta función
    // sólo miraba las 3 fotos del hijo activo — si la familia tiene más de un hijo/a en este
    // colegio, dejaba pasar a "Kit y Formato" (y de ahí a pagar) aunque el/los otros hermanos
    // todavía no tuvieran ninguna foto elegida. Pablo pidió explícitamente que esto bloquee SIEMPRE
    // hasta que todos los hermanos listados tengan sus 3 fotos, no sólo el que está activo en
    // pantalla en este momento. Se resuelve buscando, entre TODOS los hermanos de `hijosFamilia`
    // (no sólo los que ya pasaron por `carritoHijos`), el primero que no esté completo — un hermano
    // nunca visitado no tiene entrada en `carritoHijos`, así que cuenta como incompleto igual que
    // uno a medio elegir. Si se encuentra alguno, se lo deja como hijo activo (así la familia ve de
    // entrada qué falta, en vez de sólo leer un mensaje de error) y no se avanza.
    const hermanoIncompleto = hijosFamilia.find((h) => {
      if (h.id === hijoSeleccionadoId) return false; // el activo ya se validó arriba
      return !carritoHijosRef.current[h.id]?.completo;
    });
    if (hermanoIncompleto) {
      setErrorSeleccionFotos(
        `Antes de continuar, también tenés que elegir las 3 fotos de ${hermanoIncompleto.nombreCompleto}.`
      );
      seleccionarHijo(hermanoIncompleto.id);
      return;
    }
    setErrorSeleccionFotos('');
    setStep(3);
  };

  // Handlers
  const handleIngresarCodigo = async () => {
    if (!codigoAcceso.trim()) return;
    // Auditoría 2026-09-22: nombre y DNI del tutor viajan siempre junto al código (ver
    // `validarCodigoIngresado`) — son obligatorios ahora, se validan acá antes de pegarle al
    // servidor para no gastar el rate-limit con un pedido que ya sabemos que va a pedir datos.
    if (!codigoTutorNombreInput.trim() || codigoTutorDniInput.replace(/\D/g, '').length < 6) {
      setCodigoErrorMsg('Completá el nombre y apellido del tutor y su DNI, junto con el código, para poder identificar a tu familia.');
      setCodigoValidadoMsg(null);
      return;
    }
    const ok = await validarCodigoIngresado(codigoAcceso, codigoTutorNombreInput, codigoTutorDniInput);
    if (ok && nombreAlumno.trim()) {
      setStep(2);
    }
  };

  const handleEnviarSolicitudCodigo = async () => {
    if (!solicitudNombre.trim() || !solicitudContacto.trim()) {
      setSolicitudCodigoError('Completá tu nombre y el email con el que te registraste.');
      return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(solicitudContacto.trim())) {
      setSolicitudCodigoError('Ingresá un email válido.');
      return;
    }
    // Auditoría 2026-09-16 (pedido de Pablo: vio en el panel una solicitud de Valeria Soledad
    // Tolosa sin colegio ni alumno cargados, imposible de ubicar): antes colegio y alumno salían
    // de lo que ya hubiera completado en pantallas anteriores del portal, así que si la familia
    // tocaba "Solicitar mi Código" directo desde el Paso 1 (que es, de hecho, el motivo más común
    // para pedirlo — todavía no llegó a esas pantallas) esos dos datos quedaban vacíos y sin ellos
    // el fotógrafo no tiene forma de saber a qué familia corresponde el pedido. Ahora son
    // obligatorios acá mismo, en el propio formulario de solicitud (ver los dos campos nuevos más
    // abajo). Grado/división/turno siguen sin ser obligatorios: son justamente el dato que la
    // familia no tiene, por eso está pidiendo el código.
    if (!selectedColegio) {
      setSolicitudCodigoError('Seleccioná el colegio de tu hijo/a.');
      return;
    }
    if (!nombreAlumno.trim()) {
      setSolicitudCodigoError('Ingresá el nombre y apellido de tu hijo/a.');
      return;
    }
    setEnviandoSolicitudCodigo(true);
    setSolicitudCodigoError(null);
    try {
      const resultado = await enviarSolicitudCodigo({
        nombreSolicitante: solicitudNombre.trim(),
        contacto: solicitudContacto.trim(),
        alumnoNombre: nombreAlumno.trim() || undefined,
        colegioId: selectedColegio?.id,
        colegioNombre: selectedColegio?.nombre,
        grado: grado || undefined,
        division: division || undefined,
        turno: turno || undefined,
      });
      if (resultado.success) {
        setSolicitudCodigoMensaje(
          resultado.envioAutomatico
            ? `Te enviamos por email a ${solicitudContacto.trim()} tu código. Si no lo encontrás, revisá la bandeja de Spam. Si aun así no aparece, comunicate con los directivos o docentes y te lo enviaremos a la brevedad.`
            : (resultado.mensaje || 'Recibimos tu solicitud. Te contactaremos cuando podamos confirmar tus datos.')
        );
        setSolicitudCodigoEnviada(true);
      } else {
        setSolicitudCodigoError(resultado.error || 'No se pudo enviar la solicitud.');
      }
    } finally {
      setEnviandoSolicitudCodigo(false);
    }
  };

  const handleCompletarPago = async () => {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(tutorEmail.trim())) {
      setPagoError('Ingresá un email válido para recibir el comprobante, las fotos y los avisos del pedido.');
      return;
    }
    setIsProcessingPayment(true);
    setPagoError(null);
    setMpRedirectUrl(null);
    setNaveRedirectUrl(null);

    const numLista = Math.floor(1 + Math.random() * 25);
    // Auditoría 2026-09-20 (Pablo: "sigue sin armarse el sip" — el zip HD nunca se genera):
    // acá se guardaba directamente `codigoAcceso` (lo que la familia tipeó en el Paso 1: su
    // código secreto de sección o el código público del colegio) como `curso_codigo` del
    // pedido. Pero ese código NUNCA tiene el formato de `codigo_curso` (ej. "GRADO1-ATM") — es
    // justamente lo que audita el comentario de `obtenerGaleriaPublica`: el código secreto vive
    // en `codigos_seccion` y el servidor lo resuelve a grado/turno/división, que es de ahí que
    // sale el `codigo_curso` real que usan las fotos (ver `codigo_curso: determinarCodigoCursoServidor(...)`
    // en server.ts). O sea que todo pedido hecho por una familia real, entrando con su código
    // secreto (el único camino que de verdad desbloquea fotos), quedaba con un `curso_codigo`
    // que jamás iba a matchear ninguna fila de `fotos` — el HD nunca se podía armar. Ahora se
    // deriva siempre de grado/turno/división, igual que ya se hacía para los hermanos en el
    // carrito multi-hijo (ver `itemsOtros` en `handleCompletarPagoMultiple`, unas líneas más
    // abajo, que nunca tuvo este bug).
    const codCurso = determinarCodigoParaInscripcion({ grado, turno, division });

    // Carrito multi-hijo ("el cliente debe poder hacer multiple pedido en una sola sesion, un
    // solo pago" — pedido de Pablo 2026-09-16): además del hijo activo ahora mismo, puede haber
    // hermanos con su selección ya guardada (ver seleccionarHijo, más arriba). Si hay más de uno
    // en total se registran todos juntos y se cobran en un solo checkout combinado; si hay uno
    // solo, sigue exactamente el camino de siempre (una fila, un pago) sin ningún cambio.
    const otrosHijosCarrito = valoresDelCarrito(carritoHijos).filter(
      (c) => c.hijoId !== hijoSeleccionadoId && c.completo
    );

    if (otrosHijosCarrito.length > 0) {
      await handleCompletarPagoMultiple(otrosHijosCarrito, numLista, codCurso);
      return;
    }

    const { pedido: nuevoPedido, sincronizado, errorSincronizacion } = await registrarPedidoDesdePortal({
      colegioId: selectedColegio?.id || 'col-general',
      colegioNombre: selectedColegio?.nombre || 'Colegio Escolar',
      cursoCodigo: codCurso,
      grado: grado || 'Sala 3',
      division: division || 'Única',
      turno: turno || 'Mañana',
      alumnoNombre: nombreAlumno || 'Alumno Escolar',
      alumnoNumeroLista: numLista,
      tutorNombre: tutorNombre.trim(),
      tutorTelefono: tutorWhatsapp.trim(),
      tutorEmail: tutorEmail.trim(),
      kitId: selectedKit.id,
      kitNombre: selectedKit.nombre,
      total: total,
      metodoPago: metodoPago,
      fotosSeleccionadas: {
        individualId: fotoSeleccionadaIndividual,
        grupalId: fotoSeleccionadaGrupal,
        docenteId: fotoSeleccionadaDocente,
        otrasIds: fotosSueltasSeleccionadas,
      },
      copiasExtras: {
        carpetasExtras: extraCarpetas,
        individual15x21: extraCarpetas,
        grupal20x30: extraCarpetas,
        docente15x21: extraCarpetas,
        otras15x21: fotosSueltasSeleccionadas.length,
      },
      fotosDisponibles,
    });

    setNumeroPedido(nuevoPedido.id);
    setPedidoGenerado(nuevoPedido);

    // Auditoría 2026-09-09 (revisión a fondo): si el pedido no se pudo confirmar en el
    // servidor (Supabase), se corta acá y NUNCA se avanza a Mercado Pago — de lo contrario
    // la familia podría llegar a pagar un pedido que no quedó registrado en ningún lado.
    if (!sincronizado) {
      setPagoError(
        errorSincronizacion
          ? `No pudimos registrar tu pedido antes de continuar con el pago (${errorSincronizacion}). Por favor, intentá nuevamente en unos segundos. Si el problema persiste, contactanos antes de pagar.`
          : 'No pudimos registrar tu pedido antes de continuar con el pago. Por favor, intentá nuevamente en unos segundos. Si el problema persiste, contactanos antes de pagar.'
      );
      setIsProcessingPayment(false);
      setStep(5);
      return;
    }

    if (metodoPago === 'mercadopago') {
      try {
        const res = await crearPreferenciaMercadoPago({
          pedidoId: nuevoPedido.supabaseId || nuevoPedido.id,
          kitId: selectedKit.id,
          kitNombre: selectedKit.nombre,
          alumnoNombre: nombreAlumno.trim() || 'Alumno',
          colegioNombre: selectedColegio?.nombre || 'Colegio',
          cursoCodigo: codCurso,
          total: total,
          carpetasExtras: extraCarpetas,
          // Auditoría 2026-09-20 (bug real, CRÍTICO): ver comentario en generarLinkDePago.
          cantidadFotosSueltas: fotosSueltasSeleccionadas.length,
          tutorNombre: tutorNombre.trim() || 'Tutor',
          tutorEmail: tutorEmail.trim(),
          tutorTelefono: tutorWhatsapp.trim() || undefined,
        });

        if (res.initPoint) {
          setMpRedirectUrl(res.initPoint);
          setIsProcessingPayment(false);
          setStep(5);
          // Redirección directa al checkout oficial de Mercado Pago
          window.location.href = res.initPoint;
          return;
        } else {
          setPagoError(res.error || 'No se pudo generar la preferencia de Mercado Pago.');
          setIsProcessingPayment(false);
          setStep(5);
        }
      } catch (err: any) {
        setPagoError(err?.message || 'Error de conexión con el servidor de pagos.');
        setIsProcessingPayment(false);
        setStep(5);
      }
    } else if (metodoPago === 'nave') {
      try {
        const res = await crearIntencionPagoNave({
          pedidoId: nuevoPedido.supabaseId || nuevoPedido.id,
          kitId: selectedKit.id,
          kitNombre: selectedKit.nombre,
          alumnoNombre: nombreAlumno.trim() || 'Alumno',
          colegioNombre: selectedColegio?.nombre || 'Colegio',
          carpetasExtras: extraCarpetas,
          // Auditoría 2026-09-20 (bug real, CRÍTICO): ver comentario en generarLinkDePago.
          cantidadFotosSueltas: fotosSueltasSeleccionadas.length,
          tutorNombre: tutorNombre.trim() || 'Tutor',
          tutorEmail: tutorEmail.trim(),
          tutorTelefono: tutorWhatsapp.trim() || undefined,
        });

        if (res.checkoutUrl) {
          setNaveRedirectUrl(res.checkoutUrl);
          setIsProcessingPayment(false);
          setStep(5);
          // Redirección directa al checkout oficial de Nave
          window.location.href = res.checkoutUrl;
          return;
        } else {
          setPagoError(res.error || 'No se pudo generar la intención de pago de Nave.');
          setIsProcessingPayment(false);
          setStep(5);
        }
      } catch (err: any) {
        setPagoError(err?.message || 'Error de conexión con el servidor de pagos.');
        setIsProcessingPayment(false);
        setStep(5);
      }
    } else {
      // Transferencia bancaria o efectivo: queda en estado 'pendiente' y pasa a la pantalla de confirmación
      setIsProcessingPayment(false);
      setStep(5);
    }
  };

  /**
   * Auditoría 2026-09-16 (pedido de Pablo: "el cliente debe poder hacer multiple pedido en una
   * sola sesion, un solo pago"): arma UN pedido por cada hijo del carrito (el/la que está
   * activo/a ahora + los que ya quedaron guardados al cambiar de hermano) y los registra todos
   * juntos con registrarCarritoMultipleDesdePortal — todos comparten un mismo "grupoPagoId" que
   * después se usa para generar un único checkout de Mercado Pago o Nave por el total combinado.
   * Sólo la llama handleCompletarPago, y sólo cuando hay más de un hijo en el carrito — con un
   * solo hijo se sigue usando el camino de siempre (arriba), sin ningún cambio.
   */
  const handleCompletarPagoMultiple = async (
    otrosHijosCarrito: SeleccionCarritoHijo[],
    numListaActivo: number,
    codCursoActivo: string
  ) => {
    try {
      const itemActivo: ItemCarritoHijo = {
        colegioId: selectedColegio?.id || 'col-general',
        colegioNombre: selectedColegio?.nombre || 'Colegio Escolar',
        cursoCodigo: codCursoActivo,
        grado: grado || 'Sala 3',
        division: division || 'Única',
        turno: turno || 'Mañana',
        alumnoNombre: nombreAlumno || 'Alumno Escolar',
        alumnoNumeroLista: numListaActivo,
        kitId: selectedKit.id,
        kitNombre: selectedKit.nombre,
        metodoPago,
        fotosSeleccionadas: {
          individualId: fotoSeleccionadaIndividual,
          grupalId: fotoSeleccionadaGrupal,
          docenteId: fotoSeleccionadaDocente,
          otrasIds: fotosSueltasSeleccionadas,
        },
        copiasExtras: {
          carpetasExtras: extraCarpetas,
          individual15x21: extraCarpetas,
          grupal20x30: extraCarpetas,
          docente15x21: extraCarpetas,
          otras15x21: fotosSueltasSeleccionadas.length,
        },
      };

      const itemsOtros: ItemCarritoHijo[] = otrosHijosCarrito.map((c) => ({
        // Hoy el Código Familiar sólo agrupa hermanos del mismo colegio — se usa el colegio
        // activo como respaldo si por algún motivo el hermano no trajo el suyo propio.
        colegioId: selectedColegio?.id || 'col-general',
        colegioNombre: c.colegioNombre || selectedColegio?.nombre || 'Colegio Escolar',
        cursoCodigo: determinarCodigoParaInscripcion({
          grado: c.grado || '',
          turno: c.turno || '',
          division: c.division || '',
        }),
        grado: c.grado || 'Sala 3',
        division: c.division || 'Única',
        turno: c.turno || 'Mañana',
        alumnoNombre: c.nombreCompleto || 'Alumno Escolar',
        alumnoNumeroLista: Math.floor(1 + Math.random() * 25),
        kitId: c.kitId,
        kitNombre: c.kitNombre,
        metodoPago,
        fotosSeleccionadas: {
          individualId: c.fotoSeleccionadaIndividual,
          grupalId: c.fotoSeleccionadaGrupal,
          docenteId: c.fotoSeleccionadaDocente,
          otrasIds: c.fotosSueltasSeleccionadas,
        },
        copiasExtras: {
          carpetasExtras: c.extraCarpetas,
          individual15x21: c.extraCarpetas,
          grupal20x30: c.extraCarpetas,
          docente15x21: c.extraCarpetas,
          otras15x21: c.fotosSueltasSeleccionadas.length,
        },
      }));

      const todosLosItems = [...itemsOtros, itemActivo];

      const resultadoCarrito = await registrarCarritoMultipleDesdePortal({
        tutorNombre: tutorNombre.trim(),
        tutorTelefono: tutorWhatsapp.trim(),
        tutorEmail: tutorEmail.trim(),
        items: todosLosItems,
      });

      // Un pedido "de mentira" (nunca se manda a Supabase) sólo para que la pantalla de
      // confirmación (Paso 5) tenga algo coherente que mostrar — nombre de todos los hijos,
      // total combinado — aunque en la base real sean N filas separadas en "pedidos", no una.
      const pedidoSintetico: PedidoEscolarCompleto = {
        id: resultadoCarrito.pedidoFriendlyIds[0] || resultadoCarrito.pedidoIds[0] || `GRUPO-${Date.now()}`,
        supabaseId: resultadoCarrito.pedidoIds[0],
        grupoPagoId: resultadoCarrito.grupoPagoId,
        fecha: new Date().toLocaleString('es-AR'),
        colegioId: selectedColegio?.id || 'col-general',
        colegioNombre: selectedColegio?.nombre || 'Colegio Escolar',
        cursoCodigo: codCursoActivo,
        grado,
        division,
        turno,
        alumnoNumeroLista: numListaActivo,
        alumnoNombre: todosLosItems.map((it) => it.alumnoNombre).join(', '),
        codigoAlumno: '',
        tutorNombre: tutorNombre.trim(),
        tutorTelefono: tutorWhatsapp.trim(),
        tutorEmail: tutorEmail.trim(),
        kitId: selectedKit.id,
        kitNombre: `${todosLosItems.length} hijos/as`,
        total: resultadoCarrito.total || total,
        metodoPago,
        estadoPago: 'pendiente',
        estadoEntrega: 'en_espera',
        fotosSeleccionadas: { individualId: '', grupalId: '' },
        // Auditoría 2026-09-22 (bug real, BAJA, cosmético): sin esto, el cartel de "¡N carpeta(s)
        // extra(s) generada(s)!" del Paso 5 nunca aparecía para un carrito multi-hijo, aunque
        // alguno de los hermanos sí hubiera pedido copias extra — quedaba en blanco porque
        // `copiasExtras` nunca se completaba acá (a diferencia del pedido de un solo hijo).
        copiasExtras: {
          carpetasExtras: todosLosItems.reduce((acc, it) => acc + (it.copiasExtras?.carpetasExtras || 0), 0),
        },
        archivosParaLaboratorio: [],
        linkDescargaHD: '',
        emailEnviado: false,
      };
      setPedidoGenerado(pedidoSintetico);
      // Auditoría 2026-09-17 (Pablo: "por que tiene esos numeros tan extraños y feos?"): antes
      // acá se mostraban los uuid crudos de la base ("43a0fbe5-0324-45c4-b699-...") pegados con
      // comas — ahora se usa un "IFS-2026-XXXX" por cada hijo, igual que en el camino de un
      // solo hijo (ver registrarCarritoMultipleDesdePortal).
      setNumeroPedido(resultadoCarrito.pedidoFriendlyIds.join(', ') || resultadoCarrito.pedidoIds.join(', ') || pedidoSintetico.id);

      // Auditoría 2026-09-09 (mismo criterio que el camino de un solo hijo): si el carrito no se
      // pudo confirmar en el servidor, se corta acá y nunca se avanza al pago combinado.
      if (!resultadoCarrito.sincronizado) {
        setPagoError(
          resultadoCarrito.errorSincronizacion
            ? `No pudimos registrar tus pedidos antes de continuar con el pago (${resultadoCarrito.errorSincronizacion}). Por favor, intentá nuevamente en unos segundos. Si el problema persiste, contactanos antes de pagar.`
            : 'No pudimos registrar tus pedidos antes de continuar con el pago. Por favor, intentá nuevamente en unos segundos. Si el problema persiste, contactanos antes de pagar.'
        );
        setIsProcessingPayment(false);
        setStep(5);
        return;
      }

      const itemsParaPreferencia = todosLosItems.map((item, idx) => ({
        pedidoId: resultadoCarrito.pedidoIds[idx] || '',
        kitId: item.kitId,
        kitNombre: item.kitNombre,
        alumnoNombre: item.alumnoNombre,
        colegioNombre: item.colegioNombre,
        carpetasExtras: item.copiasExtras?.carpetasExtras || 0,
        // Auditoría 2026-09-20 (bug real, CRÍTICO): ver comentario en generarLinkDePago — mismo
        // problema acá, por hijo, para el carrito multi-hijo (Mercado Pago y Nave combinados).
        cantidadFotosSueltas: item.copiasExtras?.otras15x21 || 0,
      }));

      if (metodoPago === 'mercadopago') {
        const res = await crearPreferenciaMercadoPagoMultiple({
          grupoPagoId: resultadoCarrito.grupoPagoId,
          items: itemsParaPreferencia,
          tutorNombre: tutorNombre.trim() || 'Tutor',
          tutorEmail: tutorEmail.trim(),
          tutorTelefono: tutorWhatsapp.trim() || undefined,
        });
        if (res.initPoint) {
          setMpRedirectUrl(res.initPoint);
          setIsProcessingPayment(false);
          setStep(5);
          window.location.href = res.initPoint;
          return;
        }
        setPagoError(res.error || 'No se pudo generar la preferencia combinada de Mercado Pago.');
        setIsProcessingPayment(false);
        setStep(5);
      } else if (metodoPago === 'nave') {
        const res = await crearIntencionPagoNaveMultiple({
          grupoPagoId: resultadoCarrito.grupoPagoId,
          items: itemsParaPreferencia,
          tutorNombre: tutorNombre.trim() || 'Tutor',
          tutorEmail: tutorEmail.trim(),
          tutorTelefono: tutorWhatsapp.trim() || undefined,
        });
        if (res.checkoutUrl) {
          setNaveRedirectUrl(res.checkoutUrl);
          setIsProcessingPayment(false);
          setStep(5);
          window.location.href = res.checkoutUrl;
          return;
        }
        setPagoError(res.error || 'No se pudo generar la intención de pago combinada de Nave.');
        setIsProcessingPayment(false);
        setStep(5);
      } else {
        // Transferencia bancaria o efectivo: todos los pedidos del carrito quedan en
        // 'pendiente_pago' y se pasa a la pantalla de confirmación.
        setIsProcessingPayment(false);
        setStep(5);
      }
    } catch (err: any) {
      setPagoError(err?.message || 'Error de conexión con el servidor de pagos.');
      setIsProcessingPayment(false);
      setStep(5);
    }
  };

  // Tracking query handler.
  // Auditoría 2026-09-09 (revisión a fondo): antes esta búsqueda miraba únicamente el
  // localStorage del navegador — una familia que consultara desde otro dispositivo (o que
  // hubiera borrado los datos de este) no encontraba su pedido, aunque estuviera pagado y
  // guardado en Supabase. Ahora se consulta primero al servidor (datos reales); el localStorage
  // queda sólo como respaldo si la consulta al servidor falla (por ejemplo, sin conexión).
  const handleConsultarSeguimiento = async (e?: FormEvent, queryOverride?: string) => {
    if (e) e.preventDefault();
    setTrackingError('');
    const query = (queryOverride ?? trackingQuery).trim().toUpperCase();
    if (!query) {
      setTrackingError('Por favor ingresá tu número de pedido o teléfono');
      return;
    }

    setBuscandoSeguimiento(true);
    try {
      const pedidoServidor = await buscarPedidoPorSeguimiento(query);
      if (pedidoServidor) {
        // Auditoría 2026-09 (bug reportado por Pablo, pedido IFS-2026-3330): un pedido
        // 'pendiente_pago' (por ejemplo, pagado por transferencia y todavía no confirmado)
        // quedaba con paso:2, y el paso 2 del stepper de abajo ("2. Pago") se pinta en verde
        // y dice "Acreditado" para cualquier pasoActual >= 2 — es decir, esta pantalla mostraba
        // "Pago: Acreditado" arriba mientras más abajo (y en la pantalla de confirmación del
        // pedido) se explicaba correctamente que el pago seguía pendiente. Un pedido sin pagar
        // no puede haber completado el paso "Pago", así que ahora se queda en paso:1 (sólo
        // "Pedido" completo) hasta que el estado real sea 'pagado' o 'entregado'.
        const infoEstado = {
          pendiente_pago: { texto: 'Pendiente de Acreditación del Pago', paso: 1, descarga: false },
          pagado: { texto: 'En Laboratorio Fotográfico', paso: 3, descarga: true },
          entregado: { texto: 'Entregado en la Institución', paso: 4, descarga: true },
          cancelado: { texto: 'Pedido Cancelado', paso: 0, descarga: false },
        }[pedidoServidor.estado] || { texto: 'Pendiente de Acreditación del Pago', paso: 1, descarga: false };

        setSearchedOrder({
          id: pedidoServidor.id,
          colegio: pedidoServidor.colegio,
          alumno: `${pedidoServidor.alumno} (${pedidoServidor.grado} ${pedidoServidor.division})`,
          tutor: pedidoServidor.tutor,
          telefono: pedidoServidor.telefono,
          kit: pedidoServidor.kit,
          total: pedidoServidor.total,
          fecha: pedidoServidor.fecha ? new Date(pedidoServidor.fecha).toLocaleDateString('es-AR') : '',
          estado: pedidoServidor.estado,
          estadoTexto: infoEstado.texto,
          descripcionEstado:
            pedidoServidor.estado === 'cancelado'
              ? 'Este pedido fue cancelado. Si creés que es un error, escribinos por email o desde el formulario de Consultas del sitio.'
              : pedidoServidor.estado === 'pendiente_pago'
              ? 'Todavía estamos esperando la acreditación de tu pago (por ejemplo, la confirmación de la transferencia bancaria). En cuanto se acredite, tus fotos pasan a laboratorio para el revelado químico profesional en papel satinado 260g y corte computarizado.'
              : 'Tus fotos se encuentran en proceso de revelado químico profesional en papel satinado 260g y corte computarizado.',
          pasoActual: infoEstado.paso,
          entregaEstimada: 'Entrega en el colegio coordinada con la dirección',
          descargaLista: infoEstado.descarga,
          linkDescargaHD: pedidoServidor.linkDescargaHD,
        });
        return;
      }
    } catch (err) {
      if (err instanceof ErrorLimiteBusqueda) {
        setSearchedOrder(null);
        setTrackingError(err.message);
        setBuscandoSeguimiento(false);
        return;
      }
      console.warn('Error al consultar el pedido en el servidor, se intenta con datos locales:', err);
    } finally {
      setBuscandoSeguimiento(false);
    }

    // Respaldo: búsqueda en los pedidos guardados en este navegador (por ejemplo, sin conexión)
    const pedidosRegistrados = obtenerPedidosGuardados();
    const cleanNumber = query.replace(/\D/g, '');
    // String(...): pedidos guardados por versiones viejas del sitio pueden no traer estos campos.
    const encontradoEnDb = pedidosRegistrados.find(
      (p) => String(p.id || '').toUpperCase().includes(query) || (cleanNumber.length >= 6 && String(p.tutorTelefono || '').includes(cleanNumber))
    );

    if (encontradoEnDb) {
      // Auditoría 2026-09-23 (bug real): este respaldo mostraba SIEMPRE "En laboratorio" y la
      // descarga como lista, aunque el pedido guardado en el navegador no estuviera pagado. Ahora
      // refleja el estado de pago que se conoce localmente.
      const pagado = encontradoEnDb.estadoPago === 'aprobado';
      const rechazado = encontradoEnDb.estadoPago === 'rechazado';
      setSearchedOrder({
        id: encontradoEnDb.id,
        colegio: encontradoEnDb.colegioNombre,
        alumno: `${encontradoEnDb.alumnoNombre || ''} (${encontradoEnDb.grado || ''} ${encontradoEnDb.division || ''})`,
        tutor: encontradoEnDb.tutorNombre,
        telefono: encontradoEnDb.tutorTelefono,
        kit: encontradoEnDb.kitNombre,
        total: Number(encontradoEnDb.total) || 0,
        fecha: String(encontradoEnDb.fecha || '').split(' ')[0],
        estado: rechazado ? 'cancelado' : pagado ? encontradoEnDb.estadoEntrega : 'pendiente_pago',
        estadoTexto: rechazado
          ? 'Pago rechazado'
          : !pagado
          ? 'Pendiente de Acreditación del Pago'
          : encontradoEnDb.estadoEntrega === 'entregado'
          ? 'Entregado en la Institución'
          : encontradoEnDb.estadoEntrega === 'listo_descarga'
          ? 'Descarga Digital HD Disponible'
          : 'En Laboratorio Fotográfico',
        descripcionEstado: pagado
          ? 'Tus fotos se encuentran en proceso de revelado químico profesional en papel satinado 260g y corte computarizado.'
          : 'No pudimos confirmar el estado con el servidor. Estos son los datos guardados en este dispositivo; si ya pagaste, volvé a consultar en unos minutos.',
        pasoActual: pagado ? 3 : rechazado ? 0 : 1,
        entregaEstimada: 'Entrega en el colegio coordinada con la dirección',
        descargaLista: pagado && Boolean(encontradoEnDb.linkDescargaHD),
        linkDescargaHD: encontradoEnDb.linkDescargaHD,
      });
      return;
    }

    // Si no se encuentra ni en el servidor ni en los pedidos guardados de este navegador
    setSearchedOrder(null);
    setTrackingError('No se encontró ningún pedido registrado con ese número o teléfono. Verificá los datos ingresados.');
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-0 sm:p-4 md:p-6 animate-in fade-in duration-200">
      {/* Mobile: ficha a pantalla completa (sin bordes redondeados ni margen) para aprovechar
          todo el alto disponible y scrollear menos. Desde sm: vuelve a ser el modal centrado
          de siempre, sin ningún cambio para tablet.
          Auditoría 2026-09-21 (pedido de Pablo: "sobra tanto espacio en la pantalla que se
          podría aprovechar para no tener que scrollear tanto" en la galería del Paso 2, en
          escritorio): en pantallas grandes el modal se quedaba fijo en max-w-5xl (1024px) sin
          importar cuánto más ancho tuviera la ventana — todo ese espacio de más quedaba vacío a
          los costados en vez de mostrar más fotos por fila. Desde "xl" (≥1280px) ahora usa hasta
          1280px de ancho; combinado con las 4 columnas de fotos por fila desde ese mismo
          breakpoint (ver el grid de la grilla de fotos, más abajo), entran más tomas por fila y
          hacen falta menos filas para ver la galería completa. Por debajo de "xl" (tablet y
          celular) el ancho no cambió.
          Auditoría 2026-09-22 (pedido de Pablo, viendo el Paso 1 con la familia ya identificada:
          esa pantalla es sólo un título chico + una tarjeta angosta, y quedaba flotando con
          muchísimo espacio vacío a los costados con el ancho pensado para la galería del Paso 2).
          El Paso 1 (modo "pedido") vuelve a usar el ancho angosto de siempre; los demás pasos
          conservan el ancho ampliado de arriba. */}
      <div className={`relative w-full bg-white rounded-none sm:rounded-3xl shadow-2xl border-0 sm:border border-slate-200 overflow-hidden flex flex-col h-full sm:h-auto sm:max-h-[95vh] ${modalMode === 'pedido' && step === 1 ? 'max-w-3xl' : 'max-w-5xl xl:max-w-7xl'}`}>
        {/* Top Modal Bar */}
        <div className="px-3 py-3 sm:px-6 sm:py-4 bg-slate-900 text-white flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <ViewfinderFocusIcon className="w-8 h-8 shrink-0" theme="dark" />
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-base font-extrabold font-['Outfit'] tracking-tight">
                    Retrato<span className="text-amber-400">Escolar</span>
                  </span>
                  <span className="text-[10px] bg-slate-800 text-amber-400 font-bold px-2 py-0.5 rounded border border-slate-700">
                    Portal de Familias
                  </span>
                </div>
                <p className="text-xs text-slate-400 truncate">
                  {selectedColegio ? `${selectedColegio.nombre} · Ciclo 2026` : 'retratoescolar.com.ar · Ciclo Escolar 2026'}
                </p>
              </div>
            </div>

            {/* Close button: on mobile it lives here, next to the brand, so it never gets pushed off-screen by the tabs below */}
            <button
              onClick={onClose}
              className="sm:hidden p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Tab switch between order and tracking */}
            <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs flex-1 sm:flex-initial">
              <button
                type="button"
                onClick={() => setModalMode('pedido')}
                className={`flex-1 sm:flex-initial text-center px-3 py-2.5 sm:py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  modalMode === 'pedido'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Ver Fotos / Comprar
              </button>
              <button
                type="button"
                onClick={() => {
                  setModalMode('seguimiento');
                }}
                className={`flex-1 sm:flex-initial text-center px-3 py-2.5 sm:py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
                  modalMode === 'seguimiento'
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'text-slate-300 hover:text-white'
                }`}
              >
                Consultar Mi Pedido
              </button>
            </div>

            {/* Step indicator breadcrumb (only in pedido mode) */}
            {modalMode === 'pedido' && (
              <div className="hidden lg:flex items-center gap-2 text-xs font-semibold text-slate-400">
                <span className={step >= 1 ? 'text-amber-400 font-bold' : ''}>1. Alumno</span>
                <span>›</span>
                <span className={step >= 2 ? 'text-amber-400 font-bold' : ''}>2. Galería</span>
                <span>›</span>
                <span className={step >= 3 ? 'text-amber-400 font-bold' : ''}>3. Kit</span>
                <span>›</span>
                <span className={step >= 4 ? 'text-amber-400 font-bold' : ''}>4. Pago</span>
              </div>
            )}

            {/* Close button: on sm+ it stays in its original spot on the right */}
            <button
              onClick={onClose}
              className="hidden sm:inline-flex p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        {/* Auditoría 2026-09-22: padding vertical reducido (antes p-5 sm:p-8) para ganar algo más
            de alto disponible en pantalla y scrollear un poco menos en escritorio — ver también el
            bloque sticky del Paso 2 más abajo, que compensa este mismo valor para poder pegarse
            al borde superior real de esta zona con scroll.
            Auditoría 2026-09-22 (bis, pedido de Pablo: "hay un espacio transparente que se podría
            eliminar, se nota porque pasa la barra azul por detrás"): el fondo de esta zona tenía
            50% de opacidad (bg-slate-50/50) en vez de sólido. Con el modal superpuesto sobre un
            fondo oscuro desenfocado (backdrop-blur), cualquier hueco de esta zona dejaba pasar ese
            fondo oscuro. Ahora es 100% opaco (bg-slate-50, sin "/50"). */}
        <div className="overflow-y-auto p-4 sm:p-6 flex-1 bg-slate-50">
          {/* TRACKING TOOL VIEW */}
          {modalMode === 'seguimiento' && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200">
              <div className="text-center space-y-2">
                <div className="w-12 h-12 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center mx-auto mb-2">
                  <Package className="w-6 h-6" />
                </div>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit']">
                  Consultar Estado de Mi Pedido
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 max-w-lg mx-auto">
                  Ingresá el número de pedido provisto al momento del pago o tu número de WhatsApp para conocer el estado en tiempo real.
                </p>
              </div>

              {/* Search Box */}
              <div className="bg-white p-3 rounded-2xl border border-slate-200 shadow-sm max-w-xl mx-auto">
                <form onSubmit={handleConsultarSeguimiento} className="flex gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={trackingQuery}
                      onChange={(e) => setTrackingQuery(e.target.value)}
                      placeholder="Ingresá tu N° de pedido que te enviamos por email..."
                      className="w-full pl-10 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={buscandoSeguimiento}
                    className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer shrink-0 shadow-xs disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {buscandoSeguimiento ? 'Buscando...' : 'Consultar'}
                  </button>
                </form>

                {trackingError && (
                  <p className="text-[11px] text-red-600 mt-2 text-left px-2">{trackingError}</p>
                )}
              </div>

              {/* Order Result Card */}
              {searchedOrder && (
                <div className="bg-white rounded-2xl border border-slate-200 p-6 shadow-md text-left space-y-6 animate-in zoom-in-95 duration-150">
                  {/* Card Header */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-4 border-b border-slate-100 gap-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono font-bold px-2 py-0.5 rounded bg-slate-900 text-amber-400">
                          {searchedOrder.id}
                        </span>
                        <span className="text-xs text-slate-400">Fecha: {searchedOrder.fecha}</span>
                      </div>
                      <h4 className="text-lg font-bold text-slate-900 mt-1 font-['Outfit']">
                        {searchedOrder.alumno}
                      </h4>
                      <p className="text-xs text-slate-600">{searchedOrder.colegio}</p>
                    </div>

                    <div className="text-left sm:text-right">
                      <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400 block">
                        Kit Seleccionado
                      </span>
                      <span className="text-xs font-bold text-slate-900">{searchedOrder.kit}</span>
                      <span className="text-xs font-black text-amber-600 block mt-0.5">
                        ${(Number(searchedOrder.total) || 0).toLocaleString('es-AR')} ARS
                      </span>
                    </div>
                  </div>

                  {/* 4-Step Progress Tracker */}
                  <div className="space-y-3">
                    <p className="text-xs font-bold uppercase tracking-wider text-slate-500">
                      Progreso de Producción
                    </p>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                      <div className={`p-3 rounded-xl border text-left ${searchedOrder.pasoActual >= 1 ? 'bg-emerald-50/60 border-emerald-300' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                        <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>1. Pedido</span>
                        </div>
                        <p className="text-[10px] text-slate-600">Registrado online</p>
                      </div>

                      <div className={`p-3 rounded-xl border text-left ${searchedOrder.pasoActual >= 2 ? 'bg-emerald-50/60 border-emerald-300' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                        <div className={`flex items-center gap-1.5 font-bold text-xs mb-1 ${searchedOrder.pasoActual >= 2 ? 'text-emerald-700' : 'text-slate-500'}`}>
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>2. Pago</span>
                        </div>
                        <p className="text-[10px] text-slate-600">{searchedOrder.pasoActual >= 2 ? 'Acreditado' : 'Pendiente'}</p>
                      </div>

                      <div className={`p-3 rounded-xl border text-left ${searchedOrder.pasoActual >= 3 ? 'bg-amber-50/80 border-amber-400' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                        <div className="flex items-center gap-1.5 text-amber-800 font-bold text-xs mb-1">
                          <Clock className="w-3.5 h-3.5 text-amber-600" />
                          <span>3. Laboratorio</span>
                        </div>
                        <p className="text-[10px] text-slate-600">Revelado químico 260g</p>
                      </div>

                      <div className={`p-3 rounded-xl border text-left ${searchedOrder.pasoActual >= 4 ? 'bg-emerald-50/60 border-emerald-300' : 'bg-slate-50 border-slate-200 opacity-60'}`}>
                        <div className="flex items-center gap-1.5 text-slate-800 font-bold text-xs mb-1">
                          <Truck className="w-3.5 h-3.5 text-slate-600" />
                          <span>4. Entrega</span>
                        </div>
                        <p className="text-[10px] text-slate-600">Sobre cerrado en escuela</p>
                      </div>
                    </div>
                  </div>

                  {/* Status Detail Banner */}
                  <div className="p-4 bg-amber-50/60 rounded-xl border border-amber-200 text-xs space-y-1">
                    <p className="font-bold text-amber-950 flex items-center gap-2">
                      <span className="w-2 h-2 rounded-full bg-amber-500 animate-pulse" />
                      <span>{searchedOrder.estadoTexto}</span>
                    </p>
                    <p className="text-slate-700">{searchedOrder.descripcionEstado}</p>
                    <p className="text-[11px] font-semibold text-amber-800 pt-1">
                      {searchedOrder.entregaEstimada}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="pt-2 flex flex-col sm:flex-row gap-3 items-center justify-between border-t border-slate-100">
                    {searchedOrder.descargaLista && searchedOrder.linkDescargaHD && (
                      <a
                        href={searchedOrder.linkDescargaHD}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full sm:w-auto px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5 text-amber-400" />
                        <span>Descargar Archivos Digitales HD</span>
                      </a>
                    )}

                    <div className="flex gap-2 w-full sm:w-auto">
                      {/* Auditoría 2026-09-18 (pedido de Pablo): se sacó "Consultar por
                          WhatsApp" — las familias no deben tener ningún punto de contacto por
                          WhatsApp en la web, solo por email o el sistema de mensajería propio
                          del sitio (Consultas). Auditoría 2026-09-18 (reporte de Pablo, mismo
                          día): un mailto: no hace nada visible si el navegador no tiene un
                          cliente de correo configurado — Pablo lo probó y "no se abre nada,
                          solo vuelve a la web". Ahora lleva directo al formulario de Consultas
                          del sitio (con los datos del pedido precargados), que sí manda un
                          mensaje real. Ver src/utils/consultaPrefill.ts. */}
                      <button
                        type="button"
                        onClick={() =>
                          irAConsultasConDatos(
                            {
                              nombre: searchedOrder.tutor || '',
                              // El servidor devuelve el teléfono enmascarado (***1234) desde el 23/9.
                              telefono: searchedOrder.telefono && !searchedOrder.telefono.startsWith('***') ? searchedOrder.telefono : '',
                              colegio: searchedOrder.colegio || '',
                              numeroPedido: searchedOrder.id || '',
                              asunto: 'Consulta sobre las fotos de mi hijo/a',
                              mensaje: `Hola, tengo una consulta sobre mi pedido ${searchedOrder.id} (${searchedOrder.alumno}).`,
                            },
                            onClose
                          )
                        }
                        className="flex-1 sm:flex-initial px-4 py-2.5 bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2 cursor-pointer"
                      >
                        <Mail className="w-3.5 h-3.5" />
                        <span>Consultar por Email</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setModalMode('pedido')}
                        className="px-4 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs font-semibold rounded-xl transition-colors cursor-pointer"
                      >
                        Ir a Comprar Fotos
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 1: School & Student Selection (ORDER FLOW) */}
          {modalMode === 'pedido' && step === 1 && (
            <div className="max-w-3xl mx-auto space-y-8 animate-in fade-in duration-200">
              <div className="text-center space-y-2">
                {/* Auditoría 2026-09-22 (pedido de Pablo): con la familia ya identificada en este
                    navegador no hace falta buscar colegio ni ingresar ningún código — ese trabajo
                    ya está hecho. El título y el subtítulo de "buscar/ingresar" quedan sólo para
                    cuando todavía no hay una familia validada. */}
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit']">
                  {familiaActiva ? 'Acceso validado' : 'Buscá tu colegio o ingresá tu código'}
                </h3>
                {!familiaActiva && (
                  <p className="text-xs sm:text-sm text-slate-600">
                    Ingresá con los datos de tu hijo/a para abrir su galería protegida con marca de agua.
                  </p>
                )}
              </div>

              {/* Auditoría 2026-09-22 (pedido de Pablo, tras repaso completo de la pantalla real:
                  "es demasiado! el sistema debe ser extremadamente simple para ingresar"): con la
                  familia ya identificada en este navegador, esta tarjeta de identificación
                  (nombre+DNI+código) y la tarjeta de abajo con los mismos hijos repetidos se
                  mostraban las DOS a la vez, con el código y los datos duplicados. Ahora esta
                  tarjeta sólo aparece mientras la familia todavía no está identificada; apenas se
                  valida (o al reabrir con la sesión ya guardada) desaparece y queda una sola
                  tarjeta abajo con el saludo y el botón para entrar. */}
              {!familiaActiva && (
              <>
              {/* Hero Course Code Access Card */}
              <div className="bg-linear-to-br from-amber-500/10 via-amber-50 to-white rounded-2xl p-5 sm:p-6 border-2 border-amber-300 shadow-sm space-y-4">
                <div className="flex flex-col gap-3">
                  <div className="text-left">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider mb-1">
                      <Key className="w-3 h-3" />
                      Acceso para Familias
                    </span>
                    <h4 className="text-base sm:text-lg font-extrabold text-slate-900 font-['Outfit']">
                      Ingresá con tus datos y el código de tu curso
                    </h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      {/* Auditoría 2026-09-22 (pedido de Pablo): el código lo comparte todo el
                          curso, así que ahora hacen falta también el nombre y DNI del tutor con el
                          que se inscribió la familia, para identificar exactamente a tus hijos. */}
                      El código es el mismo para todo el curso — con tu nombre y DNI identificamos a tu familia y cargamos automáticamente el curso, turno y división.
                    </p>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <input
                      type="text"
                      value={codigoTutorNombreInput}
                      onChange={(e) => {
                        setCodigoTutorNombreInput(e.target.value);
                        setCodigoErrorMsg(null);
                      }}
                      placeholder="Nombre y apellido del tutor"
                      autoComplete="name"
                      className="px-3.5 py-2.5 text-xs sm:text-sm bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 w-full shadow-xs"
                    />
                    <input
                      type="text"
                      inputMode="numeric"
                      value={codigoTutorDniInput}
                      onChange={(e) => {
                        setCodigoTutorDniInput(e.target.value);
                        setCodigoErrorMsg(null);
                      }}
                      placeholder="DNI del tutor (sin puntos)"
                      autoComplete="off"
                      className="px-3.5 py-2.5 text-xs sm:text-sm bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 w-full shadow-xs"
                    />
                  </div>

                  <div className="flex items-center gap-2 w-full sm:w-auto">
                    <input
                      type="text"
                      value={codigoAcceso}
                      onChange={(e) => {
                        setCodigoAcceso(e.target.value);
                        setCodigoErrorMsg(null);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          handleIngresarCodigo();
                        }
                      }}
                      placeholder="Código del curso (Ej: 88BU-M8TF)"
                      className="px-3.5 py-2.5 text-xs sm:text-sm uppercase font-mono font-bold tracking-wider bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 w-full sm:w-48 shadow-xs"
                    />
                    <button
                      type="button"
                      onClick={handleIngresarCodigo}
                      className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white font-bold text-xs rounded-xl shadow-sm cursor-pointer shrink-0 transition-colors flex items-center gap-1.5"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                      <span>Validar</span>
                    </button>
                  </div>
                </div>

                {/* Validation Success Feedback Banner */}
                {codigoValidadoMsg && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-300 rounded-xl text-left flex items-start justify-between gap-3 animate-in fade-in duration-200">
                    <div className="flex items-start gap-2.5">
                      <CheckCheck className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-xs font-bold text-emerald-950">
                          {codigoValidadoMsg}
                        </p>
                        {hijosFamilia.length > 1 ? (
                          <div className="mt-1 space-y-0.5">
                            {hijosFamilia.map((h) => (
                              <p key={h.id} className="text-[11px] text-emerald-800">
                                <span className="font-bold">{h.nombreCompleto}:</span> {h.grado || '—'} · División {h.division || '—'} · Turno {h.turno || '—'}
                              </p>
                            ))}
                            <p className="text-[11px] text-emerald-800">
                              Podés confirmar o cambiar los datos a continuación y seleccionar a cada hijo/a.
                            </p>
                          </div>
                        ) : (
                          <p className="text-[11px] text-emerald-800 mt-0.5">
                            Asignado: {grado} · División {division} · Turno {turno}. Podés confirmar o cambiar los datos a continuación y seleccionar a tu hijo/a.
                          </p>
                        )}
                      </div>
                    </div>
                    <span className="px-2 py-0.5 bg-emerald-200 text-emerald-900 text-[10px] font-extrabold rounded-md uppercase">
                      Activo
                    </span>
                  </div>
                )}

                {/* Error Feedback */}
                {codigoErrorMsg && (
                  <div className="p-3 bg-rose-50 border border-rose-300 rounded-xl text-left flex items-start gap-2 text-rose-800 text-xs animate-in fade-in duration-200">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">{codigoErrorMsg}</p>
                      <p className="text-[11px] text-rose-700 mt-0.5">
                        Si no recordás tu código, solicitá el reenvío por email con el formulario de abajo.
                      </p>
                    </div>
                  </div>
                )}

                {/* Course Code Request Action: queda guardado para el panel admin, no abre WhatsApp */}
                <div className="pt-3 border-t border-amber-200/80 text-left">
                  {solicitudCodigoEnviada ? (
                    <div className="p-4 sm:p-5 bg-emerald-50 border border-emerald-300 rounded-xl flex items-start gap-3">
                      <CheckCheck className="w-6 h-6 text-emerald-700 shrink-0 mt-0.5" />
                      <div>
                        <p className="text-lg font-extrabold text-emerald-950">¡Listo!</p>
                        <p className="text-base leading-7 text-emerald-950 mt-1.5 font-medium">
                          {solicitudCodigoMensaje}
                        </p>
                      </div>
                    </div>
                  ) : !mostrarFormSolicitudCodigo ? (
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                      <div className="text-slate-700 text-xs space-y-0.5">
                        <p className="font-bold text-slate-900 flex items-center gap-1.5">
                          <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                          <span>¿Aún no tenés tu Código de Curso?</span>
                        </p>
                        <p className="text-[11px] text-slate-600 leading-relaxed">
                          Ingresá el email con el que te registraste y te enviaremos nuevamente tu código.
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setMostrarFormSolicitudCodigo(true)}
                        className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 active:scale-98"
                      >
                        <Mail className="w-4 h-4" />
                        <span>Solicitar mi Código</span>
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-2.5">
                      <p className="font-bold text-slate-900 text-xs flex items-center gap-1.5">
                        <Mail className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        <span>Recibí tu código por email</span>
                      </p>
                      <div className="flex flex-col sm:flex-row gap-2">
                        <input
                          type="text"
                          value={solicitudNombre}
                          onChange={(e) => setSolicitudNombre(e.target.value)}
                          placeholder="Tu nombre y apellido"
                          className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 shadow-xs"
                        />
                        <input
                          type="email"
                          value={solicitudContacto}
                          onChange={(e) => setSolicitudContacto(e.target.value)}
                          placeholder="Email usado al registrarte"
                          autoComplete="email"
                          className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 shadow-xs"
                        />
                      </div>
                      {/* Auditoría 2026-09-16 (pedido de Pablo): colegio y alumno ahora se piden
                          acá mismo (y son obligatorios, ver handleEnviarSolicitudCodigo) — antes
                          dependían de pantallas anteriores que esta familia podía no haber
                          completado todavía. */}
                      <div className="flex flex-col sm:flex-row gap-2">
                        <select
                          value={selectedColegio?.id || ''}
                          onChange={(e) => {
                            const colegioElegido = colegios.find((c) => c.id === e.target.value) || null;
                            setSelectedColegio(colegioElegido);
                          }}
                          className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 shadow-xs"
                        >
                          <option value="">Colegio de tu hijo/a</option>
                          {colegios.map((c) => (
                            <option key={c.id} value={c.id}>{c.nombre}</option>
                          ))}
                        </select>
                        <input
                          type="text"
                          value={nombreAlumno}
                          onChange={(e) => setNombreAlumno(e.target.value)}
                          placeholder="Nombre y apellido de tu hijo/a"
                          className="flex-1 px-3.5 py-2.5 text-xs sm:text-sm bg-white border-2 border-amber-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-500 shadow-xs"
                        />
                      </div>
                      {solicitudCodigoError && (
                        <p className="text-[11px] text-rose-700 font-bold flex items-center gap-1">
                          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                          {solicitudCodigoError}
                        </p>
                      )}
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={enviandoSolicitudCodigo}
                          onClick={handleEnviarSolicitudCodigo}
                          className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 disabled:opacity-60 disabled:cursor-not-allowed text-amber-300 hover:text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
                        >
                          <Send className="w-3.5 h-3.5" />
                          <span>{enviandoSolicitudCodigo ? 'Enviando...' : 'Enviar mi código'}</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setMostrarFormSolicitudCodigo(false)}
                          className="px-3 py-2.5 text-slate-500 hover:text-slate-700 font-bold text-xs rounded-xl cursor-pointer"
                        >
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Antes acá había un desplegable para elegir el colegio directamente, sin código.
                  Se sacó: permitía ver fotos reales (con nombre y apellido del alumno) de
                  cualquier sala/turno de cualquier colegio sin identificarse. Ahora la única
                  forma de llegar a la galería es con un código válido (de curso, familiar, o
                  de institución) — recién ahí aparece el formulario de abajo para confirmar
                  los datos del alumno/a. */}
              {!(selectedColegio && codigoValidadoMsg) && (
                <div className="bg-amber-50/70 border border-amber-200/80 rounded-2xl p-5 text-center space-y-1">
                  <p className="text-xs font-bold text-amber-950">
                    Ingresá tu código de curso, familiar o de institución arriba para continuar
                  </p>
                  <p className="text-[11px] text-amber-800">
                    Si no tenés tu código, usá "Solicitar mi Código" más arriba y te lo facilitamos.
                  </p>
                </div>
              )}
              </>
              )}

              {/* Student details form */}
              {selectedColegio && codigoValidadoMsg && (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4 text-left shadow-xs animate-in fade-in duration-150">
                  {familiaActiva ? (
                    // Auditoría 2026-09-22: única tarjeta que ve una familia ya identificada — antes
                    // se sumaba, arriba, una segunda tarjeta con el código+nombre+DNI ya validados y
                    // los mismos hijos repetidos. Encabezado con saludo directo en vez del rótulo
                    // impersonal "Datos del alumno/a en...".
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                      <div>
                        <h4 className="text-lg font-extrabold text-slate-900 font-['Outfit']">
                          ¡Hola, {familiaActiva.padreNombre}!
                        </h4>
                        <p className="text-[11px] text-slate-500">{selectedColegio.nombre}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {onOpenInscripcion && (
                          <button
                            type="button"
                            onClick={() => onOpenInscripcion()}
                            className="text-[11px] text-amber-700 hover:text-amber-800 underline font-semibold cursor-pointer"
                          >
                            Cambiar datos
                          </button>
                        )}
                        <span className="text-slate-300">|</span>
                        <button
                          type="button"
                          onClick={() => {
                            cerrarSesionFamilia();
                            setFamiliaActiva(null);
                            setHijoSeleccionadoId('principal');
                            setCarritoHijos({});
                            setCodigoAcceso('');
                            setCodigoValidadoMsg(null);
                            setCodigoErrorMsg(null);
                            setCodigoSeccionValidado(null);
                            setPedidoExistente(null);
                            setFotosDisponibles([]);
                            setFotoSeleccionadaIndividual('');
                            setFotoSeleccionadaGrupal('');
                            setFotoSeleccionadaDocente('');
                            setFotosSueltasSeleccionadas([]);
                            setTutorNombre('');
                            setTutorWhatsapp('');
                            setTutorEmail('');
                            setNombreAlumno('');
                            setStep(1);
                          }}
                          className="text-[11px] text-rose-600 hover:text-rose-800 underline font-semibold cursor-pointer"
                          title="Cerrar sesión de esta familia"
                        >
                          Cerrar sesión
                        </button>
                      </div>
                    </div>
                  ) : (
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-4 h-4 text-amber-600" />
                      <span>Datos del alumno/a en {selectedColegio.nombre}:</span>
                    </h4>
                  )}

                  {/* Auditoría 2026-09-21 (pedido de Pablo: "esto no sé si los padres deban
                      tocarlo ya que turno/grado/división ya está registrado... a lo sumo debería
                      mostrarlo como info, no como opción, pero de todos sus hijos, no sólo de
                      uno"). Tenía razón: cuando `familiaActiva` está seteado, el único camino real
                      hasta acá fue una família ya ACEPTADA (ver `validarCodigoIngresado` — es el
                      único camino que desbloquea fotos reales), así que estos datos ya vienen
                      confirmados por el equipo fotográfico/padrón, no por lo que tipee la familia
                      acá. Dejarlos editables era engañoso: cambiar el valor en estos inputs nunca
                      tocaba `codigoSeccionValidado` (la llave real que trae las fotos), así que la
                      familia podía "cambiar" el grado en pantalla sin que eso moviera un pelo la
                      galería que se le mostraba — sólo servía para que el pedido quedara
                      registrado con datos que no coinciden con las fotos reales. Ahora, con família
                      verificada, se listan como texto de sólo lectura TODOS los hijos/as (no sólo
                      el que está activo en este momento) — coherente con el selector "Tus hijos/as"
                      de la galería. El formulario editable queda sólo para cuando todavía no hay
                      família verificada (por ejemplo, alguien que sólo reconoció la institución y
                      necesita el código real de su curso). */}
                  {familiaActiva ? (
                    <div className="space-y-2">
                      {hijosFamilia.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {hijosFamilia.map((h) => (
                            <div
                              key={h.id}
                              className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 px-3.5 py-2.5 rounded-xl bg-slate-50 border border-slate-200"
                            >
                              <span className="text-xs font-bold text-slate-900">{h.nombreCompleto}</span>
                              <span className="text-[11px] text-slate-500 font-medium">
                                {h.grado || '—'} "{h.division || '—'}" · Turno {h.turno || '—'}
                              </span>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-xs text-slate-400 italic">Cargando datos confirmados...</p>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 relative">
                      <div className="sm:col-span-2">
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Nombre y Apellido del alumno/a
                        </label>
                        <input
                          type="text"
                          value={nombreAlumno}
                          onChange={(e) => setNombreAlumno(e.target.value)}
                          placeholder="Ej: Benjamín Gómez"
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium"
                        />
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Turno
                        </label>
                        <select
                          value={turno}
                          onChange={(e) => setTurno(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        >
                          {selectedColegio.turnos.map((t) => (
                            <option key={t} value={t}>
                              {t}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          Grado / Sala / Año
                        </label>
                        <select
                          value={grado}
                          onChange={(e) => setGrado(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        >
                          {selectedColegio.grados.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                        </select>
                      </div>

                      <div>
                        <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                          División
                        </label>
                        <select
                          value={division}
                          onChange={(e) => setDivision(e.target.value)}
                          className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                        >
                          {selectedColegio.divisiones.map((d) => (
                            <option key={d} value={d}>
                              División {d}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

                  {/* Auditoría 2026-09-22 (pedido de Pablo, viendo su propia galería con un
                      pedido previo ya hecho): mientras `pedidoExistente` esté seteado (llenado
                      automáticamente por el useEffect de arriba), se muestra este cartel en vez
                      del botón normal — avisa que ya hay un pedido para este alumno/a y deja elegir entre verlo o
                      confirmar que se quiere hacer otro. */}
                  {pedidoExistente ? (
                    <div className="p-4 sm:p-5 bg-amber-50 border-2 border-amber-300 rounded-xl text-left space-y-3 animate-in fade-in duration-150">
                      <div className="flex items-start gap-2.5">
                        <PackageCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                        <div>
                          <p className="text-sm font-extrabold text-amber-950">
                            {nombreAlumno} ya tiene un pedido registrado
                          </p>
                          <p className="text-[11px] text-amber-800 mt-0.5">
                            Pedido <strong>{pedidoExistente.id}</strong> · {pedidoExistente.kit} · ${(Number(pedidoExistente.total) || 0).toLocaleString('es-AR')} ·{' '}
                            {pedidoExistente.estado === 'entregado'
                              ? 'Entregado'
                              : pedidoExistente.estado === 'pagado'
                              ? 'Pagado'
                              : 'Pendiente de pago'}
                          </p>
                        </div>
                      </div>
                      <div className="flex flex-col sm:flex-row gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => {
                            setModalMode('seguimiento');
                            setTrackingQuery(pedidoExistente.id);
                            handleConsultarSeguimiento(undefined, pedidoExistente.id);
                            setPedidoExistente(null);
                          }}
                          className="flex-1 px-4 py-2.5 bg-white hover:bg-amber-100 text-amber-900 border-2 border-amber-400 font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-all flex items-center justify-center gap-1.5"
                        >
                          <Package className="w-4 h-4" />
                          <span>Ver mi pedido</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => setStep(2)}
                          className="flex-1 px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-amber-300 hover:text-white font-bold text-xs rounded-xl shadow-xs cursor-pointer transition-colors flex items-center justify-center gap-1.5"
                        >
                          <span>Sí, quiero hacer otro pedido</span>
                          <ArrowRight className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="pt-2 flex justify-end">
                      <button
                        id="btn-continuar-galeria"
                        onClick={() => setStep(2)}
                        disabled={verificandoPedidoExistente}
                        className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-60 disabled:cursor-not-allowed"
                      >
                        <span>{verificandoPedidoExistente ? 'Verificando...' : 'Abrir Galería de Fotos'}</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Interactive Photo Gallery
              Auditoría 2026-09-22 (bug reportado por Pablo con captura: la barra sticky de este
              paso se veía solapada, a mitad de camino, debajo de "Consultar Estado de Mi Pedido").
              Causa: a esta condición le faltaba exigir también `modalMode === 'pedido'` (a
              diferencia del Paso 1, que sí lo exige). `step` y `modalMode` son dos estados
              independientes — tocar la pestaña "Consultar Mi Pedido" nunca resetea `step`, así
              que una familia que hiciera esa consulta estando parada en el Paso 2 (la galería)
              terminaba viendo los dos pasos renderizados a la vez, uno encima del otro. */}
          {modalMode === 'pedido' && step === 2 && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-200">
              {/* Auditoría 2026-09-22 (cuarto pedido de Pablo sobre esta misma pantalla: "en esas
                  filas sobra espacio para poner todo en una sola"): antes esto eran DOS tarjetas
                  apiladas (datos del alumno arriba, selector de hermanos/as abajo), cada una con su
                  propio padding, borde y texto explicativo — mucho alto para lo poco que aportaba
                  una vez que ya se entendía el uso. Ahora es UNA sola fila compacta: nombre + grado
                  y turno + colegio a la izquierda, botones de hermanos/as al medio (solo si hay más
                  de uno) y el estado de protección + "Cambiar datos" a la derecha. También se
                  corrigió un bug real de esta misma pantalla ("hay un espacio transparente... se
                  nota porque pasa la barra azul por detrás"): el contenedor con scroll tenía el
                  fondo con 50% de opacidad (bg-slate-50/50, ver más abajo en "Modal Scrollable
                  Body"), dejando ver el fondo oscuro y desenfocado de atrás del modal en cualquier
                  hueco — ahora es 100% opaco. */}
              <div className="sticky top-0 z-20 -mx-4 sm:-mx-6 -mt-4 sm:-mt-6 px-4 sm:px-6 pt-0 pb-3 bg-slate-50 shadow-[0_8px_12px_-8px_rgba(15,23,42,0.12)]">
                <div className="bg-white p-2.5 rounded-2xl border border-slate-200 shadow-xs flex flex-wrap items-center gap-x-3 gap-y-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="text-xs font-bold text-slate-900 font-['Outfit'] truncate">
                      {nombreAlumno}
                    </span>
                    <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-full shrink-0 whitespace-nowrap">
                      {grado} "{division}" · {turno}
                    </span>
                  </div>

                  <span className="text-[11px] text-slate-400 truncate hidden md:inline max-w-[200px]">
                    {selectedColegio?.nombre}
                  </span>

                  {/* Selector de hijo/a (Código Familiar): solo se muestra si hay más de uno para
                      elegir — familias de un solo hijo no ven ningún cambio acá. Auditoría
                      2026-09-16: esto es lo que hace real la promesa de "1 solo Código Familiar...
                      alterná entre tus hijos con un solo toque" que ya está en la web (Hero,
                      /proceso, FAQ). */}
                  {hijosFamilia.length > 1 && (
                    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Tus hijos/as en este colegio">
                      {hijosFamilia.map((h) => {
                        // Auditoría 2026-09-16 (pedido de Pablo: "un solo pedido, un solo pago"):
                        // un hijo cuenta como "listo" si ya eligió sus 3 fotos del pack, sea porque
                        // está siendo el activo ahora mismo o porque ya lo armó antes y quedó
                        // guardado en el carrito al cambiar de hermano.
                        const esActivo = hijoSeleccionadoId === h.id;
                        const listoActivo = esActivo && cantidadFotosPackSeleccionadas === 3;
                        const listoGuardado = !esActivo && Boolean(carritoHijos[h.id]?.completo);
                        const listo = listoActivo || listoGuardado;
                        return (
                          <button
                            key={h.id}
                            type="button"
                            onClick={() => seleccionarHijo(h.id)}
                            className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold transition-colors cursor-pointer flex items-center gap-1 whitespace-nowrap ${
                              esActivo
                                ? 'bg-amber-500 text-slate-950 shadow-xs ring-1 ring-amber-600'
                                : 'bg-amber-50 text-amber-900 border border-amber-300 hover:bg-amber-100'
                            }`}
                          >
                            {listo && <CheckCircle2 className={`w-3 h-3 ${esActivo ? 'text-slate-900' : 'text-emerald-600'}`} />}
                            {h.nombreCompleto}
                          </button>
                        );
                      })}
                    </div>
                  )}

                  <div className="flex items-center gap-2 ml-auto shrink-0">
                    <span className="hidden lg:inline-flex items-center gap-1.5 px-2 py-1 rounded-lg bg-amber-500/10 text-amber-900 border border-amber-300/80 text-[10px] font-bold whitespace-nowrap">
                      <Lock className="w-3 h-3 text-amber-700" />
                      {fotosDisponibles.length > 0 ? 'Protegidas' : 'Esperando fotos'}
                    </span>
                    <button
                      onClick={() => setStep(1)}
                      className="text-[11px] text-slate-500 hover:text-slate-800 font-medium cursor-pointer whitespace-nowrap"
                    >
                      Cambiar datos
                    </button>
                  </div>
                </div>
              </div>

              {fotosDisponibles.length === 0 ? (
                <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-6 py-10 text-center shadow-xs">
                  <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-amber-700 shadow-xs ring-1 ring-amber-200">
                    <Mail className="h-6 w-6" />
                  </div>
                  <h3 className="font-['Outfit'] text-xl font-extrabold text-slate-900">
                    Tus fotos todavía no fueron ingresadas
                  </h3>
                  <p className="mx-auto mt-2 max-w-xl text-sm leading-6 text-slate-600">
                    Apenas estén disponibles online, te enviaremos un email a{' '}
                    <strong className="text-slate-900">{tutorEmail || familiaActiva?.email || 'la dirección que registraste'}</strong>.
                    No necesitás volver a registrarte ni revisar la página todos los días.
                  </p>
                  <button
                    type="button"
                    onClick={() => setStep(1)}
                    className="mt-6 inline-flex items-center gap-2 rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 transition-colors hover:bg-slate-50"
                  >
                    <ArrowLeft className="h-4 w-4" />
                    Volver
                  </button>
                </div>
              ) : (
                <>

              {/* 3 Fotos Incluidas Top Panel — padding y margen inferior reducidos el 22/9 (antes
                  p-4 sm:p-5 / mb-3, y de nuevo achicado ese mismo día — antes p-3 sm:p-4 / mb-2 —
                  como parte del mismo pedido de Pablo de necesitar menos scroll) para dejar más
                  alto libre para las fotos y el botón "Elegir" sin scrollear. */}
              <div className="bg-slate-900 text-white rounded-2xl p-2.5 sm:p-3 shadow-md border border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold uppercase">
                        Pack Oficial Escolar
                      </span>
                      <h4 className="text-sm font-bold text-white">
                        Tus 3 Fotos Incluidas en el Paquete
                      </h4>
                    </div>
                    <p className="text-xs text-slate-300 mt-0.5 text-left">
                      Elegí las 3 tomas que integran tu recuerdo escolar: 1 grupal, 1 individual y 1 con la seño.
                    </p>
                  </div>
                  <span className={`px-3 py-1 rounded-full border text-xs font-bold shrink-0 self-start sm:self-auto flex items-center gap-1.5 ${
                    cantidadFotosPackSeleccionadas === 3
                      ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/30'
                  }`}>
                    <CheckCheck className={`w-3.5 h-3.5 ${cantidadFotosPackSeleccionadas === 3 ? 'text-emerald-400' : 'text-amber-400'}`} />
                    <span>{cantidadFotosPackSeleccionadas} de 3 fotos seleccionadas</span>
                  </span>
                </div>

                {/* 3 Slots + Otras Fotos (mismo estilo, para que se vea igual de accesible que las 3 del pack) */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2 pt-0.5 text-left">
                  {/* Slot 1: Grupal — tarjetas achicadas ~50% el 22/9 (pedido de Pablo) y texto
                      recortado a lo esencial para que entre sin desbordar en el tamaño nuevo. */}
                  <div
                    onClick={() => setCategoriaActiva('grupal')}
                    className={`rounded-lg p-1.5 flex items-center gap-1.5 transition-all cursor-pointer group border ${
                      fotoGrupalSeleccionada
                        ? 'bg-emerald-900/40 hover:bg-emerald-900/60 border-emerald-400 ring-1 ring-emerald-400/40'
                        : categoriaActiva === 'grupal'
                          ? 'bg-slate-800/80 hover:bg-slate-800 border-amber-400 ring-1 ring-amber-400/40'
                          : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-md overflow-hidden bg-slate-950 shrink-0 relative border border-slate-700">
                      {fotoGrupalSeleccionada ? <><img src={fotoGrupalSeleccionada.thumbnail} alt="Foto grupal elegida" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-black/20 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-emerald-400 stroke-[3]" /></div></> : <Images className="w-3.5 h-3.5 text-slate-500 absolute inset-0 m-auto" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className={`text-[9px] font-bold block uppercase tracking-wider leading-tight truncate ${fotoGrupalSeleccionada ? 'text-emerald-300' : 'text-amber-400'}`}>
                        1/3 Grupal
                      </span>
                      <p className="text-[10px] font-bold text-white truncate leading-tight group-hover:text-amber-300">
                        {fotoGrupalSeleccionada?.titulo?.split(' - ')[0] || 'Sin elegir'}
                      </p>
                    </div>
                  </div>

                  {/* Slot 2: Retrato Individual */}
                  <div
                    onClick={() => setCategoriaActiva('individual')}
                    className={`rounded-lg p-1.5 flex items-center gap-1.5 transition-all cursor-pointer group border ${
                      fotoIndividualSeleccionada
                        ? 'bg-emerald-900/40 hover:bg-emerald-900/60 border-emerald-400 ring-1 ring-emerald-400/40'
                        : categoriaActiva === 'individual'
                          ? 'bg-slate-800/80 hover:bg-slate-800 border-amber-400 ring-1 ring-amber-400/40'
                          : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-md overflow-hidden bg-slate-950 shrink-0 relative border border-slate-700">
                      {fotoIndividualSeleccionada ? <><img src={fotoIndividualSeleccionada.thumbnail} alt="Retrato individual elegido" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-black/20 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-emerald-400 stroke-[3]" /></div></> : <Images className="w-3.5 h-3.5 text-slate-500 absolute inset-0 m-auto" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className={`text-[9px] font-bold block uppercase tracking-wider leading-tight truncate ${fotoIndividualSeleccionada ? 'text-emerald-300' : 'text-amber-400'}`}>
                        2/3 Retrato
                      </span>
                      <p className="text-[10px] font-bold text-white truncate leading-tight group-hover:text-amber-300">
                        {fotoIndividualSeleccionada?.titulo?.split(' - ')[0] || 'Sin elegir'}
                      </p>
                    </div>
                  </div>

                  {/* Slot 3: Con Docente */}
                  <div
                    onClick={() => setCategoriaActiva('docente')}
                    className={`rounded-lg p-1.5 flex items-center gap-1.5 transition-all cursor-pointer group border ${
                      fotoDocenteSeleccionada
                        ? 'bg-emerald-900/40 hover:bg-emerald-900/60 border-emerald-400 ring-1 ring-emerald-400/40'
                        : categoriaActiva === 'docente'
                          ? 'bg-slate-800/80 hover:bg-slate-800 border-amber-400 ring-1 ring-amber-400/40'
                          : 'bg-slate-800/80 hover:bg-slate-800 border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-md overflow-hidden bg-slate-950 shrink-0 relative border border-slate-700">
                      {fotoDocenteSeleccionada ? <><img src={fotoDocenteSeleccionada.thumbnail} alt="Foto con docente elegida" className="w-full h-full object-cover" /><div className="absolute inset-0 bg-black/20 flex items-center justify-center"><Check className="w-2.5 h-2.5 text-emerald-400 stroke-[3]" /></div></> : <Images className="w-3.5 h-3.5 text-slate-500 absolute inset-0 m-auto" />}
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className={`text-[9px] font-bold block uppercase tracking-wider leading-tight truncate ${fotoDocenteSeleccionada ? 'text-emerald-300' : 'text-amber-400'}`}>
                        3/3 Con Seño
                      </span>
                      <p className="text-[10px] font-bold text-white truncate leading-tight group-hover:text-amber-300">
                        {fotoDocenteSeleccionada?.titulo || 'Sin elegir'}
                      </p>
                    </div>
                  </div>

                  {/* Slot 4: Otras Fotos — mismo tamaño y lugar que los 3 del pack (antes era un
                      botón aparte, más chico y menos visible), pero con estilo distinto (punteado,
                      sin check) para que se note que NO forma parte de las 3 fotos incluidas. */}
                  {hayFotosDeEventos && <div
                    onClick={() => setCategoriaActiva('patio')}
                    className={`bg-slate-800/40 hover:bg-slate-800/70 rounded-lg p-1.5 flex items-center gap-1.5 transition-all cursor-pointer group border border-dashed ${
                      categoriaActiva === 'patio' ? 'border-amber-400 ring-1 ring-amber-400/40 bg-slate-800/70' : 'border-slate-600 hover:border-slate-500'
                    }`}
                  >
                    <div className="w-6 h-6 rounded-md shrink-0 bg-slate-950/60 border border-slate-700 flex items-center justify-center">
                      <Images className="w-3.5 h-3.5 text-slate-400" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[9px] font-bold text-slate-400 block uppercase tracking-wider leading-tight truncate">
                        Opcional
                      </span>
                      <p className="text-[10px] font-bold text-white truncate leading-tight group-hover:text-amber-300">
                        Otras Fotos {fotosSueltasSeleccionadas.length > 0 ? `(${fotosSueltasSeleccionadas.length})` : ''}
                      </p>
                    </div>
                  </div>}
                </div>
              </div>

              {/* Debajo del panel de arriba: sólo el título de la categoría que se está mostrando —
                  el acceso a las 4 categorías (3 del pack + Otras Fotos) ya está arriba, con el
                  mismo tamaño y estilo para las 4. */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-2">
                <h5 className="text-xs font-bold text-slate-500 uppercase tracking-wider">
                  {categoriaActiva === 'patio'
                    ? 'Otras Fotos (no incluidas en el paquete)'
                    : 'Elegí tu toma tocando una foto'}
                </h5>

                {extraCarpetas > 0 && (
                  <span className="text-xs font-bold px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <Copy className="w-3.5 h-3.5 text-amber-700" />
                    <span>{extraCarpetas} carpeta(s) extra(s) agregada(s)</span>
                  </span>
                )}
              </div>

              {/* Photo Cards Grid — 4 columnas desde "xl" (ver el ancho del modal más arriba,
                  ampliado a la par para que esas 4 columnas entren cómodas) para que un curso con
                  muchas fotos por categoría necesite menos filas y, con eso, menos scroll.
                  Auditoría 2026-09-22 (pedido de Pablo: "hay un espacio en blanco que no tiene
                  utilidad"): antes el grid siempre reservaba 4 columnas desde "xl" aunque la
                  categoría activa tuviera menos fotos (las 3 del pack, por ejemplo), dejando un
                  hueco vacío donde iría la 4ª columna. Ahora la cantidad de columnas se ajusta a
                  la cantidad real de fotos de la categoría activa, así 3 fotos ocupan 3 columnas
                  completas sin dejar espacio de más. */}
              <div className={`grid grid-cols-1 gap-4 ${(() => {
                const cantidad = fotosDisponibles.filter((f) => f.categoria === categoriaActiva).length;
                if (cantidad >= 4) return 'sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4';
                if (cantidad === 3) return 'sm:grid-cols-2 lg:grid-cols-3';
                if (cantidad === 2) return 'sm:grid-cols-2';
                return '';
              })()}`}>
                {fotosDisponibles.filter((f) => f.categoria === categoriaActiva).map((foto) => {
                  const isSelected =
                    foto.id === fotoSeleccionadaIndividual ||
                    foto.id === fotoSeleccionadaGrupal ||
                    foto.id === fotoSeleccionadaDocente ||
                    fotosSueltasSeleccionadas.includes(foto.id);

                  const handleSelectThisFoto = () => {
                    if (foto.categoria === 'individual') setFotoSeleccionadaIndividual(foto.id);
                    if (foto.categoria === 'grupal') setFotoSeleccionadaGrupal(foto.id);
                    if (foto.categoria === 'docente') setFotoSeleccionadaDocente(foto.id);
                    if (foto.categoria === 'patio') {
                      setFotosSueltasSeleccionadas((actuales) =>
                        actuales.includes(foto.id)
                          ? actuales.filter((id) => id !== foto.id)
                          : actuales.length >= MAX_FOTOS_SUELTAS
                          ? actuales
                          : [...actuales, foto.id]
                      );
                    }
                    setErrorSeleccionFotos('');
                  };

                  return (
                    <div
                      key={foto.id}
                      className={`relative bg-white rounded-2xl overflow-hidden border transition-all duration-200 flex flex-col justify-between ${
                        isSelected
                          ? 'border-2 border-amber-500 shadow-lg shadow-amber-500/10 ring-2 ring-amber-400/30'
                          : 'border-slate-200 hover:border-slate-300 shadow-xs'
                      }`}
                    >
                      {/* Photo Container */}
                      <div 
                        className="relative aspect-4/3 overflow-hidden bg-slate-100 select-none"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                        }}
                      >
                        <img
                          src={foto.thumbnail}
                          alt={foto.titulo}
                          draggable={false}
                          className="w-full h-full object-cover object-center pointer-events-none select-none"
                        />

                        {/* Sin marca de agua en la miniatura: solo se muestra al ampliar la foto */}

                        {/* Status badge */}
                        {isSelected && (
                          <div className="absolute top-2.5 left-2.5">
                            <span className="px-2.5 py-1 rounded-md bg-amber-400 text-slate-950 text-[11px] font-extrabold flex items-center gap-1 shadow-md">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>{foto.categoria === 'patio' ? 'Adicional elegida' : 'En el Pack Oficial'}</span>
                            </span>
                          </div>
                        )}

                        {/* Zoom button (z-30: debe quedar por encima de la marca de agua, que usa z-20 y captura los clics) */}
                        <button
                          type="button"
                          onClick={() => setModalFotoPreview(foto)}
                          className="absolute bottom-2.5 right-2.5 z-30 p-2.5 sm:p-1.5 rounded-lg bg-white/90 hover:bg-white text-slate-800 text-xs shadow-md transition-colors cursor-pointer"
                          title="Ampliar foto"
                        >
                          <Eye className="w-4 h-4" />
                        </button>
                      </div>

                      {/* Card Details & Action Area */}
                      <div className="p-3.5 flex items-center justify-between gap-3 text-left bg-white">
                        <div>
                          <h5 className="text-xs font-bold text-slate-900 truncate">{foto.titulo}</h5>
                          <span className="text-[10px] text-slate-500">
                            {foto.categoria === 'patio' ? 'Archivo Digital HD' : foto.categoria === 'grupal' ? 'Formato 20x30 cm' : 'Formato 15x21 cm'}
                          </span>
                        </div>

                        {/* Primary Pack selection button */}
                        {foto.categoria !== 'patio' ? (
                          <button
                            type="button"
                            onClick={handleSelectThisFoto}
                            className={`shrink-0 py-2.5 sm:py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-emerald-500 text-white shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-white" />
                                <span>Elegida</span>
                              </>
                            ) : (
                              <span>Elegir</span>
                            )}
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={handleSelectThisFoto}
                            className={`shrink-0 py-2.5 sm:py-1.5 px-3 rounded-lg text-xs font-bold transition-all ${isSelected ? 'bg-emerald-600 text-white' : 'bg-slate-900 text-white hover:bg-slate-800'}`}
                          >
                            {isSelected ? 'Agregada · Quitar' : `Agregar · $${PRECIO_FOTO_EVENTO.toLocaleString('es-AR')}`}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dedicated Extra Copies Section in Step 2: Copia Extra de la Carpeta.
                  Auditoría 2026-09-09: sólo tiene sentido si el kit elegido YA incluye una carpeta
                  de base ("Kit Impreso + Digital") — ver comentario junto a setSelectedKit más
                  abajo. Para los demás kits no se muestra: agregarla ahí bajaba el precio de la
                  carpeta completa por debajo del kit que realmente la incluye. */}
              {selectedKit.id === 'kit-clasico' && (
              <div className="bg-gradient-to-br from-amber-50/90 via-white to-amber-50/50 rounded-2xl p-4 sm:p-5 border-2 border-amber-300 shadow-xs text-left">
                <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
                  <div className="flex items-start sm:items-center gap-3.5">
                    <div className="w-11 h-11 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-xs shrink-0 mt-0.5 sm:mt-0">
                      <FolderCheck className="w-6 h-6" />
                    </div>
                    <div>
                      <div className="flex flex-wrap items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 font-['Outfit']">
                          ¿Deseás encargar una copia extra de la carpeta?
                        </h4>
                        <span className="text-[10px] font-extrabold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Para abuelos o familiares
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-1 max-w-2xl">
                        Al elegir una copia de la carpeta, recibirás una <strong>carpeta conmemorativa adicional completa</strong> con las mismas fotografías seleccionadas impresas en laboratorio químico (foto grupal 20x30 y fotos individuales 15x21).
                      </p>
                      <span className="text-xs font-bold text-amber-900 inline-block mt-1">
                        +$15.000 ARS por cada carpeta adicional
                      </span>
                    </div>
                  </div>

                  {/* Selector de carpetas extra: con más de un hijo en la familia se muestra un
                      renglón independiente por hermano (nombre + su propio selector), en vez de
                      un único control implícitamente atado al hijo activo en pantalla. */}
                  {hijosParaCarpetasExtra.length > 0 ? (
                    <div className="w-full md:w-auto md:min-w-[300px] pt-2 md:pt-0 border-t md:border-t-0 border-amber-200/80">
                      {hijosParaCarpetasExtra.map((h) => renderFilaCarpetaExtra(h))}
                    </div>
                  ) : (
                  <div className="flex items-center gap-3 shrink-0 self-start md:self-center pt-2 md:pt-0 border-t md:border-t-0 border-amber-200/80 w-full md:w-auto justify-between md:justify-end">
                    <span className="text-xs font-bold text-slate-700 md:hidden">Carpetas extras:</span>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id="btn-menos-carpeta-extra"
                        onClick={() => setExtraCarpetas((prev) => Math.max(0, prev - 1))}
                        disabled={extraCarpetas === 0}
                        className="w-9 h-9 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-700 font-bold transition-colors cursor-pointer"
                        title="Restar carpeta extra"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <div className="min-w-10 text-center">
                        <span className="font-mono font-extrabold text-base text-slate-900 block">
                          {extraCarpetas}
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase font-bold block -mt-0.5">
                          {extraCarpetas === 1 ? 'carpeta' : 'carpetas'}
                        </span>
                      </div>
                      <button
                        type="button"
                        id="btn-mas-carpeta-extra"
                        onClick={() => setExtraCarpetas((prev) => Math.min(MAX_CARPETAS_EXTRA, prev + 1))}
                        disabled={extraCarpetas >= MAX_CARPETAS_EXTRA}
                        className="w-9 h-9 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold flex items-center justify-center transition-colors cursor-pointer shadow-xs"
                        title="Agregar carpeta extra"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {extraCarpetas === 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraCarpetas(1)}
                        className="hidden sm:inline-flex px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-bold border border-amber-300 transition-colors cursor-pointer"
                      >
                        + Sumar 1 Carpeta
                      </button>
                    )}
                  </div>
                  )}
                </div>

                {totalExtraCarpetasFamilia > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-amber-950 font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Recibirás <strong>{totalCarpetasBaseFamilia + totalExtraCarpetasFamilia} carpetas completas</strong> en total ({totalCarpetasBaseFamilia} del pack principal + {totalExtraCarpetasFamilia} para abuelos/familiares).
                      </span>
                    </div>
                    <span className="font-extrabold text-amber-900 bg-white px-2.5 py-1 rounded-lg border border-amber-300">
                      Subtotal carpetas extras: +${(totalExtraCarpetasFamilia * PRECIO_CARPETA_EXTRA).toLocaleString('es-AR')}
                    </span>
                  </div>
                )}
              </div>
              )}

              {/* Bottom Next Step Bar */}
              {errorSeleccionFotos && (
                <div role="alert" className="rounded-xl border-2 border-rose-300 bg-rose-50 p-4 text-base font-bold leading-6 text-rose-900 flex items-start gap-3">
                  <AlertCircle className="h-6 w-6 shrink-0 text-rose-600" />
                  <span>{errorSeleccionFotos}</span>
                </div>
              )}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-xs text-slate-600 text-left">
                  <span className="font-bold text-slate-900">Fotos del pack: </span>
                  Individual, Grupal y Con la Seño.
                  {extraCarpetas > 0 && (
                    <span className="ml-1.5 text-amber-800 font-bold">
                      (+ {extraCarpetas} carpeta{extraCarpetas > 1 ? 's' : ''} extra{extraCarpetas > 1 ? 's' : ''} para abuelos)
                    </span>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(1)}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Atrás
                  </button>
                  <button
                    id="btn-continuar-kit"
                    onClick={handleContinuarAlKit}
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer transition-all active:scale-98"
                  >
                    <span>{cantidadFotosPackSeleccionadas === 3 ? 'Elegir Kit y Formato' : `Elegí las 3 fotos (${cantidadFotosPackSeleccionadas}/3)`}</span>
                    {totalCopiasExtrasCantidad > 0 && (
                      <span className="px-2 py-0.5 bg-slate-950 text-amber-300 rounded text-[11px] font-black">
                        ${total.toLocaleString('es-AR')}
                      </span>
                    )}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
                </>
              )}
            </div>
          )}

          {/* STEP 3: Kit Selection & Add-ons */}
          {modalMode === 'pedido' && step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="text-center max-w-xl mx-auto">
                <h3 className="text-2xl font-extrabold text-slate-900 font-['Outfit']">
                  Elegí tu Kit Fotográfico
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Todos los paquetes incluyen copias de alta definición y garantía de satisfacción.
                </p>
              </div>

              {/* Las fotos de eventos son adicionales y nunca reemplazan el kit de tres fotos. */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-5 max-w-3xl mx-auto">
                {KITS_DISPONIBLES.filter((kit) => kit.id !== 'kit-evento-suelto').map((kit) => {
                  const isSelected = selectedKit.id === kit.id;
                  return (
                    <div
                      key={kit.id}
                      onClick={() => {
                        setSelectedKit(kit);
                        // Auditoría 2026-09-09 (hallazgo reportado por Pablo): la "Carpeta Escolar
                        // Extra Completa" (+$15.000) es una DUPLICADA de la carpeta que ya viene
                        // incluida en "Kit Impreso + Digital" ($30.000) — no tiene sentido en un kit
                        // que no trae carpeta de base ("Solo Digital HD", $15.000, o "Fotos Sueltas
                        // de Eventos", $5.000), porque ahí terminaba siendo una forma más barata de
                        // armar la misma carpeta completa (ej: $5.000 + $15.000 = $20.000 en vez de
                        // los $30.000 del kit que realmente la incluye). Si se cambia a un kit que no
                        // la incluye, se resetea la cantidad para no arrastrar ese precio de menos.
                        if (kit.id !== 'kit-clasico') setExtraCarpetas(0);
                      }}
                      className={`relative bg-white rounded-2xl p-5 border text-left cursor-pointer transition-all flex flex-col justify-between ${
                        isSelected
                          ? 'border-2 border-amber-500 shadow-xl shadow-amber-500/10 ring-2 ring-amber-400/30'
                          : 'border-slate-200 hover:border-slate-300'
                      }`}
                    >
                      {kit.popular && (
                        <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-amber-400 text-slate-950 text-[10px] font-extrabold px-3 py-0.5 rounded-full uppercase tracking-wider">
                          Más popular
                        </div>
                      )}

                      <div>
                        <div className="flex items-center justify-between mb-2">
                          <h4 className="text-base font-bold text-slate-900 font-['Outfit']">
                            {kit.nombre}
                          </h4>
                          {isSelected && (
                            <div className="w-5 h-5 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                            </div>
                          )}
                        </div>

                        {kit.subtitulo && (
                          <p className="text-[11px] font-semibold text-slate-700 mb-1">{kit.subtitulo}</p>
                        )}
                        <p className="text-[11px] text-slate-500 mb-3 min-h-[28px]">{kit.tagline}</p>

                        <div className="mb-4 pb-3 border-b border-slate-100">
                          <div className="flex items-baseline gap-1">
                            <span className="text-2xl font-extrabold text-slate-900 font-['Outfit']">
                              ${kit.precio.toLocaleString('es-AR')}
                            </span>
                            <span className="text-xs text-slate-500">ARS</span>
                          </div>
                        </div>

                        <ul className="space-y-2 mb-6">
                          {kit.incluye.map((inc, i) => (
                            <li key={i} className="text-[11px] text-slate-700 flex items-start gap-2">
                              <Check className="w-3.5 h-3.5 text-emerald-600 shrink-0 mt-0.5" />
                              <span>{inc}</span>
                            </li>
                          ))}
                        </ul>
                      </div>

                      <div
                        className={`w-full py-2 rounded-xl text-xs font-bold text-center transition-colors ${
                          isSelected
                            ? 'bg-slate-900 text-white'
                            : 'bg-slate-100 text-slate-700 hover:bg-slate-200'
                        }`}
                      >
                        {isSelected ? 'Kit Seleccionado' : 'Seleccionar este Kit'}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Copia Extra de Carpeta Escolar Completa (Para Abuelos / Familiares).
                  Auditoría 2026-09-09: sólo disponible con "Kit Impreso + Digital" — ver comentario
                  junto a setSelectedKit más arriba. Con los otros kits, un cartel explica por qué
                  no está y a qué kit cambiar para conseguirla. */}
              {selectedKit.id === 'kit-clasico' ? (
              <div className="bg-gradient-to-br from-amber-50/90 via-white to-amber-50/50 rounded-2xl p-5 border-2 border-amber-300 text-left space-y-4 shadow-xs">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-amber-200/80">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-xs shrink-0">
                      <FolderCheck className="w-5 h-5 text-slate-950" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h4 className="text-sm font-bold text-slate-900 font-['Outfit']">
                          ¿Deseás encargar una copia extra de la carpeta escolar?
                        </h4>
                        <span className="text-[10px] font-extrabold bg-amber-200 text-amber-900 px-2 py-0.5 rounded-full uppercase tracking-wider">
                          Para abuelos o familiares
                        </span>
                      </div>
                      <p className="text-xs text-slate-600 mt-0.5">
                        Al elegir una copia de la carpeta, el sistema generará automáticamente el juego completo duplicado de fotos (individual 15x21, grupal 20x30 y con la seño 15x21) y una carpeta adicional armada para entrega a familiares.
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 px-2.5 py-1 bg-white border border-amber-300 rounded-lg text-[11px] font-bold text-amber-900 shrink-0 self-start sm:self-auto shadow-2xs">
                    <Printer className="w-3.5 h-3.5 text-amber-600" />
                    <span>Revelado Químico Minilab</span>
                  </div>
                </div>

                <div className="p-4 rounded-xl bg-white border border-amber-300 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-bold text-slate-900">
                        Carpeta Escolar Extra Completa
                      </span>
                      <span className="text-[10px] font-extrabold bg-amber-100 text-amber-900 px-2 py-0.5 rounded border border-amber-300">
                        +$15.000 ARS c/u
                      </span>
                    </div>
                    <p className="text-xs text-slate-600 mt-1 max-w-xl">
                      Incluye la carpeta conmemorativa física más todas las copias de laboratorio de las fotos que seleccionaste (individual 15x21 + grupal 20x30 + con la seño 15x21).
                    </p>
                  </div>

                  {hijosParaCarpetasExtra.length > 0 ? (
                    <div className="w-full sm:w-auto sm:min-w-[300px] shrink-0 self-start sm:self-auto">
                      {hijosParaCarpetasExtra.map((h) => renderFilaCarpetaExtra(h))}
                    </div>
                  ) : (
                  <div className="flex items-center gap-3 shrink-0 self-start sm:self-auto">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        id="btn-menos-carpeta-extra-step3"
                        onClick={() => setExtraCarpetas((prev) => Math.max(0, prev - 1))}
                        disabled={extraCarpetas === 0}
                        className="w-9 h-9 rounded-xl border border-slate-300 bg-white hover:bg-slate-100 disabled:opacity-30 disabled:cursor-not-allowed flex items-center justify-center text-slate-700 font-bold transition-colors cursor-pointer"
                        title="Restar carpeta extra"
                      >
                        <Minus className="w-4 h-4" />
                      </button>
                      <div className="min-w-10 text-center">
                        <span className="font-mono font-extrabold text-base text-slate-900 block">
                          {extraCarpetas}
                        </span>
                        <span className="text-[9px] text-slate-500 uppercase font-bold block -mt-0.5">
                          {extraCarpetas === 1 ? 'carpeta' : 'carpetas'}
                        </span>
                      </div>
                      <button
                        type="button"
                        id="btn-mas-carpeta-extra-step3"
                        onClick={() => setExtraCarpetas((prev) => Math.min(MAX_CARPETAS_EXTRA, prev + 1))}
                        disabled={extraCarpetas >= MAX_CARPETAS_EXTRA}
                        className="w-9 h-9 rounded-xl bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold flex items-center justify-center transition-colors cursor-pointer shadow-xs"
                        title="Agregar carpeta extra"
                      >
                        <Plus className="w-4 h-4" />
                      </button>
                    </div>

                    {extraCarpetas === 0 && (
                      <button
                        type="button"
                        onClick={() => setExtraCarpetas(1)}
                        className="hidden md:inline-flex px-3 py-2 rounded-xl bg-amber-100 hover:bg-amber-200 text-amber-950 text-xs font-bold border border-amber-300 transition-colors cursor-pointer"
                      >
                        + Sumar 1 Carpeta
                      </button>
                    )}
                  </div>
                  )}
                </div>

                {totalExtraCarpetasFamilia > 0 && (
                  <div className="p-3 rounded-xl bg-amber-100/70 border border-amber-200 text-xs text-amber-950 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <span>
                        <strong>Carpetas a confeccionar:</strong> {totalCarpetasBaseFamilia} carpeta{totalCarpetasBaseFamilia > 1 ? 's' : ''} del pack principal + {totalExtraCarpetasFamilia} carpeta{totalExtraCarpetasFamilia > 1 ? 's' : ''} extra{totalExtraCarpetasFamilia > 1 ? 's' : ''} = <strong>{totalCarpetasBaseFamilia + totalExtraCarpetasFamilia} carpetas completas</strong> en total (+${(totalExtraCarpetasFamilia * PRECIO_CARPETA_EXTRA).toLocaleString('es-AR')}).
                      </span>
                    </div>
                  </div>
                )}
              </div>
              ) : (
                <div className="bg-slate-50 border border-slate-200 rounded-2xl p-4 text-left flex items-start gap-3">
                  <FolderCheck className="w-5 h-5 text-slate-400 shrink-0 mt-0.5" />
                  <p className="text-xs text-slate-600">
                    La copia extra de carpeta para abuelos o familiares está disponible eligiendo el <strong>Kit Impreso + Digital</strong>, que ya incluye la carpeta original.
                  </p>
                </div>
              )}

              {/* Subtotal & Navigation */}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-left">
                  <span className="text-xs text-slate-500">
                    {otrosHijosEnCarrito.length > 0 ? `Subtotal de ${nombreAlumno}:` : 'Total a pagar:'}
                  </span>
                  <div className="text-2xl font-black text-slate-900 font-['Outfit']">
                    ${total.toLocaleString('es-AR')}{' '}
                    <span className="text-xs font-normal text-slate-500">ARS</span>
                  </div>
                  {otrosHijosEnCarrito.length > 0 && (
                    <p className="text-[11px] text-emerald-700 font-semibold mt-0.5">
                      + ${otrosHijosEnCarrito.reduce((acc, c) => acc + c.total, 0).toLocaleString('es-AR')} de {otrosHijosEnCarrito.length === 1 ? 'tu otro hijo/a' : 'tus otros hijos/as'} — se paga todo junto en el próximo paso.
                    </p>
                  )}
                </div>

                <div className="flex gap-3">
                  <button
                    onClick={() => setStep(2)}
                    className="px-4 py-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100 rounded-xl transition-colors cursor-pointer"
                  >
                    Volver a fotos
                  </button>
                  <button
                    id="btn-continuar-pago"
                    onClick={() => setStep(4)}
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer transition-all active:scale-98"
                  >
                    <span>Ir a Datos y Pago</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 4: Checkout & Payment */}
          {modalMode === 'pedido' && step === 4 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200 text-left">
              <div className="text-center space-y-1">
                <h3 className="text-2xl font-extrabold text-slate-900 font-['Outfit']">
                  Confirmación y Pago Seguro
                </h3>
                <p className="text-sm text-slate-600">
                  Revisá las fotos elegidas. El comprobante y los avisos se enviarán por email.
                </p>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-12 gap-6">
                {/* Form fields */}
                <div className="md:col-span-7 bg-white p-5 rounded-2xl border border-slate-200 space-y-4 shadow-xs">
                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    1. Datos de Contacto y Entrega
                  </h4>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Nombre y Apellido de la Madre, Padre o Tutor
                    </label>
                    <input
                      type="text"
                      value={tutorNombre}
                      onChange={(e) => setTutorNombre(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label className="text-sm font-semibold text-slate-700 block mb-1.5">
                      Email para comprobante, descarga y avisos
                    </label>
                    <input
                      type="email"
                      value={tutorEmail}
                      onChange={(e) => setTutorEmail(e.target.value)}
                      className="w-full px-3 py-2.5 text-sm bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pt-2">
                    2. Método de Pago Online
                  </h4>

                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                    <button
                      type="button"
                      onClick={() => setMetodoPago('mercadopago')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        metodoPago === 'mercadopago'
                          ? 'bg-sky-50 border-sky-400 ring-1 ring-sky-400'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <CreditCard className="w-4 h-4 text-sky-600" />
                        <span className="text-[10px] font-bold bg-sky-100 text-sky-800 px-1.5 py-0.5 rounded">
                          Inmediato
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900">Mercado Pago</p>
                      <p className="text-[10px] text-slate-500">Débito, crédito o dinero en cuenta</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMetodoPago('nave')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        metodoPago === 'nave'
                          ? 'bg-violet-50 border-violet-400 ring-1 ring-violet-400'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Smartphone className="w-4 h-4 text-violet-600" />
                        <span className="text-[10px] font-bold bg-violet-100 text-violet-800 px-1.5 py-0.5 rounded">
                          Inmediato
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900">Nave</p>
                      <p className="text-[10px] text-slate-500">Tarjetas y QR (Banco Galicia)</p>
                    </button>

                    <button
                      type="button"
                      onClick={() => setMetodoPago('transferencia')}
                      className={`p-3 rounded-xl border text-left cursor-pointer transition-all ${
                        metodoPago === 'transferencia'
                          ? 'bg-amber-50 border-amber-400 ring-1 ring-amber-400'
                          : 'bg-slate-50 border-slate-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <Building2 className="w-4 h-4 text-amber-600" />
                        <span className="text-[10px] font-bold bg-amber-100 text-amber-800 px-1.5 py-0.5 rounded">
                          Alias / CBU
                        </span>
                      </div>
                      <p className="text-xs font-bold text-slate-900">Transferencia</p>
                      <p className="text-[10px] text-slate-500">Banco Galicia / Cuenta oficial</p>
                    </button>
                  </div>

                  {metodoPago === 'transferencia' && (
                    <div className="p-3 bg-amber-50/70 border border-amber-200 rounded-xl text-xs space-y-1">
                      <p className="font-bold text-amber-900">Datos bancarios para transferir:</p>
                      <p className="text-slate-700">
                        <strong>Banco:</strong> Galicia
                      </p>
                      <p className="text-slate-700">
                        <strong>Alias:</strong> <span className="font-mono">RETRATO.ESCOLAR</span>
                      </p>
                      <p className="text-slate-700">
                        <strong>CBU:</strong> <span className="font-mono">0070313830004052956749</span>
                      </p>
                      <p className="text-slate-700">
                        <strong>Titular:</strong> Alderete Pablo Gabriel
                      </p>
                      <p className="text-slate-700">
                        <strong>CUIT:</strong> 20-28306117-6
                      </p>
                    </div>
                  )}
                </div>

                {/* Summary Box */}
                <div className="md:col-span-5 bg-slate-900 text-white p-5 rounded-2xl flex flex-col justify-between shadow-lg">
                  <div className="space-y-4">
                    <div className="border-b border-slate-800 pb-3">
                      <p className="text-[11px] uppercase tracking-wider text-amber-400 font-bold">
                        {otrosHijosEnCarrito.length > 0 ? `Resumen del Pedido (${otrosHijosEnCarrito.length + 1} hijos/as)` : 'Resumen del Pedido'}
                      </p>
                      <p className="text-sm font-bold text-white mt-1">{selectedKit.nombre}</p>
                      <p className="text-xs text-slate-400">
                        {nombreAlumno} · {grado} "{division}"
                      </p>
                    </div>

                    {otrosHijosEnCarrito.length > 0 && (
                      <div className="space-y-2 -mt-2">
                        <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                          <ShoppingCart className="w-3.5 h-3.5" />
                          <span>También en este pago</span>
                        </p>
                        {otrosHijosEnCarrito.map((c) => {
                          const categoriasElegidas = [
                            c.fotoSeleccionadaGrupal && 'Grupal',
                            c.fotoSeleccionadaIndividual && 'Individual',
                            c.fotoSeleccionadaDocente && 'Con docente',
                          ].filter(Boolean) as string[];
                          return (
                            <div key={c.hijoId} className="flex items-center justify-between rounded-xl border border-slate-700 bg-slate-800/70 p-2.5 text-xs">
                              <div className="min-w-0">
                                <p className="truncate font-bold text-white">{c.nombreCompleto}</p>
                                <p className="text-[10px] text-slate-400">{c.kitNombre} · {c.grado} "{c.division}"</p>
                                {categoriasElegidas.length > 0 && (
                                  <p className="text-[10px] text-slate-500 mt-0.5">
                                    {categoriasElegidas.join(' + ')}
                                    {c.fotosSueltasSeleccionadas.length > 0 &&
                                      ` · +${c.fotosSueltasSeleccionadas.length} foto${c.fotosSueltasSeleccionadas.length > 1 ? 's' : ''} suelta${c.fotosSueltasSeleccionadas.length > 1 ? 's' : ''}`}
                                  </p>
                                )}
                              </div>
                              <span className="shrink-0 font-bold text-slate-200">${c.total.toLocaleString('es-AR')}</span>
                            </div>
                          );
                        })}
                        <p className="text-[10px] text-emerald-300/90">
                          Un solo pago cubre {nombreAlumno} y {otrosHijosEnCarrito.map((c) => c.nombreCompleto).join(', ')}.
                        </p>
                      </div>
                    )}

                    <div className="space-y-2">
                      <p className="text-xs font-bold uppercase tracking-wider text-slate-300">
                        {otrosHijosEnCarrito.length > 0 ? `Fotos elegidas · ${nombreAlumno}` : 'Fotos elegidas'}
                      </p>
                      {[
                        { foto: fotoGrupalSeleccionada, tipo: 'Grupal', medida: '20x30 cm' },
                        { foto: fotoIndividualSeleccionada, tipo: 'Individual', medida: '15x21 cm' },
                        { foto: fotoDocenteSeleccionada, tipo: 'Con docente', medida: '15x21 cm' },
                      ].map(({ foto, tipo, medida }) => foto && (
                        <div key={tipo} className="flex items-center gap-3 rounded-xl border border-slate-700 bg-slate-800/70 p-2.5">
                          <MiniaturaAmpliable
                            foto={foto}
                            alt={`${tipo} elegida`}
                            onAmpliar={(f) => setModalFotoPreview({ ...f, soloVista: true })}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-bold text-white">{tipo}</p>
                            <p className="text-xs text-slate-300">
                              {selectedKit.id === 'kit-clasico'
                                ? `${medida} · ${1 + extraCarpetas} copia${extraCarpetas > 0 ? 's' : ''}`
                                : 'Digital HD · 1 archivo'}
                            </p>
                          </div>
                        </div>
                      ))}
                      {fotosSueltasSeleccionadas.map((id) => {
                        const foto = fotosDisponibles.find((item) => item.id === id);
                        return foto ? (
                          <div key={id} className="flex items-center gap-3 rounded-xl border border-emerald-700/60 bg-emerald-950/30 p-2.5">
                            <MiniaturaAmpliable
                              foto={foto}
                              alt="Foto suelta elegida"
                              onAmpliar={(f) => setModalFotoPreview({ ...f, soloVista: true })}
                            />
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-bold text-white">Foto suelta / evento</p>
                              <p className="text-xs text-emerald-300">Digital HD · 1 archivo · $5.000</p>
                            </div>
                          </div>
                        ) : null;
                      })}
                    </div>

                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between">
                        <span>{selectedKit.nombre}</span>
                        <span>${precioBase.toLocaleString('es-AR')}</span>
                      </div>
                      {extraCarpetas > 0 && (
                        <div className="flex justify-between text-amber-300 font-semibold">
                          <span>Carpeta Escolar Extra Completa (x{extraCarpetas})</span>
                          <span>+${(extraCarpetas * PRECIO_CARPETA_EXTRA).toLocaleString('es-AR')}</span>
                        </div>
                      )}
                      {fotosSueltasSeleccionadas.length > 0 && (
                        <div className="flex justify-between text-emerald-300 font-semibold">
                          <span>Fotos sueltas / eventos (x{fotosSueltasSeleccionadas.length})</span>
                          <span>+${(fotosSueltasSeleccionadas.length * PRECIO_FOTO_EVENTO).toLocaleString('es-AR')}</span>
                        </div>
                      )}
                      <div className="flex justify-between text-emerald-400 font-medium">
                        <span>Descarga Digital HD</span>
                        <span>Incluida</span>
                      </div>
                    </div>

                    {extraCarpetas > 0 && (
                      <div className="p-2.5 rounded-lg bg-amber-400/15 border border-amber-400/30 text-[11px] text-amber-200 flex items-start gap-2">
                        <Printer className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                        <div>
                          <p className="font-bold text-amber-300">
                            Duplicado automático para laboratorio:
                          </p>
                          <p className="text-[10px] text-amber-200/90 mt-0.5">
                            Se programará 1 juego duplicado completo (individual, grupal y seño) para confeccionar {extraCarpetas} carpeta{extraCarpetas > 1 ? 's' : ''} extra{extraCarpetas > 1 ? 's' : ''} para familiares.
                          </p>
                        </div>
                      </div>
                    )}

                    <div className="pt-3 border-t border-slate-800 flex justify-between items-baseline">
                      <span className="text-xs font-bold text-slate-300">Total a Pagar:</span>
                      <span className="text-2xl font-black text-amber-400 font-['Outfit']">
                        ${totalCombinadoCarrito.toLocaleString('es-AR')}{' '}
                        <span className="text-xs text-slate-400 font-normal">ARS</span>
                      </span>
                    </div>

                    <div className="p-2.5 rounded-lg bg-slate-800/80 border border-slate-700 text-[11px] text-slate-300 flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
                      <span>Pago seguro protegido y comprobante automático oficial.</span>
                    </div>
                  </div>

                  <div className="pt-6">
                    <button
                      id="btn-confirmar-pagar"
                      onClick={handleCompletarPago}
                      disabled={isProcessingPayment}
                      className="w-full py-3 px-4 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-extrabold text-xs rounded-xl transition-all shadow-md shadow-amber-400/20 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                    >
                      {isProcessingPayment ? (
                        <>
                          <div className="w-4 h-4 border-2 border-slate-950 border-t-transparent rounded-full animate-spin" />
                          <span>Procesando pago seguro...</span>
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="w-4 h-4 text-slate-950" />
                          <span>Pagar ${totalCombinadoCarrito.toLocaleString('es-AR')} ARS</span>
                        </>
                      )}
                    </button>
                    <button
                      onClick={() => setStep(3)}
                      className="w-full text-center text-xs text-slate-400 hover:text-white mt-2 cursor-pointer"
                    >
                      Volver a cambiar kit
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* STEP 5: Success & Download */}
          {step === 5 && (
            <div className="max-w-xl mx-auto py-4 text-center space-y-6 animate-in zoom-in-95 duration-200">
              {pedidoGenerado?.estadoPago === 'aprobado' && pedidoGenerado.linkDescargaHD ? (
                <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-md">
                  <CheckCircle2 className="w-9 h-9" />
                </div>
              ) : (
                <div className="w-16 h-16 rounded-full bg-amber-100 text-amber-800 flex items-center justify-center mx-auto shadow-md">
                  <Clock className="w-9 h-9" />
                </div>
              )}

              <div>
                {pedidoGenerado?.estadoPago === 'aprobado' ? (
                  <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 uppercase tracking-wider">
                    ¡Pago Aprobado con Éxito!
                  </span>
                ) : (
                  <span className="text-xs font-bold text-amber-800 bg-amber-50 px-3 py-1 rounded-full border border-amber-200 uppercase tracking-wider">
                    Pedido Registrado · Pendiente de Acreditación
                  </span>
                )}
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit'] mt-3">
                  {/* Al volver del pago en otro navegador (sin sesión ni pedido guardados) estos
                      datos no existen: se usan los del pedido y, si tampoco están, un texto neutro
                      en vez de "¡Gracias por tu pedido, !" / "El pedido de  para ". */}
                  ¡Gracias por tu pedido{(tutorNombre || (pedidoGenerado?.tutorNombre !== 'Familia' ? pedidoGenerado?.tutorNombre : '')) ? `, ${tutorNombre || pedidoGenerado?.tutorNombre}` : ''}!
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-2">
                  {(nombreAlumno || selectedColegio?.nombre) ? (
                    <>
                      El pedido{nombreAlumno ? <> de <strong>{nombreAlumno}</strong></> : null}
                      {selectedColegio?.nombre ? <> para <strong>{selectedColegio.nombre}</strong></> : null} ya está registrado en el sistema.
                    </>
                  ) : (
                    'Tu pedido ya está registrado en el sistema.'
                  )}
                </p>
              </div>

              {/* Order Ticket Card */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-md text-left space-y-3">
                <div className="flex justify-between items-center pb-3 border-b border-slate-100">
                  <div>
                    <span className="text-[10px] text-slate-400 uppercase tracking-wider">
                      Número de Pedido Escolar
                    </span>
                    <p className="text-base font-mono font-bold text-slate-900">{numeroPedido}</p>
                  </div>
                  {pedidoGenerado?.estadoPago === 'aprobado' ? (
                    <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                      Aprobado
                    </span>
                  ) : (
                    <span className="px-2.5 py-1 rounded-full bg-amber-100 text-amber-900 text-xs font-bold border border-amber-300">
                      Pendiente de Pago
                    </span>
                  )}
                </div>

                {/* Cambiar método de pago. Auditoría 2026-09-21 (pedido real de Pablo, probado en
                    producción): "intenté pagar con Mercado Pago, me arrepentí, cancelé el pago
                    justo antes de apretar el botón, y volví a la página — me queda el pendiente
                    de pago pero no me da la opción de elegir otro medio de pago, solo el botón de
                    acceder a Mercado Pago nuevamente". Antes el método de pago quedaba fijo para
                    siempre en lo elegido al crear el pedido. Se muestra solo mientras el pedido
                    sigue sin pagarse; al elegir uno nuevo, handleCambiarMetodoPago actualiza el
                    pedido en el servidor y limpia los links viejos para que los efectos de arriba
                    generen uno nuevo del método recién elegido. */}
                {pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                    <p className="text-xs font-semibold text-slate-700">
                      ¿Preferís pagar de otra forma?
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: 'mercadopago' as const, label: 'Mercado Pago' },
                          { id: 'nave' as const, label: 'Nave' },
                          { id: 'transferencia' as const, label: 'Transferencia' },
                        ]
                      )
                        .filter((opcion) => opcion.id !== pedidoGenerado?.metodoPago)
                        .map((opcion) => (
                          <button
                            key={opcion.id}
                            type="button"
                            onClick={() => handleCambiarMetodoPago(opcion.id)}
                            disabled={cambiandoMetodoPago}
                            className="px-3 py-2 text-xs font-bold text-slate-700 bg-white hover:bg-amber-50 hover:border-amber-300 border border-slate-300 rounded-lg shadow-xs transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                          >
                            {cambiandoMetodoPago ? 'Cambiando...' : `Pagar con ${opcion.label}`}
                          </button>
                        ))}
                    </div>
                  </div>
                )}

                {/* Mercado Pago Redirection / Link. Auditoría 2026-09-21: esto antes leía el
                    estado local "metodoPago" (el seleccionado en el checkout del paso 4), no el
                    método REAL del pedido ya guardado — si la familia recargaba la página o
                    volvía en una pestaña nueva (por ejemplo desde el link de vuelta de Nave), ese
                    estado local nace en su valor por defecto ('mercadopago') sin importar cuál
                    haya sido el método real, así que este bloque podía no mostrarse nunca aunque
                    sí hubiera un link listo. Ahora usa pedidoGenerado.metodoPago, que es el dato
                    persistido y siempre correcto. */}
                {pedidoGenerado?.metodoPago === 'mercadopago' && mpRedirectUrl && pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-4 rounded-xl bg-sky-50 border border-sky-300 text-sky-950 space-y-2">
                    <p className="font-bold text-xs flex items-center gap-1.5 text-sky-900">
                      <CreditCard className="w-4 h-4 text-sky-600" />
                      Checkout Pro de Mercado Pago
                    </p>
                    <p className="text-xs text-sky-800">
                      Si la ventana de pago no se abrió de forma automática, hacé clic en el botón para completar el pago de forma segura:
                    </p>
                    <a
                      href={mpRedirectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs rounded-xl shadow transition-all cursor-pointer"
                    >
                      <CreditCard className="w-3.5 h-3.5" />
                      <span>Ir a Pagar ${(pedidoGenerado?.total ?? total).toLocaleString('es-AR')} en Mercado Pago</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {/* Sin link de pago a mano (recién llegado, recargó la página, o Mercado Pago
                    lo devolvió sin completar el pago): siempre hay forma de generar uno nuevo. */}
                {pedidoGenerado?.metodoPago === 'mercadopago' && !mpRedirectUrl && pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-4 rounded-xl bg-sky-50 border border-sky-300 text-sky-950 space-y-2">
                    <p className="font-bold text-xs flex items-center gap-1.5 text-sky-900">
                      <CreditCard className="w-4 h-4 text-sky-600" />
                      Checkout Pro de Mercado Pago
                    </p>
                    <p className="text-xs text-sky-800">
                      {generandoLinkPago
                        ? 'Generando un link de pago seguro con Mercado Pago...'
                        : 'Todavía no completaste el pago de este pedido. Generá el link para pagarlo ahora:'}
                    </p>
                    <button
                      type="button"
                      onClick={() => pedidoGenerado && generarLinkDePago(pedidoGenerado, false)}
                      disabled={generandoLinkPago}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-sky-500 hover:bg-sky-600 text-white font-bold text-xs rounded-xl shadow transition-all cursor-pointer disabled:opacity-60"
                    >
                      {generandoLinkPago ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <CreditCard className="w-3.5 h-3.5" />
                      )}
                      <span>{generandoLinkPago ? 'Generando...' : `Generar Link de Pago de $${(pedidoGenerado?.total ?? total).toLocaleString('es-AR')}`}</span>
                    </button>
                  </div>
                )}

                {/* Nave Redirection / Link. Mismo motivo que el bloque de Mercado Pago de
                    arriba: usa pedidoGenerado.metodoPago (el dato persistido), no el estado local
                    del checkout. */}
                {pedidoGenerado?.metodoPago === 'nave' && naveRedirectUrl && pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-4 rounded-xl bg-violet-50 border border-violet-300 text-violet-950 space-y-2">
                    <p className="font-bold text-xs flex items-center gap-1.5 text-violet-900">
                      <Smartphone className="w-4 h-4 text-violet-600" />
                      Checkout de Nave
                    </p>
                    <p className="text-xs text-violet-800">
                      Si la ventana de pago no se abrió de forma automática, hacé clic en el botón para completar el pago de forma segura:
                    </p>
                    <a
                      href={naveRedirectUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-500 hover:bg-violet-600 text-white font-bold text-xs rounded-xl shadow transition-all cursor-pointer"
                    >
                      <Smartphone className="w-3.5 h-3.5" />
                      <span>Ir a Pagar ${(pedidoGenerado?.total ?? total).toLocaleString('es-AR')} en Nave</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </a>
                  </div>
                )}

                {/* Sin link de pago a mano (recién llegado, recargó la página, o Nave lo devolvió
                    sin completar el pago): siempre hay forma de generar uno nuevo. */}
                {pedidoGenerado?.metodoPago === 'nave' && !naveRedirectUrl && pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-4 rounded-xl bg-violet-50 border border-violet-300 text-violet-950 space-y-2">
                    <p className="font-bold text-xs flex items-center gap-1.5 text-violet-900">
                      <Smartphone className="w-4 h-4 text-violet-600" />
                      Checkout de Nave
                    </p>
                    <p className="text-xs text-violet-800">
                      {generandoLinkNave
                        ? 'Generando un link de pago seguro con Nave...'
                        : 'Todavía no completaste el pago de este pedido. Generá el link para pagarlo ahora:'}
                    </p>
                    <button
                      type="button"
                      onClick={() => pedidoGenerado && generarLinkDeNave(pedidoGenerado, false)}
                      disabled={generandoLinkNave}
                      className="inline-flex items-center gap-2 px-4 py-2.5 bg-violet-500 hover:bg-violet-600 text-white font-bold text-xs rounded-xl shadow transition-all cursor-pointer disabled:opacity-60"
                    >
                      {generandoLinkNave ? (
                        <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <Smartphone className="w-3.5 h-3.5" />
                      )}
                      <span>{generandoLinkNave ? 'Generando...' : `Generar Link de Pago de $${(pedidoGenerado?.total ?? total).toLocaleString('es-AR')}`}</span>
                    </button>
                  </div>
                )}

                {/* Verification box & auto-polling status */}
                {pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-2.5">
                    <div className="text-xs text-slate-600">
                      <p className="font-semibold text-slate-800 flex items-center gap-1.5">
                        <Clock className="w-3.5 h-3.5 text-amber-600" />
                        <span>Verificación automática de pago activa</span>
                      </p>
                      <p className="text-[11px] text-slate-500 mt-0.5">
                        {mensajeEstadoPago || 'Sincronizando con Mercado Pago y la base de datos...'}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => verificarEstadoRealPedido()}
                      disabled={verificandoPago}
                      className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold text-xs rounded-lg shadow-xs flex items-center gap-1.5 transition-all cursor-pointer shrink-0 disabled:opacity-50"
                    >
                      {verificandoPago ? (
                        <div className="w-3.5 h-3.5 border-2 border-slate-700 border-t-transparent rounded-full animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
                      )}
                      <span>{verificandoPago ? 'Verificando...' : 'Re-verificar Estado'}</span>
                    </button>
                  </div>
                )}

                {/* Error notice if preference creation failed */}
                {pagoError && (
                  <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-bold">Aviso sobre el pago:</p>
                      <p className="text-[11px] text-rose-700 mt-0.5">{pagoError}</p>
                    </div>
                  </div>
                )}

                {/* Bank Transfer Instructions if Transferencia. Mismo motivo que los bloques de
                    arriba: usa pedidoGenerado.metodoPago, no el estado local del checkout. */}
                {pedidoGenerado?.metodoPago === 'transferencia' && pedidoGenerado?.estadoPago !== 'aprobado' && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 text-xs space-y-1">
                    <p className="font-bold text-amber-900 flex items-center gap-1.5">
                      <Building2 className="w-4 h-4 text-amber-700" />
                      Datos para completar la transferencia bancaria:
                    </p>
                    <p className="text-slate-700">
                      {/* Auditoría 2026-09-17 (Pablo: "como es que elegi un kit... si elegi las
                          fotos de mis 2 hijos y me cobro 60 mil pesos?"): acá abajo usaba "total",
                          el precio del hijo que haya quedado activo en pantalla en ESE momento
                          (line 788), no el monto real del pedido que se acaba de confirmar —
                          con 2+ hijos podía mostrar un número que no tenía nada que ver con lo
                          efectivamente cobrado. "pedidoGenerado.total" es el monto congelado al
                          momento de crear el pedido (combinado si son varios hijos), que es lo
                          que corresponde mostrar acá. El cobro real nunca estuvo mal — lo
                          calcula siempre el servidor — esto era sólo un problema de qué número
                          se le mostraba a la familia. */}
                      <strong>Monto total:</strong> ${(pedidoGenerado?.total ?? total).toLocaleString('es-AR')} ARS
                    </p>
                    <p className="text-slate-700">
                      <strong>Banco:</strong> Galicia
                    </p>
                    <p className="text-slate-700">
                      <strong>Titular:</strong> Alderete Pablo Gabriel
                    </p>
                    <p className="text-slate-700">
                      <strong>CUIT:</strong> 20-28306117-6
                    </p>
                    <p className="text-slate-700">
                      <strong>Alias:</strong> <span className="font-mono font-bold">RETRATO.ESCOLAR</span>
                    </p>
                    <p className="text-slate-700">
                      <strong>CBU:</strong> <span className="font-mono">0070313830004052956749</span>
                    </p>
                    <p className="text-slate-500 text-[11px] mt-1">
                      Una vez realizada, envianos el comprobante por email a fotos@retratoescolar.com.ar con tu número de pedido ({numeroPedido}) para activar tu entrega y link de descarga HD.
                    </p>
                  </div>
                )}

                {/* Email Delivery Confirmation Card */}
                {pedidoGenerado?.estadoPago === 'aprobado' ? (
                  <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-start gap-3">
                    <Mail className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-emerald-950">
                        ¡Fotos HD y comprobante enviados a tu correo!
                      </p>
                      <p className="text-emerald-700 mt-0.5">
                        Enviamos el enlace privado de descarga en máxima resolución a{' '}
                        <strong>{tutorEmail || pedidoGenerado?.tutorEmail || 'tu email registrado'}</strong>.
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200 text-slate-700 flex items-start gap-3">
                    <Mail className="w-5 h-5 text-slate-500 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-slate-800">
                        Envío automático de fotos HD por correo
                      </p>
                      <p className="text-slate-600 mt-0.5">
                        Al confirmarse el pago en la plataforma (por webhook o verificación del fotógrafo), se enviará de inmediato el enlace de descarga en Ultra HD a{' '}
                        <strong>{tutorEmail || pedidoGenerado?.tutorEmail || 'tu email registrado'}</strong>.
                      </p>
                    </div>
                  </div>
                )}

                {/* Extra Copies Confirmation Card if requested */}
                {pedidoGenerado && (pedidoGenerado.copiasExtras?.carpetasExtras || 0) > 0 && (
                  <div className="p-3.5 rounded-xl bg-amber-50 border border-amber-300 text-amber-950 flex items-start gap-3">
                    <FolderCheck className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
                    <div className="text-xs">
                      <p className="font-bold text-amber-950 flex items-center gap-1.5">
                        <span>¡{pedidoGenerado.copiasExtras?.carpetasExtras} carpeta(s) extra(s) generada(s) para el laboratorio!</span>
                        <span className="text-[10px] bg-amber-200 text-amber-900 font-extrabold px-1.5 py-0.5 rounded">
                          Juego Completo
                        </span>
                      </p>
                      <p className="text-amber-800 mt-0.5">
                        El sistema generó automáticamente el juego completo duplicado de fotos rotulado para el minilab y la carpeta conmemorativa adicional armada para familiares.
                      </p>
                    </div>
                  </div>
                )}

                {/* Selected Photos Thumbnails (auditoría 2026-09, pedido de Pablo): antes acá
                    se mostraba el listado de nombres de archivo internos para el laboratorio
                    (con código de alumno y "copias extra duplicadas"), que es información
                    interna del minilab y no debería ser visible para la familia. Ahora el
                    cliente sólo ve miniaturas de las fotos que eligió — sin nombres de
                    archivo ni copias extra repetidas. El detalle de archivos para el
                    laboratorio sigue disponible para el fotógrafo en el panel de admin
                    (pestaña "Laboratorio & Ensobrado"). */}
                {/* Auditoría 2026-09-23 (bug real, encontrado con un navegador headless): al volver
                    de Mercado Pago/Nave en un navegador que no tiene el pedido guardado (el caso
                    típico en celular), el pedido de respaldo que arma la pantalla no trae
                    `archivosParaLaboratorio` — el `.filter` sobre undefined tiraba abajo todo el
                    portal justo en la pantalla de confirmación del pago. */}
                {pedidoGenerado && (pedidoGenerado.archivosParaLaboratorio || []).some((archivo) => !archivo.esCopiaExtra) && (
                  <div className="p-3.5 rounded-xl bg-slate-50 border border-slate-200">
                    <div className="flex items-center gap-1.5 text-slate-700 font-bold text-xs mb-2.5">
                      <Images className="w-4 h-4 text-slate-500" />
                      <span>Tus fotos elegidas:</span>
                    </div>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                      {(pedidoGenerado.archivosParaLaboratorio || [])
                        .filter(archivo => !archivo.esCopiaExtra)
                        .map((archivo, idx) => (
                          <div key={idx} className="space-y-1">
                            {archivo.sinFotoReal ? (
                              // Auditoría 2026-09-15 (pedido de Pablo: "eliminemos todas las
                              // fotos de muestra"): en vez de una imagen rota (o, peor, una
                              // foto de stock que no es la del alumno), se avisa que está
                              // pendiente de verificación por el equipo fotográfico.
                              <div className="aspect-square rounded-lg bg-amber-50 border border-amber-300 flex flex-col items-center justify-center gap-1 p-1.5 text-center">
                                <AlertCircle className="w-5 h-5 text-amber-600" />
                                <span className="text-[9px] font-semibold text-amber-800 leading-tight">Foto pendiente de verificación</span>
                              </div>
                            ) : (
                              <div className="aspect-square rounded-lg overflow-hidden bg-slate-200 border border-slate-300">
                                <img
                                  src={archivo.urlMuestra}
                                  alt={archivo.tipo}
                                  className="w-full h-full object-cover"
                                />
                              </div>
                            )}
                            <p className="text-[10px] text-slate-500 text-center capitalize">{archivo.tipo}</p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    {/* Mismo fix que "Monto total" arriba: usa el kit/total congelados del
                        pedido ya confirmado (pedidoGenerado), no el estado en vivo de la
                        pantalla — que con 2+ hijos ya dice "2 hijos/as" en vez del kit de uno
                        solo (ver pedidoSintetico más arriba en este archivo). */}
                    <strong>Kit:</strong> {pedidoGenerado?.kitNombre ?? selectedKit.nombre}
                    {(pedidoGenerado?.total ?? total) > 0 ? ` ($${(pedidoGenerado?.total ?? total).toLocaleString('es-AR')} ARS)` : ''}
                  </p>
                  {grado && (
                    <p>
                      <strong>Curso:</strong> {grado}{division ? ` "${division}"` : ''}{turno ? ` · Turno ${turno}` : ''}
                    </p>
                  )}
                  <p>
                    <strong>Entrega impresa:</strong> Se entrega en sobre cerrado rotulado con el código y nombre del alumno en la institución.
                  </p>
                  {tutorWhatsapp && (
                    <p>
                      <strong>WhatsApp de contacto:</strong> {tutorWhatsapp}
                    </p>
                  )}
                </div>
              </div>

              {/* Instant Download Action */}
              {/* Auditoría 2026-09-18 (reporte de Pablo): antes esta rama solo miraba
                  estadoPago === 'aprobado' y mostraba el botón activo con href={linkDescargaHD}
                  aunque ese link todavía estuviera vacío (se carga después, a mano, desde el
                  panel de Laboratorio) — un <a> con href="" y target="_blank" abre una pestaña
                  nueva de la propia página en vez de descargar algo, que es justo lo que
                  reportó. Ahora exige también que el link ya exista. */}
              {pedidoGenerado?.estadoPago === 'aprobado' && pedidoGenerado.linkDescargaHD ? (
                <div className="p-4 rounded-2xl bg-amber-50 border border-amber-200 text-left flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-amber-900 flex items-center gap-1.5">
                      <Download className="w-4 h-4 text-amber-600" />
                      Descarga Inmediata en Ultra HD (Sin Marcas)
                    </p>
                    <p className="text-[11px] text-amber-700">
                      Podés descargar tus fotos ahora mismo en alta resolución además de recibirlas en tu correo.
                    </p>
                  </div>
                  <a
                    href={pedidoGenerado.linkDescargaHD}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Descargar Fotos HD</span>
                  </a>
                </div>
              ) : pedidoGenerado?.estadoPago === 'aprobado' ? (
                <div className="p-4 rounded-2xl bg-sky-50 border border-sky-200 text-left flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-sky-900 flex items-center gap-1.5">
                      <Clock className="w-4 h-4 text-sky-600" />
                      Pago acreditado — preparando tu descarga
                    </p>
                    <p className="text-[11px] text-sky-700">
                      Ya confirmamos tu pago. El link de descarga en alta resolución se está terminando de cargar y te va a llegar por email apenas esté listo.
                    </p>
                  </div>
                  <button
                    disabled
                    className="px-4 py-2 bg-sky-200 text-sky-800 text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 cursor-not-allowed opacity-75"
                  >
                    <Clock className="w-3.5 h-3.5" />
                    <span>Preparando...</span>
                  </button>
                </div>
              ) : (
                <div className="p-4 rounded-2xl bg-slate-100 border border-slate-300 text-left flex flex-col sm:flex-row items-center justify-between gap-4">
                  <div>
                    <p className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                      <Lock className="w-4 h-4 text-slate-500" />
                      Descarga Ultra HD (Protegida hasta confirmación de pago)
                    </p>
                    <p className="text-[11px] text-slate-500">
                      El enlace de descarga en máxima resolución se liberará automáticamente en cuanto se acredite el pago.
                    </p>
                  </div>
                  <button
                    disabled
                    className="px-4 py-2 bg-slate-300 text-slate-600 text-xs font-bold rounded-xl flex items-center gap-1.5 shrink-0 cursor-not-allowed opacity-75"
                  >
                    <Lock className="w-3.5 h-3.5" />
                    <span>Esperando Pago</span>
                  </button>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                {/* Auditoría 2026-09-18 (pedido de Pablo): se sacó el botón de WhatsApp — las
                    familias no deben tener ningún punto de contacto por WhatsApp en la web,
                    solo por el sistema de mensajería propio del sitio (Consultas) o por email.
                    Auditoría 2026-09-18 (reporte de Pablo, mismo día): confirmado en vivo — el
                    mailto: no abría nada, "solo vuelve a la web". Reemplazado por el formulario
                    de Consultas del sitio (con los datos ya precargados). Ver
                    src/utils/consultaPrefill.ts. */}
                <button
                  type="button"
                  onClick={() =>
                    irAConsultasConDatos(
                      {
                        nombre: nombreAlumno ? `Familia de ${nombreAlumno}` : '',
                        colegio: selectedColegio?.nombre || '',
                        numeroPedido,
                        asunto: 'Consulta sobre pagos o transferencias',
                        mensaje: `Hola Retrato Escolar, hice el pedido ${numeroPedido} para ${nombreAlumno}.`,
                      },
                      onClose
                    )
                  }
                  className="px-5 py-2.5 bg-sky-600 hover:bg-sky-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Mail className="w-4 h-4" />
                  <span>Avisar por email</span>
                </button>

                <button
                  onClick={onClose}
                  className="px-5 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-800 font-semibold text-xs rounded-xl transition-colors cursor-pointer"
                >
                  Cerrar Portal
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Modal Single Photo Fullscreen Preview */}
      {modalFotoPreview && (
        <div
          onClick={() => setModalFotoPreview(null)}
          className="fixed inset-0 z-60 bg-slate-950/90 backdrop-blur-md flex items-center justify-center p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative max-w-3xl w-full bg-slate-900 rounded-3xl overflow-hidden p-3 text-white border border-slate-800"
          >
            <div 
              className="relative aspect-4/3 overflow-hidden rounded-2xl bg-black select-none"
              onContextMenu={(e) => {
                e.preventDefault();
                e.stopPropagation();
              }}
            >
              <img
                src={modalFotoPreview.url}
                alt={modalFotoPreview.titulo}
                draggable={false}
                className="w-full h-full object-contain pointer-events-none select-none"
              />
              {/* Sin overlay de React acá: esta imagen ya trae la marca de agua quemada en
                  los píxeles desde que se subió — agregar otra capa encima solo duplicaba
                  el texto y se veía recargado. */}
            </div>

            <div className="p-3 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-xs font-bold text-white truncate">{modalFotoPreview.titulo}</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                {modalFotoPreview.categoria !== 'patio' && !modalFotoPreview.soloVista && (
                  <button
                    type="button"
                    onClick={() => {
                      if (modalFotoPreview.categoria === 'individual') setFotoSeleccionadaIndividual(modalFotoPreview.id);
                      if (modalFotoPreview.categoria === 'grupal') setFotoSeleccionadaGrupal(modalFotoPreview.id);
                      if (modalFotoPreview.categoria === 'docente') setFotoSeleccionadaDocente(modalFotoPreview.id);
                      setModalFotoPreview(null);
                    }}
                    className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs rounded-lg font-bold cursor-pointer"
                  >
                    Elegir esta foto
                  </button>
                )}
                <button
                  onClick={() => setModalFotoPreview(null)}
                  className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg font-semibold cursor-pointer"
                >
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
