import { useState, useEffect, useMemo, FormEvent } from 'react';
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
  PhoneCall,
  Smartphone,
  ShieldCheck,
  Heart,
  QrCode,
  Package,
  Clock,
  Truck,
  FileText,
  Key,
  Layers,
  CheckCheck,
  AlertCircle,
  Mail,
  FolderCheck,
  FileCode,
  Printer,
  Copy,
  Plus,
  Minus,
  MessageCircle,
} from 'lucide-react';
import { COLEGIOS_EJEMPLO, FOTOS_MUESTRA, KITS_DISPONIBLES } from '../data/colegiosData';
import { useColegiosLista } from '../services/colegiosService';
import { buscarSeccionPorCodigo } from '../data/codigosCursos';
import { registrarPedidoDesdePortal, obtenerPedidosGuardados, PedidoEscolarCompleto } from '../services/pedidosLabService';
import { obtenerFamiliaActiva, cerrarSesionFamilia, InscripcionFamilia } from '../services/inscripcionesService';
import { obtenerFotosParaGaleria } from '../services/fotosSubidasService';
import WatermarkOverlay from './WatermarkOverlay';
import { Colegio, KitProducto, Foto } from '../types';

interface PortalFamiliasModalProps {
  isOpen: boolean;
  onClose: () => void;
  preselectedColegioId?: string;
  preselectedKitId?: string;
  preselectedCodigo?: string;
  onOpenInscripcion?: () => void;
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

  // Step 1: School & Student Selection
  const [searchColegio, setSearchColegio] = useState('');
  const { colegios } = useColegiosLista();
  const [selectedColegio, setSelectedColegio] = useState<Colegio | null>(null);
  const [grado, setGrado] = useState('');
  const [division, setDivision] = useState('');
  const [turno, setTurno] = useState('');
  const [nombreAlumno, setNombreAlumno] = useState('');
  const [codigoAcceso, setCodigoAcceso] = useState('');
  const [seccionDetectada, setSeccionDetectada] = useState<any | null>(null);
  const [codigoValidadoMsg, setCodigoValidadoMsg] = useState<string | null>(null);
  const [codigoErrorMsg, setCodigoErrorMsg] = useState<string | null>(null);
  const [familiaActiva, setFamiliaActiva] = useState<InscripcionFamilia | null>(null);

  // Step 2: Gallery
  const [categoriaActiva, setCategoriaActiva] = useState<'individual' | 'grupal' | 'docente' | 'patio'>('individual');
  const [showWatermark, setShowWatermark] = useState(true);
  const [fotoSeleccionadaIndividual, setFotoSeleccionadaIndividual] = useState<string>('foto-ind-1');
  const [fotoSeleccionadaGrupal, setFotoSeleccionadaGrupal] = useState<string>('foto-grup-1');
  const [fotoSeleccionadaDocente, setFotoSeleccionadaDocente] = useState<string>('foto-doc-1');
  const [modalFotoPreview, setModalFotoPreview] = useState<Foto | null>(null);

  // Dynamic photos for this course (real photos uploaded to Supabase or fallback samples)
  const cursoActivoCodigo = useMemo(() => {
    return (codigoAcceso.trim() || seccionDetectada?.nemotecnico || '').toUpperCase();
  }, [codigoAcceso, seccionDetectada]);

  const fotosDisponibles = useMemo(() => {
    return obtenerFotosParaGaleria(cursoActivoCodigo);
  }, [cursoActivoCodigo]);

  // Sincronizar selección predeterminada cuando las fotos cargan
  useEffect(() => {
    const inds = fotosDisponibles.filter((f) => f.categoria === 'individual');
    const grups = fotosDisponibles.filter((f) => f.categoria === 'grupal');
    const docs = fotosDisponibles.filter((f) => f.categoria === 'docente');

    if (inds.length > 0 && !inds.some((f) => f.id === fotoSeleccionadaIndividual)) {
      setFotoSeleccionadaIndividual(inds[0].id);
    }
    if (grups.length > 0 && !grups.some((f) => f.id === fotoSeleccionadaGrupal)) {
      setFotoSeleccionadaGrupal(grups[0].id);
    }
    if (docs.length > 0 && !docs.some((f) => f.id === fotoSeleccionadaDocente)) {
      setFotoSeleccionadaDocente(docs[0].id);
    }
  }, [fotosDisponibles]);

  // Step 3: Kit & Extras
  const [selectedKit, setSelectedKit] = useState<KitProducto>(
    KITS_DISPONIBLES.find((k) => k.id === 'kit-clasico') || KITS_DISPONIBLES[0]
  );
  const [extraStickers, setExtraStickers] = useState(false);
  const [extraPortarretrato, setExtraPortarretrato] = useState(false);
  const [extraLlavero, setExtraLlavero] = useState(false);
  // Copia extra de la carpeta completa para abuelos o familiares
  const [extraCarpetas, setExtraCarpetas] = useState<number>(0);

  // Step 4: Checkout
  const [tutorNombre, setTutorNombre] = useState('');
  const [tutorWhatsapp, setTutorWhatsapp] = useState('');
  const [tutorEmail, setTutorEmail] = useState('');
  const [metodoPago, setMetodoPago] = useState<'mercadopago' | 'transferencia'>('mercadopago');
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);
  const [numeroPedido, setNumeroPedido] = useState('');
  const [pedidoGenerado, setPedidoGenerado] = useState<PedidoEscolarCompleto | null>(null);

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
        if (fam.colegioId) {
          const col = colegios.find((c) => c.id === fam.colegioId);
          if (col) setSelectedColegio(col);
        }
      }
    }
  }, [isOpen, colegios]);

  useEffect(() => {
    if (preselectedColegioId) {
      const col = colegios.find((c) => c.id === preselectedColegioId);
      if (col) setSelectedColegio(col);
    } else if (!selectedColegio && colegios.length > 0) {
      setSelectedColegio(colegios[0]);
    }
  }, [preselectedColegioId, colegios]);

  useEffect(() => {
    if (selectedColegio) {
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
    if (preselectedKitId) {
      const k = KITS_DISPONIBLES.find((item) => item.id === preselectedKitId);
      if (k) setSelectedKit(k);
    }
  }, [preselectedKitId]);

  // Function to validate and bind course code or school code
  const validarCodigoIngresado = (codigoInput: string) => {
    const clean = codigoInput.trim().toUpperCase();
    if (!clean) {
      setCodigoErrorMsg('Por favor ingresá un código para validar.');
      setCodigoValidadoMsg(null);
      return false;
    }

    // 1. Search for course section by nemotecnico or PIN
    const match = buscarSeccionPorCodigo(clean);
    if (match) {
      const colInicial = colegios.find((c) => c.id === 'col-isba-2026') || colegios[0];
      setSelectedColegio(colInicial);
      setGrado(match.seccion.sala);
      setTurno(match.seccion.turno);
      setDivision(match.seccion.division);
      setSeccionDetectada(match.seccion);
      setCodigoValidadoMsg(`¡Código reconocido! Curso: ${match.seccion.nombreCompleto}`);
      setCodigoErrorMsg(null);
      return true;
    }

    // 2. Search for general school access code (e.g. ISBA2026)
    const colFound = colegios.find(
      (c) => c.codigoAcceso.toUpperCase() === clean
    );
    if (colFound) {
      setSelectedColegio(colFound);
      setSeccionDetectada(null);
      setCodigoValidadoMsg(`¡Código de institución reconocido: ${colFound.nombre}!`);
      setCodigoErrorMsg(null);
      return true;
    }

    setCodigoErrorMsg(`Código "${codigoInput}" no encontrado. Verificá si está bien escrito o seleccioná tu curso abajo.`);
    setCodigoValidadoMsg(null);
    return false;
  };

  useEffect(() => {
    if (preselectedCodigo) {
      setCodigoAcceso(preselectedCodigo);
      validarCodigoIngresado(preselectedCodigo);
    }
  }, [preselectedCodigo]);

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
  const precioBase = selectedKit.precio;
  const precioStickers = extraStickers ? 2500 : 0;
  const precioPortarretrato = extraPortarretrato ? 4200 : 0;
  const precioLlavero = extraLlavero ? 2200 : 0;
  const totalCopiasExtrasCantidad = extraCarpetas;
  const precioCopiasExtras = extraCarpetas * PRECIO_CARPETA_EXTRA;
  const total = precioBase + precioStickers + precioPortarretrato + precioLlavero + precioCopiasExtras;

  // Handlers
  const handleIngresarCodigo = () => {
    if (!codigoAcceso.trim()) return;
    const ok = validarCodigoIngresado(codigoAcceso);
    if (ok && nombreAlumno.trim()) {
      setStep(2);
    }
  };

  const handleCompletarPago = () => {
    setIsProcessingPayment(true);
    setTimeout(() => {
      const numLista = Math.floor(1 + Math.random() * 25);
      const codCurso = codigoAcceso.trim() || seccionDetectada?.nemotecnico || 'SALA3TM';

      const nuevoPedido = registrarPedidoDesdePortal({
        colegioId: selectedColegio?.id || 'col-divino-pastor',
        colegioNombre: selectedColegio?.nombre || 'Instituto Superior Buenos Aires',
        cursoCodigo: codCurso,
        grado: grado || 'Sala 3',
        division: division || 'Única',
        turno: turno || 'Mañana',
        alumnoNombre: nombreAlumno || 'Alumno Escolar',
        alumnoNumeroLista: numLista,
        tutorNombre: tutorNombre || 'Familia',
        tutorTelefono: tutorWhatsapp || '1154893210',
        tutorEmail: tutorEmail || 'familia@ejemplo.com',
        kitId: selectedKit.id,
        kitNombre: selectedKit.nombre,
        total: total,
        metodoPago: metodoPago,
        fotosSeleccionadas: {
          individualId: fotoSeleccionadaIndividual,
          grupalId: fotoSeleccionadaGrupal,
          docenteId: fotoSeleccionadaDocente,
        },
        copiasExtras: {
          carpetasExtras: extraCarpetas,
          individual15x21: extraCarpetas,
          grupal20x30: extraCarpetas,
          docente15x21: extraCarpetas,
          otras15x21: 0,
        },
      });

      setNumeroPedido(nuevoPedido.id);
      setPedidoGenerado(nuevoPedido);
      setIsProcessingPayment(false);
      setStep(5);
    }, 1200);
  };

  // Tracking query handler
  const handleConsultarSeguimiento = (e?: FormEvent) => {
    if (e) e.preventDefault();
    setTrackingError('');
    const query = trackingQuery.trim().toUpperCase();
    if (!query) {
      setTrackingError('Por favor ingresá tu número de pedido o teléfono');
      return;
    }

    // Búsqueda de pedidos registrados
    const pedidosRegistrados = obtenerPedidosGuardados();
    const cleanNumber = query.replace(/\D/g, '');
    const encontradoEnDb = pedidosRegistrados.find(
      (p) => p.id.toUpperCase().includes(query) || (cleanNumber.length >= 6 && p.tutorTelefono.includes(cleanNumber))
    );

    if (encontradoEnDb) {
      setSearchedOrder({
        id: encontradoEnDb.id,
        colegio: encontradoEnDb.colegioNombre,
        alumno: `${encontradoEnDb.alumnoNombre} (${encontradoEnDb.grado} ${encontradoEnDb.division})`,
        tutor: encontradoEnDb.tutorNombre,
        telefono: encontradoEnDb.tutorTelefono,
        kit: encontradoEnDb.kitNombre,
        total: encontradoEnDb.total,
        fecha: encontradoEnDb.fecha.split(' ')[0],
        estado: encontradoEnDb.estadoEntrega,
        estadoTexto:
          encontradoEnDb.estadoEntrega === 'entregado'
            ? 'Entregado en la Institución'
            : encontradoEnDb.estadoEntrega === 'listo_descarga'
            ? 'Descarga Digital HD Disponible'
            : encontradoEnDb.estadoEntrega === 'en_espera'
            ? 'En Espera de Procesamiento'
            : 'En Laboratorio Fotográfico',
        descripcionEstado:
          'Tus fotos se encuentran en proceso de revelado químico profesional en papel satinado 260g y corte computarizado.',
        pasoActual: 3,
        entregaEstimada: 'Entrega en el colegio coordinada con la dirección',
        descargaLista: true,
      });
      return;
    }

    const mockOrders = [
      {
        id: 'IFS-2026-8812',
        colegio: 'Instituto Superior Buenos Aires',
        alumno: 'Valentina Rossi (3° A)',
        tutor: 'Mariana Gómez',
        telefono: '1154893210',
        kit: 'Kit Impreso + Digital',
        total: 30000,
        fecha: '02/09/2026',
        estado: 'en_laboratorio',
        estadoTexto: 'En Laboratorio Fotográfico',
        descripcionEstado: 'Tus fotos se encuentran en proceso de revelado químico profesional en papel satinado 260g y corte computarizado.',
        pasoActual: 3,
        entregaEstimada: 'Entrega en el colegio: Jueves 10 de Septiembre',
        descargaLista: true,
      },
      {
        id: 'IFS-2026-8809',
        colegio: 'Instituto Superior Buenos Aires',
        alumno: 'Mateo Benítez (1° B)',
        tutor: 'Diego Benítez',
        telefono: '1144559988',
        kit: 'Solo Digital HD',
        total: 15000,
        fecha: '02/09/2026',
        estado: 'listo_descarga',
        estadoTexto: 'Descarga Digital HD Disponible',
        descripcionEstado: 'Tu pago fue acreditado y los archivos digitales en alta definición ya están disponibles para descargar.',
        pasoActual: 4,
        entregaEstimada: 'Archivos listos para guardar en tu dispositivo',
        descargaLista: true,
      },
      {
        id: 'IFS-2026-8795',
        colegio: 'Instituto Superior Buenos Aires',
        alumno: 'Sofía Álvarez (5° Verde)',
        tutor: 'Luciana Álvarez',
        telefono: '1167221100',
        kit: 'Kit Impreso + Digital',
        total: 30000,
        fecha: '01/09/2026',
        estado: 'en_camino',
        estadoTexto: 'Empacado & Rotulado',
        descripcionEstado: 'La carpeta conmemorativa y fotos ampliadas están empaquetadas en sobre individual rotulado para ser entregadas en la institución escolar.',
        pasoActual: 4,
        entregaEstimada: 'Fecha de entrega pautada con el colegio: Viernes 5 de Septiembre',
        descargaLista: true,
      },
    ];

    const found = mockOrders.find(
      (o) => o.id.includes(query) || (cleanNumber.length >= 6 && o.telefono.includes(cleanNumber))
    );

    if (found) {
      setSearchedOrder(found);
    } else {
      // Create dynamically matching order for user's query if it resembles a code
      setSearchedOrder({
        id: query.startsWith('IFS-') ? query : `IFS-2026-${Math.floor(1000 + Math.random() * 9000)}`,
        colegio: selectedColegio ? selectedColegio.nombre : 'Instituto Superior Buenos Aires',
        alumno: nombreAlumno || 'Alumno Escolar',
        tutor: tutorNombre || 'Tutor Familiar',
        telefono: tutorWhatsapp || '11 5489-3210',
        kit: selectedKit.nombre,
        total: total,
        fecha: new Date().toLocaleDateString('es-AR'),
        estado: 'en_laboratorio',
        estadoTexto: 'En Proceso de Laboratorio',
        descripcionEstado: 'Tu pedido ha sido recibido y se encuentra en etapa de copiado y control de calidad.',
        pasoActual: 3,
        entregaEstimada: 'Fecha estimada de entrega en el colegio: dentro de los 7 a 10 días hábiles.',
        descargaLista: true,
      });
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-3 sm:p-4 md:p-6 animate-in fade-in duration-200">
      <div className="relative w-full max-w-5xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden flex flex-col max-h-[92vh]">
        {/* Top Modal Bar */}
        <div className="px-6 py-4 bg-slate-900 text-white flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-amber-400 text-slate-950 flex items-center justify-center font-bold">
              <School className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-base font-bold font-['Outfit'] tracking-wide">
                  Mi InFocus Schools
                </span>
                <span className="text-[10px] bg-slate-800 text-amber-400 font-bold px-2 py-0.5 rounded border border-slate-700">
                  Portal de Familias
                </span>
              </div>
              <p className="text-xs text-slate-400">
                {selectedColegio ? selectedColegio.nombre : 'Seleccioná tu colegio'} · Ciclo 2026
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 sm:gap-4">
            {/* Tab switch between order and tracking */}
            <div className="flex items-center bg-slate-800 p-1 rounded-xl border border-slate-700 text-xs">
              <button
                type="button"
                onClick={() => setModalMode('pedido')}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
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
                  if (!searchedOrder) {
                    setTrackingQuery('IFS-2026-8812');
                  }
                }}
                className={`px-3 py-1.5 rounded-lg font-semibold transition-all cursor-pointer ${
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

            <button
              onClick={onClose}
              className="p-1.5 text-slate-400 hover:text-white rounded-lg hover:bg-slate-800 transition-colors cursor-pointer"
              aria-label="Cerrar"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Scrollable Body */}
        <div className="overflow-y-auto p-5 sm:p-8 flex-1 bg-slate-50/50">
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
                  Ingresá el número de pedido provisto al momento del pago (ej: <strong className="font-mono">IFS-2026-8812</strong>) o tu número de WhatsApp para conocer el estado en tiempo real.
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
                      placeholder="Ej: IFS-2026-8812 o 1154893210..."
                      className="w-full pl-10 pr-3 py-2.5 text-xs text-slate-900 placeholder:text-slate-400 bg-slate-50 rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                  <button
                    type="submit"
                    className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-all cursor-pointer shrink-0 shadow-xs"
                  >
                    Consultar
                  </button>
                </form>

                {trackingError && (
                  <p className="text-[11px] text-red-600 mt-2 text-left px-2">{trackingError}</p>
                )}

                {/* Quick Examples */}
                <div className="mt-3 pt-2.5 border-t border-slate-100 flex flex-wrap items-center gap-1.5 text-[11px] text-slate-500">
                  <span className="font-medium text-slate-400">Probar ejemplos:</span>
                  {['IFS-2026-8812', 'IFS-2026-8809', 'IFS-2026-8795'].map((code) => (
                    <button
                      key={code}
                      type="button"
                      onClick={() => {
                        setTrackingQuery(code);
                        setTimeout(() => handleConsultarSeguimiento(), 50);
                      }}
                      className="px-2 py-0.5 rounded bg-slate-100 hover:bg-amber-100 text-slate-700 font-mono text-[10px] transition-colors cursor-pointer"
                    >
                      {code}
                    </button>
                  ))}
                </div>
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
                        ${searchedOrder.total.toLocaleString('es-AR')} ARS
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
                        <div className="flex items-center gap-1.5 text-emerald-700 font-bold text-xs mb-1">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>2. Pago</span>
                        </div>
                        <p className="text-[10px] text-slate-600">Acreditado</p>
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
                    {searchedOrder.descargaLista && (
                      <a
                        href={FOTOS_MUESTRA[0].url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="w-full sm:w-auto px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center justify-center gap-2"
                      >
                        <Download className="w-3.5 h-3.5 text-amber-400" />
                        <span>Descargar Archivos Digitales HD</span>
                      </a>
                    )}

                    <div className="flex gap-2 w-full sm:w-auto">
                      <a
                        href={`https://wa.me/5491128625916?text=Hola%20InFocus%20Schools,%20consulto%20por%20mi%20pedido%20${searchedOrder.id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex-1 sm:flex-initial px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-xl transition-colors flex items-center justify-center gap-2"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Consultar por WhatsApp</span>
                      </a>
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
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit']">
                  Buscá tu colegio o ingresá tu código
                </h3>
                <p className="text-xs sm:text-sm text-slate-600">
                  Ingresá con los datos de tu hijo/a para abrir su galería protegida con marca de agua.
                </p>
              </div>

              {/* Hero Course Code Access Card */}
              <div className="bg-linear-to-br from-amber-500/10 via-amber-50 to-white rounded-2xl p-5 sm:p-6 border-2 border-amber-300 shadow-sm space-y-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="text-left">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold uppercase tracking-wider mb-1">
                      <Key className="w-3 h-3" />
                      Acceso para Familias
                    </span>
                    <h4 className="text-base sm:text-lg font-extrabold text-slate-900 font-['Outfit']">
                      Ingresá el código de tu curso o institución
                    </h4>
                    <p className="text-xs text-slate-600 mt-0.5">
                      Ingresá el código provisto por la institución o tu docente para cargar automáticamente el curso, turno y división.
                    </p>
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
                      placeholder="Ej: SALA3TM o PASTOR26"
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

                {/* Quick Sample Code Chips */}
                <div className="pt-1 flex flex-wrap items-center gap-1.5 text-left border-t border-amber-200/60">
                  <span className="text-[11px] font-semibold text-amber-900 mr-1">
                    Códigos de prueba rápidos:
                  </span>
                  {[
                    { code: 'SALA3TM', desc: 'Sala 3 TM' },
                    { code: 'SALA3TT', desc: 'Sala 3 TT' },
                    { code: 'SALA4A', desc: 'Sala 4 A (TT)' },
                    { code: 'SALA5BTT', desc: 'Sala 5 B (TT)' },
                    { code: 'ISBA2026', desc: 'Instituto Superior Buenos Aires' },
                    { code: 'PASTOR26', desc: 'Acceso Histórico' },
                  ].map((item) => (
                    <button
                      key={item.code}
                      type="button"
                      onClick={() => {
                        setCodigoAcceso(item.code);
                        validarCodigoIngresado(item.code);
                      }}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-amber-100/80 text-slate-800 hover:text-slate-950 text-[11px] font-mono font-bold border border-amber-300 shadow-2xs transition-all cursor-pointer flex items-center gap-1"
                    >
                      <span className="text-amber-700">{item.code}</span>
                      <span className="text-[10px] text-slate-500 font-sans font-normal">({item.desc})</span>
                    </button>
                  ))}
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
                        <p className="text-[11px] text-emerald-800 mt-0.5">
                          Asignado: {grado} · División {division} · Turno {turno}. Podés confirmar o cambiar los datos a continuación y seleccionar a tu hijo/a.
                        </p>
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
                        Si no recordás o no tenés tu código de curso, contactate por WhatsApp con la institución educativa para que te lo faciliten.
                      </p>
                    </div>
                  </div>
                )}

                {/* WhatsApp Course Code Request Action */}
                <div className="pt-3 border-t border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-left">
                  <div className="text-slate-700 text-xs space-y-0.5">
                    <p className="font-bold text-slate-900 flex items-center gap-1.5">
                      <MessageCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                      <span>¿Aún no tenés tu Código de Curso?</span>
                    </p>
                    <p className="text-[11px] text-slate-600 leading-relaxed">
                      Al momento de inscribirte, contactate por WhatsApp con la institución educativa para solicitar el código con el que podrás acceder a ver las fotos.
                    </p>
                  </div>
                  <a
                    href={`https://wa.me/5491128625916?text=${encodeURIComponent(
                      nombreAlumno.trim()
                        ? `Hola, me inscribí en el portal para las fotos de ${nombreAlumno.trim()} (${grado} "${division}", Turno ${turno}, ${selectedColegio?.nombre || 'Colegio'}). ¿Me podrían facilitar el código de curso para poder acceder a ver las fotos? ¡Muchas gracias!`
                        : `Hola, me inscribí en el portal de fotos escolares para ${selectedColegio?.nombre || 'mi colegio'}. ¿Me podrían facilitar el código de curso con el que podré acceder a ver las fotos? ¡Muchas gracias!`
                    )}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-[#25D366] hover:bg-[#20ba5a] text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer shrink-0 active:scale-98"
                  >
                    <MessageCircle className="w-4 h-4 fill-white" />
                    <span>Solicitar Código por WhatsApp</span>
                  </a>
                </div>
              </div>

              {/* School Search List */}
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                    O elegí tu colegio de la lista:
                  </label>
                </div>

                <div className="relative">
                  <Search className="absolute left-3.5 top-3 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={searchColegio}
                    onChange={(e) => setSearchColegio(e.target.value)}
                    placeholder="Escribí el nombre del colegio o localidad (ej: Divino Pastor, Pilar)..."
                    className="w-full pl-10 pr-4 py-2.5 text-xs sm:text-sm bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 shadow-xs"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-h-56 overflow-y-auto pr-1">
                  {colegiosFiltrados.map((col) => {
                    const isSelected = selectedColegio?.id === col.id;
                    return (
                      <div
                        key={col.id}
                        onClick={() => setSelectedColegio(col)}
                        className={`p-3.5 rounded-xl border text-left cursor-pointer transition-all ${
                          isSelected
                            ? 'bg-amber-50/80 border-amber-400 shadow-xs ring-1 ring-amber-400'
                            : 'bg-white border-slate-200 hover:border-slate-300'
                        }`}
                      >
                        <div className="flex items-start justify-between">
                          <div>
                            <p className="text-xs font-bold text-slate-900">{col.nombre}</p>
                            <p className="text-[11px] text-slate-500">{col.localidad} · {col.zona}</p>
                          </div>
                          {isSelected && (
                            <CheckCircle2 className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Student details form */}
              {selectedColegio && (
                <div className="bg-white p-5 rounded-2xl border border-slate-200 space-y-4 text-left shadow-xs animate-in fade-in duration-150">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider flex items-center gap-1.5">
                      <User className="w-4 h-4 text-amber-600" />
                      <span>Datos del alumno/a en {selectedColegio.nombre}:</span>
                    </h4>
                    {familiaActiva ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[11px] font-semibold text-emerald-800 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-lg flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Inscripto: {familiaActiva.padreNombre} (Tutor)
                        </span>
                        {onOpenInscripcion && (
                          <button
                            type="button"
                            onClick={onOpenInscripcion}
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
                            setTutorNombre('');
                            setTutorWhatsapp('');
                            setTutorEmail('');
                            setNombreAlumno('');
                          }}
                          className="text-[11px] text-rose-600 hover:text-rose-800 underline font-semibold cursor-pointer"
                          title="Cerrar sesión de esta familia"
                        >
                          Cerrar sesión
                        </button>
                      </div>
                    ) : onOpenInscripcion ? (
                      <button
                        type="button"
                        onClick={onOpenInscripcion}
                        className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-950 bg-amber-400 hover:bg-amber-300 px-3 py-1.5 rounded-lg transition-colors cursor-pointer shadow-xs"
                      >
                        <span>Inscribirme / Crear usuario</span>
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    ) : null}
                  </div>

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

                  <div className="pt-2 flex justify-end">
                    <button
                      id="btn-continuar-galeria"
                      onClick={() => setStep(2)}
                      className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer transition-all active:scale-98"
                    >
                      <span>Abrir Galería de Fotos</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* STEP 2: Interactive Photo Gallery */}
          {step === 2 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              {/* Top info bar */}
              <div className="bg-white p-4 rounded-2xl border border-slate-200 shadow-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-900 font-['Outfit']">
                      {nombreAlumno}
                    </span>
                    <span className="text-[10px] bg-amber-100 text-amber-900 font-bold px-2 py-0.5 rounded-full">
                      {grado} "{division}" · Turno {turno}
                    </span>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {selectedColegio?.nombre} · {selectedColegio?.eventoActual}
                  </p>
                </div>

                {/* Active info & Change data button */}
                <div className="flex items-center gap-3">
                  <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-500/10 text-amber-900 border border-amber-300/80 text-[11px] font-bold">
                    <Lock className="w-3.5 h-3.5 text-amber-700" />
                    <span>Muestras protegidas con marca de agua</span>
                  </span>

                  <button
                    onClick={() => setStep(1)}
                    className="text-xs text-slate-500 hover:text-slate-800 font-medium cursor-pointer"
                  >
                    Cambiar datos
                  </button>
                </div>
              </div>

              {/* 3 Fotos Incluidas Top Panel */}
              <div className="bg-slate-900 text-white rounded-2xl p-4 sm:p-5 shadow-md border border-slate-800">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
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
                  <span className="px-3 py-1 rounded-full bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 text-xs font-bold shrink-0 self-start sm:self-auto flex items-center gap-1.5">
                    <CheckCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>3 de 3 fotos seleccionadas</span>
                  </span>
                </div>

                {/* 3 Slots */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1 text-left">
                  {/* Slot 1: Grupal */}
                  <div
                    onClick={() => setCategoriaActiva('grupal')}
                    className={`bg-slate-800/80 hover:bg-slate-800 rounded-xl p-2.5 flex items-center gap-3 transition-all cursor-pointer group border ${
                      categoriaActiva === 'grupal' ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-13 h-13 rounded-lg overflow-hidden bg-slate-950 shrink-0 relative border border-slate-700">
                      <img
                        src={fotosDisponibles.find((f) => f.id === fotoSeleccionadaGrupal)?.thumbnail || fotosDisponibles.find(f => f.categoria === 'grupal')?.thumbnail || FOTOS_MUESTRA[3].thumbnail}
                        alt="Foto grupal"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-amber-400 block uppercase tracking-wider">
                        Foto 1 de 3 (Grupal 20x30)
                      </span>
                      <p className="text-xs font-bold text-white truncate group-hover:text-amber-300">
                        {fotosDisponibles.find((f) => f.id === fotoSeleccionadaGrupal)?.titulo?.split(' - ')[0] || 'Foto Grupal'}
                      </p>
                      <span className="text-[10px] text-slate-400">Clic para cambiar</span>
                    </div>
                  </div>

                  {/* Slot 2: Retrato Individual */}
                  <div
                    onClick={() => setCategoriaActiva('individual')}
                    className={`bg-slate-800/80 hover:bg-slate-800 rounded-xl p-2.5 flex items-center gap-3 transition-all cursor-pointer group border ${
                      categoriaActiva === 'individual' ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-13 h-13 rounded-lg overflow-hidden bg-slate-950 shrink-0 relative border border-slate-700">
                      <img
                        src={fotosDisponibles.find((f) => f.id === fotoSeleccionadaIndividual)?.thumbnail || fotosDisponibles.find(f => f.categoria === 'individual')?.thumbnail || FOTOS_MUESTRA[0].thumbnail}
                        alt="Retrato individual"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-amber-400 block uppercase tracking-wider">
                        Foto 2 de 3 (Retrato 15x21)
                      </span>
                      <p className="text-xs font-bold text-white truncate group-hover:text-amber-300">
                        {fotosDisponibles.find((f) => f.id === fotoSeleccionadaIndividual)?.titulo?.split(' - ')[1] || fotosDisponibles.find((f) => f.id === fotoSeleccionadaIndividual)?.titulo || 'Retrato Individual'}
                      </p>
                      <span className="text-[10px] text-slate-400">Clic para cambiar toma</span>
                    </div>
                  </div>

                  {/* Slot 3: Con Docente */}
                  <div
                    onClick={() => setCategoriaActiva('docente')}
                    className={`bg-slate-800/80 hover:bg-slate-800 rounded-xl p-2.5 flex items-center gap-3 transition-all cursor-pointer group border ${
                      categoriaActiva === 'docente' ? 'border-amber-400 ring-1 ring-amber-400/40' : 'border-slate-700 hover:border-slate-600'
                    }`}
                  >
                    <div className="w-13 h-13 rounded-lg overflow-hidden bg-slate-950 shrink-0 relative border border-slate-700">
                      <img
                        src={fotosDisponibles.find((f) => f.id === fotoSeleccionadaDocente)?.thumbnail || fotosDisponibles.find(f => f.categoria === 'docente')?.thumbnail || FOTOS_MUESTRA[5].thumbnail}
                        alt="Con docente"
                        className="w-full h-full object-cover"
                      />
                      <div className="absolute inset-0 bg-black/20 flex items-center justify-center">
                        <Check className="w-3.5 h-3.5 text-emerald-400 stroke-[3]" />
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <span className="text-[10px] font-bold text-amber-400 block uppercase tracking-wider">
                        Foto 3 de 3 (Con Seño 15x21)
                      </span>
                      <p className="text-xs font-bold text-white truncate group-hover:text-amber-300">
                        {fotosDisponibles.find((f) => f.id === fotoSeleccionadaDocente)?.titulo || 'Con la Seño'}
                      </p>
                      <span className="text-[10px] text-slate-400">Clic para cambiar</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Category tabs */}
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-200 pb-3">
                <div className="flex flex-wrap gap-2">
                  {[
                    { id: 'individual', label: 'Retratos Individuales (3 tomas)' },
                    { id: 'grupal', label: 'Foto Grupal de Grado' },
                    { id: 'docente', label: 'Con la Seño / Docente' },
                    { id: 'patio', label: 'Otras Fotos' },
                  ].map((cat) => (
                    <button
                      key={cat.id}
                      onClick={() => setCategoriaActiva(cat.id as any)}
                      className={`px-3.5 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer ${
                        categoriaActiva === cat.id
                          ? 'bg-slate-900 text-white shadow-xs'
                          : 'bg-white text-slate-600 hover:bg-slate-100 border border-slate-200'
                      }`}
                    >
                      {cat.label}
                    </button>
                  ))}
                </div>

                {extraCarpetas > 0 && (
                  <span className="text-xs font-bold px-3 py-1 bg-amber-100 text-amber-900 border border-amber-300 rounded-full flex items-center gap-1.5 shadow-2xs">
                    <Copy className="w-3.5 h-3.5 text-amber-700" />
                    <span>{extraCarpetas} carpeta(s) extra(s) agregada(s)</span>
                  </span>
                )}
              </div>

              {/* Photo Cards Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {fotosDisponibles.filter((f) => f.categoria === categoriaActiva).map((foto) => {
                  const isSelected =
                    foto.id === fotoSeleccionadaIndividual ||
                    foto.id === fotoSeleccionadaGrupal ||
                    foto.id === fotoSeleccionadaDocente;

                  const handleSelectThisFoto = () => {
                    if (foto.categoria === 'individual') setFotoSeleccionadaIndividual(foto.id);
                    if (foto.categoria === 'grupal') setFotoSeleccionadaGrupal(foto.id);
                    if (foto.categoria === 'docente') setFotoSeleccionadaDocente(foto.id);
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

                        {/* Watermark overlay matching exact sample */}
                        <WatermarkOverlay visible={showWatermark} />

                        {/* Status badge */}
                        {isSelected && (
                          <div className="absolute top-2.5 left-2.5">
                            <span className="px-2.5 py-1 rounded-md bg-amber-400 text-slate-950 text-[11px] font-extrabold flex items-center gap-1 shadow-md">
                              <Check className="w-3.5 h-3.5 stroke-[3]" />
                              <span>En el Pack Oficial</span>
                            </span>
                          </div>
                        )}

                        {/* Zoom button */}
                        <button
                          type="button"
                          onClick={() => setModalFotoPreview(foto)}
                          className="absolute bottom-2.5 right-2.5 p-1.5 rounded-lg bg-white/90 hover:bg-white text-slate-800 text-xs shadow-md transition-colors cursor-pointer"
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
                            {foto.categoria === 'grupal' ? 'Formato 20x30 cm' : 'Formato 15x21 cm'}
                          </span>
                        </div>

                        {/* Primary Pack selection button */}
                        {foto.categoria !== 'patio' && (
                          <button
                            type="button"
                            onClick={handleSelectThisFoto}
                            className={`shrink-0 py-1.5 px-3 rounded-lg text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
                              isSelected
                                ? 'bg-amber-400 text-slate-950 shadow-xs'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isSelected ? (
                              <>
                                <CheckCircle2 className="w-3.5 h-3.5 text-slate-950" />
                                <span>Elegida</span>
                              </>
                            ) : (
                              <span>Elegir</span>
                            )}
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Dedicated Extra Copies Section in Step 2: Copia Extra de la Carpeta */}
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

                  {/* Single Clean Selector */}
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
                        onClick={() => setExtraCarpetas((prev) => prev + 1)}
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
                </div>

                {extraCarpetas > 0 && (
                  <div className="mt-3 pt-3 border-t border-amber-200/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2 text-amber-950 font-semibold">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>
                        Recibirás <strong>{extraCarpetas + 1} carpetas completas</strong> en total (1 del pack principal + {extraCarpetas} para abuelos/familiares).
                      </span>
                    </div>
                    <span className="font-extrabold text-amber-900 bg-white px-2.5 py-1 rounded-lg border border-amber-300">
                      Subtotal carpetas extras: +${(extraCarpetas * PRECIO_CARPETA_EXTRA).toLocaleString('es-AR')}
                    </span>
                  </div>
                )}
              </div>

              {/* Bottom Next Step Bar */}
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
                    onClick={() => setStep(3)}
                    className="px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer transition-all active:scale-98"
                  >
                    <span>Elegir Kit y Formato</span>
                    {totalCopiasExtrasCantidad > 0 && (
                      <span className="px-2 py-0.5 bg-slate-950 text-amber-300 rounded text-[11px] font-black">
                        ${total.toLocaleString('es-AR')}
                      </span>
                    )}
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: Kit Selection & Add-ons */}
          {step === 3 && (
            <div className="space-y-6 animate-in fade-in duration-200">
              <div className="text-center max-w-xl mx-auto">
                <h3 className="text-2xl font-extrabold text-slate-900 font-['Outfit']">
                  Elegí tu Kit Fotográfico
                </h3>
                <p className="text-xs text-slate-500 mt-1">
                  Todos los paquetes incluyen copias de alta definición y garantía de satisfacción.
                </p>
              </div>

              {/* Kits 3 cards */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
                {KITS_DISPONIBLES.map((kit) => {
                  const isSelected = selectedKit.id === kit.id;
                  return (
                    <div
                      key={kit.id}
                      onClick={() => setSelectedKit(kit)}
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

              {/* Copia Extra de Carpeta Escolar Completa (Para Abuelos / Familiares) */}
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
                        onClick={() => setExtraCarpetas((prev) => prev + 1)}
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
                </div>

                {extraCarpetas > 0 && (
                  <div className="p-3 rounded-xl bg-amber-100/70 border border-amber-200 text-xs text-amber-950 flex items-start gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <span>
                        <strong>Carpetas a confeccionar:</strong> 1 Carpeta del pack principal + {extraCarpetas} carpeta{extraCarpetas > 1 ? 's' : ''} extra{extraCarpetas > 1 ? 's' : ''} = <strong>{extraCarpetas + 1} carpetas completas</strong> en total (+${(extraCarpetas * PRECIO_CARPETA_EXTRA).toLocaleString('es-AR')}).
                      </span>
                    </div>
                  </div>
                )}
              </div>

              {/* Optional Add-ons */}
              <div className="bg-white rounded-2xl p-5 border border-slate-200 text-left space-y-3">
                <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider">
                  Adicionales opcionales para complementar tu pedido:
                </h4>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div
                    onClick={() => setExtraStickers(!extraStickers)}
                    className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      extraStickers
                        ? 'bg-amber-50/80 border-amber-400'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        8 Stickers personalizados
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Para cuadernos y cartucheras (+ $2.500)
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ml-2 ${
                        extraStickers
                          ? 'bg-amber-400 border-amber-500 text-slate-950'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {extraStickers && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>

                  <div
                    onClick={() => setExtraPortarretrato(!extraPortarretrato)}
                    className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      extraPortarretrato
                        ? 'bg-amber-50/80 border-amber-400'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        Portarretrato de álamo
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Madera natural 15x21 cm (+ $4.200)
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ml-2 ${
                        extraPortarretrato
                          ? 'bg-amber-400 border-amber-500 text-slate-950'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {extraPortarretrato && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>

                  <div
                    onClick={() => setExtraLlavero(!extraLlavero)}
                    className={`p-3.5 rounded-xl border flex items-center justify-between cursor-pointer transition-all ${
                      extraLlavero
                        ? 'bg-amber-50/80 border-amber-400'
                        : 'bg-slate-50 border-slate-200 hover:border-slate-300'
                    }`}
                  >
                    <div>
                      <p className="text-xs font-bold text-slate-900">
                        Llavero escolar bifaz
                      </p>
                      <p className="text-[11px] text-slate-500">
                        Acrílico con foto individual y grupal (+ $2.200)
                      </p>
                    </div>
                    <div
                      className={`w-5 h-5 rounded-md border flex items-center justify-center shrink-0 ml-2 ${
                        extraLlavero
                          ? 'bg-amber-400 border-amber-500 text-slate-950'
                          : 'border-slate-300 bg-white'
                      }`}
                    >
                      {extraLlavero && <Check className="w-3.5 h-3.5 stroke-[3]" />}
                    </div>
                  </div>
                </div>
              </div>

              {/* Subtotal & Navigation */}
              <div className="pt-4 border-t border-slate-200 flex flex-col sm:flex-row items-center justify-between gap-4">
                <div className="text-left">
                  <span className="text-xs text-slate-500">Total a pagar:</span>
                  <div className="text-2xl font-black text-slate-900 font-['Outfit']">
                    ${total.toLocaleString('es-AR')}{' '}
                    <span className="text-xs font-normal text-slate-500">ARS</span>
                  </div>
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
          {step === 4 && (
            <div className="max-w-3xl mx-auto space-y-6 animate-in fade-in duration-200 text-left">
              <div className="text-center space-y-1">
                <h3 className="text-2xl font-extrabold text-slate-900 font-['Outfit']">
                  Confirmación y Pago Seguro
                </h3>
                <p className="text-xs text-slate-500">
                  Ingresá el WhatsApp donde querés recibir el link de descarga y el comprobante del pedido.
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
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Número de WhatsApp (con código de área)
                    </label>
                    <div className="relative">
                      <span className="absolute left-3 top-2 text-xs font-bold text-slate-500">
                        +54 9
                      </span>
                      <input
                        type="text"
                        value={tutorWhatsapp}
                        onChange={(e) => setTutorWhatsapp(e.target.value)}
                        placeholder="11 1234-5678"
                        className="w-full pl-16 pr-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <p className="text-[10px] text-slate-400 mt-1">
                      Te enviaremos aquí el link de descarga HD y avisos de entrega.
                    </p>
                  </div>

                  <div>
                    <label className="text-[11px] font-semibold text-slate-600 block mb-1">
                      Correo Electrónico
                    </label>
                    <input
                      type="email"
                      value={tutorEmail}
                      onChange={(e) => setTutorEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <h4 className="text-xs font-bold text-slate-700 uppercase tracking-wider pt-2">
                    2. Método de Pago Online
                  </h4>

                  <div className="grid grid-cols-2 gap-2">
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
                        <strong>Alias:</strong> <span className="font-mono">RETRATO.ESCOLAR</span>
                      </p>
                      <p className="text-slate-700">
                        <strong>CBU:</strong> <span className="font-mono">0070012345678901234567</span>
                      </p>
                      <p className="text-slate-700">
                        <strong>Titular:</strong> Retrato Escolar Fotografía · CUIT 30-71829341-8
                      </p>
                    </div>
                  )}
                </div>

                {/* Summary Box */}
                <div className="md:col-span-5 bg-slate-900 text-white p-5 rounded-2xl flex flex-col justify-between shadow-lg">
                  <div className="space-y-4">
                    <div className="border-b border-slate-800 pb-3">
                      <p className="text-[11px] uppercase tracking-wider text-amber-400 font-bold">
                        Resumen del Pedido
                      </p>
                      <p className="text-sm font-bold text-white mt-1">{selectedKit.nombre}</p>
                      <p className="text-xs text-slate-400">
                        {nombreAlumno} · {grado} "{division}"
                      </p>
                    </div>

                    <div className="space-y-2 text-xs text-slate-300">
                      <div className="flex justify-between">
                        <span>{selectedKit.nombre}</span>
                        <span>${precioBase.toLocaleString('es-AR')}</span>
                      </div>
                      {extraStickers && (
                        <div className="flex justify-between">
                          <span>Plancha 8 stickers</span>
                          <span>$2.500</span>
                        </div>
                      )}
                      {extraPortarretrato && (
                        <div className="flex justify-between">
                          <span>Portarretrato madera</span>
                          <span>$4.200</span>
                        </div>
                      )}
                      {extraLlavero && (
                        <div className="flex justify-between">
                          <span>Llavero escolar bifaz</span>
                          <span>$2.200</span>
                        </div>
                      )}
                      {extraCarpetas > 0 && (
                        <div className="flex justify-between text-amber-300 font-semibold">
                          <span>Carpeta Escolar Extra Completa (x{extraCarpetas})</span>
                          <span>+${(extraCarpetas * PRECIO_CARPETA_EXTRA).toLocaleString('es-AR')}</span>
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
                        ${total.toLocaleString('es-AR')}{' '}
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
                          <span>Pagar ${total.toLocaleString('es-AR')} ARS</span>
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
              <div className="w-16 h-16 rounded-full bg-emerald-100 text-emerald-700 flex items-center justify-center mx-auto shadow-md">
                <CheckCircle2 className="w-9 h-9" />
              </div>

              <div>
                <span className="text-xs font-bold text-emerald-800 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200 uppercase tracking-wider">
                  ¡Pago Aprobado con Éxito!
                </span>
                <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit'] mt-3">
                  ¡Gracias por tu compra, {tutorNombre}!
                </h3>
                <p className="text-xs sm:text-sm text-slate-600 mt-2">
                  El pedido de <strong>{nombreAlumno}</strong> para{' '}
                  <strong>{selectedColegio?.nombre}</strong> ya está registrado.
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
                  <span className="px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-800 text-xs font-bold">
                    Aprobado
                  </span>
                </div>

                {/* Email Delivery Confirmation Card */}
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

                {/* Photo Lab File Renaming & Student Folder Information */}
                {pedidoGenerado && (
                  <div className="p-3.5 rounded-xl bg-slate-900 text-white text-xs space-y-2">
                    <div className="flex items-center justify-between pb-1 border-b border-slate-800">
                      <div className="flex items-center gap-1.5 text-amber-400 font-bold">
                        <FolderCheck className="w-4 h-4" />
                        <span>Carpeta del Alumno para Laboratorio:</span>
                      </div>
                      <span className="font-mono text-[11px] bg-slate-800 px-2 py-0.5 rounded text-amber-300">
                        {pedidoGenerado.codigoAlumno}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-400">
                      Tus fotos elegidas se organizaron y renombraron con el código único del alumno para que el minilab fotográfico imprima su nombre en el dorso:
                    </p>

                    <div className="space-y-1 font-mono text-[10px] bg-slate-950/80 p-2.5 rounded-lg border border-slate-800">
                      {pedidoGenerado.archivosParaLaboratorio.map((archivo, idx) => (
                        <div
                          key={idx}
                          className={`flex items-center justify-between gap-1.5 p-1 rounded ${
                            archivo.esCopiaExtra
                              ? 'bg-amber-950/70 border border-amber-500/40 text-amber-300 font-bold'
                              : 'text-slate-300'
                          }`}
                        >
                          <div className="flex items-center gap-1.5 truncate">
                            <FileCode
                              className={`w-3.5 h-3.5 shrink-0 ${
                                archivo.esCopiaExtra ? 'text-amber-400' : 'text-emerald-400'
                              }`}
                            />
                            <span className="text-slate-400 capitalize">
                              {archivo.tipo} ({archivo.tamanoImpresion}):
                            </span>
                            <span className={archivo.esCopiaExtra ? 'text-amber-200 truncate' : 'text-emerald-300 font-semibold truncate'}>
                              {archivo.nombreArchivoLab}
                            </span>
                          </div>
                          {archivo.esCopiaExtra ? (
                            <span className="text-[9px] bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded font-black uppercase shrink-0">
                              Copia Extra Duplicada
                            </span>
                          ) : (
                            <span className="text-[9px] text-slate-500 uppercase shrink-0">Original</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="text-xs text-slate-600 space-y-1">
                  <p>
                    <strong>Kit:</strong> {selectedKit.nombre} (${total.toLocaleString('es-AR')} ARS)
                  </p>
                  <p>
                    <strong>Curso:</strong> {grado} "{division}" · Turno {turno}
                  </p>
                  <p>
                    <strong>Entrega impresa:</strong> Se entrega en sobre cerrado rotulado con el código y nombre del alumno en la institución.
                  </p>
                  <p>
                    <strong>WhatsApp de contacto:</strong> {tutorWhatsapp}
                  </p>
                </div>
              </div>

              {/* Instant Download Action */}
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
                  href={FOTOS_MUESTRA[0].url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-4 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-bold rounded-xl transition-all shadow-xs flex items-center gap-1.5 shrink-0 cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" />
                  <span>Descargar Fotos HD</span>
                </a>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
                <a
                  href={`https://wa.me/5491128625916?text=Hola%20InFocus%20Schools,%20hice%20el%20pedido%20${numeroPedido}%20para%20${encodeURIComponent(
                    nombreAlumno
                  )}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center justify-center gap-2"
                >
                  <PhoneCall className="w-4 h-4" />
                  <span>Avisar por WhatsApp</span>
                </a>

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

              {/* Watermark overlay matching exact sample */}
              <WatermarkOverlay visible={showWatermark} />
            </div>

            <div className="p-3 flex items-center justify-between">
              <div>
                <p className="text-xs font-bold text-white">{modalFotoPreview.titulo}</p>
              </div>
              <button
                onClick={() => setModalFotoPreview(null)}
                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs rounded-lg font-semibold"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
