import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  X, Lock, Camera, Upload, CheckCircle2, DollarSign, Package,
  School, RefreshCw, Eye, AlertCircle, ArrowRight, Users, Search, CheckSquare, Square, Download,
  Key, Copy, Check, MessageSquare, Sparkles, Send, ExternalLink, Printer, HardDrive, FileCode, Mail,
  FileSpreadsheet, Scissors, FileText, UserCheck, Trash2, Phone, Save, Database, Globe,
  Pencil, Loader2, Link2, UploadCloud
} from 'lucide-react';
import {
  obtenerConfiguracionWhatsApp,
  guardarNumeroWhatsAppFlotante,
  sanitizarNumeroWhatsApp,
  formatearNumeroVisual,
  ConfiguracionWhatsApp
} from '../services/configuracionService';
import { FOTOS_MUESTRA, KITS_DISPONIBLES } from '../data/colegiosData';
import { useColegiosLista, obtenerTokensPadronAdmin, regenerarTokenPadronAdmin, obtenerAlumnosNominaAdmin, AlumnoNominaReal } from '../services/colegiosService';
import { SeccionEscolar } from '../data/alumnosData';
import {
  obtenerCodigosSeccionAdmin,
  asegurarCodigoSeccionAdmin,
  regenerarCodigoSeccionAdmin,
  actualizarCodigoSeccionAdmin
} from '../services/codigosSeccionService';
import {
  obtenerPedidosGuardados,
  guardarPedidosEnStorage,
  PedidoEscolarCompleto,
  obtenerPedidosAdminDesdeSupabase,
  combinarPedidosConLocal
} from '../services/pedidosLabService';
import {
  obtenerInscripcionesAdmin,
  determinarCodigoParaInscripcion
} from '../services/inscripcionesService';
import { 
  descargarExcelLegibleColegio,
  descargarCSVEspañolCompatible,
  descargarGuiaWhatsAppTxt,
  generarGuiaWhatsAppColegioTexto,
  generarMensajeWhatsApp
} from '../services/difusionEscolarService';
import { descargarLibroExcel } from '../services/excelDownloadHelper';
import {
  obtenerResumenCierreAnio,
  ejecutarCierreAnio,
  ResumenCierreAnio
} from '../services/cierreAnioService';
import AdminLaboratorioTab from './AdminLaboratorioTab';
import AdminLoteFotosTab from './AdminLoteFotosTab';
import {
  loginAdminConServidor,
  verificarSesionAdmin,
  cerrarSesionAdmin,
  actualizarEstadoPedidoAdmin,
  eliminarPedidoAdmin
} from '../services/adminAuthService';
import AdminInscriptosTab from './AdminInscriptosTab';
import AdminPadronTab from './AdminPadronTab';
import AdminEstadoPagosTab from './AdminEstadoPagosTab';
import AdminImportarAlumnosTab from './AdminImportarAlumnosTab';
import AdminSolicitudesCodigoTab from './AdminSolicitudesCodigoTab';
import { obtenerSolicitudesCodigoAdmin } from '../services/solicitudesCodigoService';
import AdminConfigWhatsAppTab from './AdminConfigWhatsAppTab';
import AdminResumenKitsSection from './AdminResumenKitsSection';
import { CircularImprimibleModal } from './CircularImprimibleModal';
import { enviarFotosPorEmail } from '../services/emailService';
import { Colegio, Foto } from '../types';

interface AdminModalProps {
  isOpen: boolean;
  onClose: () => void;
  onProbarCodigo?: (codigo: string) => void;
}

const OPCIONES_GRADOS_COLEGIO = [
  'Sala 3 años', 'Sala 4 años', 'Sala 5 años',
  '1° grado', '2° grado', '3° grado', '4° grado', '5° grado', '6° grado', '7° grado',
  '1° año', '2° año', '3° año', '4° año', '5° año', '6° año',
];
const OPCIONES_DIVISIONES_COLEGIO = ['A', 'B', 'C', 'D', 'Jornada Extendida'];
const OPCIONES_TURNOS_COLEGIO = ['Mañana', 'Tarde', 'Jornada Extendida', 'Jornada Completa'];

interface SelectorMultipleProps {
  value: string;
  onChange: (nuevoValor: string) => void;
  opciones: string[];
  placeholderOtro?: string;
}

// Checkboxes para las opciones habituales + campo "Agregar otro" para valores personalizados.
// Mantiene el mismo formato de string separado por comas que usaba el textarea/input original,
// así que no requiere tocar el resto de la lógica de guardado/edición de colegios.
function SelectorMultiple({ value, onChange, opciones, placeholderOtro }: SelectorMultipleProps) {
  const [otroTexto, setOtroTexto] = useState('');
  const seleccionados = value.split(',').map((v) => v.trim()).filter(Boolean);
  const extras = seleccionados.filter((v) => !opciones.includes(v));

  const toggle = (op: string) => {
    if (seleccionados.includes(op)) {
      onChange(seleccionados.filter((v) => v !== op).join(', '));
    } else {
      onChange([...seleccionados, op].join(', '));
    }
  };

  const quitarExtra = (op: string) => {
    onChange(seleccionados.filter((v) => v !== op).join(', '));
  };

  const agregarOtro = () => {
    const limpio = otroTexto.trim();
    setOtroTexto('');
    if (!limpio || seleccionados.includes(limpio)) return;
    onChange([...seleccionados, limpio].join(', '));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {opciones.map((op) => {
          const activo = seleccionados.includes(op);
          return (
            <label
              key={op}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border text-[11px] font-semibold cursor-pointer select-none transition-colors ${
                activo
                  ? 'bg-amber-100 border-amber-400 text-amber-800'
                  : 'bg-white border-slate-300 text-slate-600 hover:border-slate-400'
              }`}
            >
              <input
                type="checkbox"
                checked={activo}
                onChange={() => toggle(op)}
                className="w-3.5 h-3.5 accent-amber-500 cursor-pointer"
              />
              {op}
            </label>
          );
        })}
        {extras.map((op) => (
          <span
            key={op}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-blue-300 bg-blue-50 text-blue-800 text-[11px] font-semibold"
          >
            {op}
            <button
              type="button"
              onClick={() => quitarExtra(op)}
              className="text-blue-400 hover:text-blue-700 cursor-pointer leading-none"
              title="Quitar"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="flex gap-1.5">
        <input
          type="text"
          value={otroTexto}
          onChange={(e) => setOtroTexto(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              agregarOtro();
            }
          }}
          placeholder={placeholderOtro || 'Agregar otro...'}
          className="flex-1 px-3 py-1.5 rounded-lg border border-slate-300 text-xs bg-white"
        />
        <button
          type="button"
          onClick={agregarOtro}
          className="px-3 py-1.5 rounded-lg border border-slate-300 bg-slate-100 hover:bg-slate-200 text-xs font-bold text-slate-700 cursor-pointer"
        >
          + Agregar
        </button>
      </div>
    </div>
  );
}

export default function AdminModal({ isOpen, onClose, onProbarCodigo }: AdminModalProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [adminPin, setAdminPin] = useState('');
  const [pinError, setPinError] = useState('');
  const [isLoggingIn, setIsLoggingIn] = useState(false);

  // Check existing authenticated session on mount
  useEffect(() => {
    if (isOpen) {
      verificarSesionAdmin().then((valido) => {
        if (valido) {
          setIsAuthenticated(true);
        }
      });
    }
  }, [isOpen]);

  // Admin tabs - Inscriptos & Laboratorio as primary tools for photographers
  const [activeTab, setActiveTab] = useState<'inscriptos' | 'padron' | 'laboratorio' | 'pedidos' | 'subir' | 'codigos' | 'alumnos' | 'colegios' | 'cerrar-anio' | 'whatsapp' | 'solicitudes' | 'estado-pagos' | 'importar-alumnos'>('inscriptos');

  // Real synced orders for photo lab and families
  const [pedidosCompletos, setPedidosCompletos] = useState<PedidoEscolarCompleto[]>(() => obtenerPedidosGuardados());
  // Id del pedido que se está eliminando (para deshabilitar el botón mientras se procesa)
  const [eliminandoPedidoId, setEliminandoPedidoId] = useState<string | null>(null);

  // Auditoría 2026-09-09 (revisión a fondo): antes esta lista salía únicamente del localStorage
  // del navegador — abrir el panel desde otra computadora mostraba "0 pedidos" aunque hubiera
  // pedidos reales y pagados en Supabase. Ahora se trae la lista real del servidor y se combina
  // con lo que haya en este navegador (por si algún pedido recién creado todavía no se refleja
  // en una lectura posterior); Supabase manda como fuente de la verdad.
  const sincronizarPedidosDesdeSupabase = async () => {
    const [pedidosServidor, pedidosLocales] = [await obtenerPedidosAdminDesdeSupabase(), obtenerPedidosGuardados()];
    const combinados = combinarPedidosConLocal(pedidosServidor, pedidosLocales);
    setPedidosCompletos(combinados);
    guardarPedidosEnStorage(combinados);
  };

  const handleEliminarPedido = async (pedido: PedidoEscolarCompleto) => {
    const confirmado = window.confirm(
      `¿Eliminar el pedido ${pedido.id} de ${pedido.alumnoNombre}?\n\nEsta acción no se puede deshacer.`
    );
    if (!confirmado) return;

    setEliminandoPedidoId(pedido.id);
    try {
      const resultado = await eliminarPedidoAdmin(pedido.supabaseId || pedido.id);
      if (!resultado.success) {
        window.alert(resultado.error || 'No se pudo eliminar el pedido.');
        return;
      }
      const actualizados = pedidosCompletos.filter((item) => item.id !== pedido.id);
      setPedidosCompletos(actualizados);
      guardarPedidosEnStorage(actualizados);
    } catch (e: any) {
      window.alert(e?.message || 'Error de red al eliminar el pedido.');
    } finally {
      setEliminandoPedidoId(null);
    }
  };

  // Pending inscriptions count
  const [pendientesInscripcionCount, setPendientesInscripcionCount] = useState<number>(0);
  // Pending "no encuentro mi código" requests count
  const [pendientesSolicitudesCodigoCount, setPendientesSolicitudesCodigoCount] = useState<number>(0);

  // Schools list state from dynamic persistent service (Supabase, compartido para todo el sitio)
  const { colegios: colegiosList, agregarColegio, editarColegio, borrarColegio } = useColegiosLista();

  useEffect(() => {
    if (isOpen && isAuthenticated) {
      setPedidosCompletos(obtenerPedidosGuardados());
      sincronizarPedidosDesdeSupabase();
      obtenerInscripcionesAdmin().then((inscriptos) => {
        setPendientesInscripcionCount(inscriptos.filter((i) => i.estado === 'pendiente').length);
      });
      obtenerSolicitudesCodigoAdmin('pendiente').then((solicitudes) => {
        setPendientesSolicitudesCodigoCount(solicitudes.length);
      });
    }
  }, [isOpen, isAuthenticated, activeTab]);

  // Links secretos de carga de padrón por colegio (solo se piden cuando hacen falta)
  const [padronTokens, setPadronTokens] = useState<Record<string, string>>({});
  const [copiadoPadronId, setCopiadoPadronId] = useState<string | null>(null);
  const [regenerandoPadronId, setRegenerandoPadronId] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen && isAuthenticated && activeTab === 'colegios') {
      obtenerTokensPadronAdmin().then(setPadronTokens);
    }
  }, [isOpen, isAuthenticated, activeTab]);

  // WhatsApp configuration state (persistent in Supabase 'configuracion' & localStorage)
  const [whatsappNumero, setWhatsappNumero] = useState<string>(() => {
    const cfg = obtenerConfiguracionWhatsApp();
    return cfg.whatsappFlotante || cfg.whatsappSolicitudCodigo || '5491128625916';
  });
  const [whatsappGuardando, setWhatsappGuardando] = useState(false);
  const [whatsappFeedback, setWhatsappFeedback] = useState<string | null>(null);
  const [whatsappError, setWhatsappError] = useState<string | null>(null);

  // Synchronize on mount and listen to global updates
  useEffect(() => {
    const handleConfigActualizada = (e: any) => {
      const cfg = e.detail as ConfiguracionWhatsApp;
      if (cfg?.whatsappFlotante) {
        setWhatsappNumero(cfg.whatsappFlotante);
      }
    };
    window.addEventListener('whatsapp_config_actualizada', handleConfigActualizada);
    return () => {
      window.removeEventListener('whatsapp_config_actualizada', handleConfigActualizada);
    };
  }, []);

  const handleGuardarWhatsApp = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setWhatsappGuardando(true);
    setWhatsappFeedback(null);
    setWhatsappError(null);

    const limpio = sanitizarNumeroWhatsApp(whatsappNumero);
    if (!limpio) {
      setWhatsappError('Por favor, ingresá un número de WhatsApp válido con código de país.');
      setWhatsappGuardando(false);
      return;
    }

    try {
      // Auditoría 2026-09-09: acá había un segundo camino que escribía directo a la tabla
      // 'configuracion' con la clave anónima del navegador (además del que ya hacía
      // guardarNumeroWhatsAppFlotante más abajo) — dependía de una política de RLS que en los
      // hechos permitía escribir a cualquiera sin login, que es justo el agujero que se cerró.
      // Se saca este camino duplicado: guardarNumeroWhatsAppFlotante ya guarda en Supabase de
      // forma correcta, pasando por el servidor con sesión de admin.
      const resultado = await guardarNumeroWhatsAppFlotante(limpio);
      const persistidoEnSupabase = resultado.supabaseOk;
      setWhatsappNumero(limpio);

      setWhatsappFeedback(
        persistidoEnSupabase
          ? `¡Número ${formatearNumeroVisual(limpio)} guardado y persistido con éxito en Supabase!`
          : `¡Número ${formatearNumeroVisual(limpio)} guardado con éxito! El widget flotante ya lo está consumiendo dinámicamente.`
      );

      setTimeout(() => {
        setWhatsappFeedback(null);
      }, 5000);
    } catch (err: any) {
      setWhatsappError(`Error al guardar en Supabase: ${err?.message || 'Error inesperado'}`);
    } finally {
      setWhatsappGuardando(false);
    }
  };

  // Nómina real del padrón (tabla 'alumnos' de Supabase) — se carga temprano porque tanto la
  // pestaña de Nómina como la de Códigos & Difusión (más abajo) la necesitan.
  const [alumnosNominaReal, setAlumnosNominaReal] = useState<AlumnoNominaReal[]>([]);
  const [cargandoNominaReal, setCargandoNominaReal] = useState(false);

  const cargarNominaReal = async () => {
    setCargandoNominaReal(true);
    try {
      const data = await obtenerAlumnosNominaAdmin();
      setAlumnosNominaReal(data);
    } finally {
      setCargandoNominaReal(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated) {
      cargarNominaReal();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated]);

  // Códigos & Difusión WhatsApp — auditoría 2026-09-09: esta pestaña mostraba códigos
  // inventados y guardados solo en el navegador (localStorage, ver antiguo
  // src/data/codigosCursos.ts), sin ninguna relación con los códigos REALES que
  // /api/fotos exige para dejar entrar a una familia (tabla `codigos_seccion`). Un
  // colegio podía terminar recibiendo por WhatsApp un código que nunca iba a funcionar
  // en el sitio. Ahora esta pestaña lee y escribe directamente esos códigos reales
  // (ver services/codigosSeccionService.ts) y es específica por colegio, igual que la
  // pestaña de Nómina y la de Carga de Fotos.
  const [copiadoFeedback, setCopiadoFeedback] = useState<string | null>(null);
  const [filtroSalaCodigos, setFiltroSalaCodigos] = useState<string>('todas');
  const [mensajeWhatsAppModal, setMensajeWhatsAppModal] = useState<{ seccion: any; codigo: string; texto: string } | null>(null);
  const [colegioIdCodigos, setColegioIdCodigos] = useState<string>(() => colegiosList[0]?.id || '');
  const [codigosRealesMap, setCodigosRealesMap] = useState<Record<string, string>>({});
  const [cargandoCodigosReales, setCargandoCodigosReales] = useState(false);
  const [guardandoCodigoId, setGuardandoCodigoId] = useState<string | null>(null);
  const [errorCodigos, setErrorCodigos] = useState<string | null>(null);

  const handleCopiarTexto = (texto: string, label: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoFeedback(label);
    setTimeout(() => setCopiadoFeedback(null), 2500);
  };

  const [mostrarCircularModal, setMostrarCircularModal] = useState(false);
  const [seccionParaCircular, setSeccionParaCircular] = useState<string | undefined>(undefined);

  const colegioActualNombre = colegiosList[0]?.nombre || 'Instituto Madre del Divino Pastor';
  const colegioCodigosNombre = colegiosList.find((c) => c.id === colegioIdCodigos)?.nombre || colegioActualNombre;

  // Alumnos reales (tabla `alumnos`) del colegio elegido en esta pestaña.
  const alumnosColegioCodigos = useMemo(
    () => alumnosNominaReal.filter((a) => a.colegio_id === colegioIdCodigos),
    [alumnosNominaReal, colegioIdCodigos]
  );

  // "Secciones" derivadas de grado + turno + división de esos alumnos reales — igual que
  // en la pestaña de Nómina, no hay una tabla fija de secciones (cada colegio tiene las
  // suyas). Se les da la forma de SeccionEscolar para poder reusar tal cual el modal de
  // circulares imprimibles y todas las funciones de difusionEscolarService.ts.
  const seccionesCodigosReales: SeccionEscolar[] = useMemo(() => {
    const mapa = new Map<string, SeccionEscolar>();
    alumnosColegioCodigos.forEach((a) => {
      const grado = a.grado || 'Sin grado';
      const turno = a.turno || 'Sin turno';
      const division = a.division || '-';
      const id = `${grado}__${turno}__${division}`;
      const existente = mapa.get(id);
      if (existente) {
        existente.totalAlumnos += 1;
      } else {
        mapa.set(id, {
          id,
          sala: grado,
          turno: turno as SeccionEscolar['turno'],
          division,
          nombreCompleto: `${grado} "${division}" (${turno})`,
          totalAlumnos: 1,
        });
      }
    });
    return Array.from(mapa.values()).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
  }, [alumnosColegioCodigos]);

  const gradosDisponiblesCodigos = useMemo(() => {
    const set = new Set(seccionesCodigosReales.map((s) => s.sala));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'es'));
  }, [seccionesCodigosReales]);

  const cargarCodigosReales = async (colegioId: string) => {
    if (!colegioId) {
      setCodigosRealesMap({});
      return;
    }
    setCargandoCodigosReales(true);
    setErrorCodigos(null);
    try {
      const codigos = await obtenerCodigosSeccionAdmin(colegioId);
      const mapa: Record<string, string> = {};
      codigos.forEach((c) => {
        const id = `${c.grado || 'Sin grado'}__${c.turno || 'Sin turno'}__${c.division || '-'}`;
        mapa[id] = c.codigo_secreto;
      });
      setCodigosRealesMap(mapa);
    } finally {
      setCargandoCodigosReales(false);
    }
  };

  useEffect(() => {
    if (isAuthenticated && colegioIdCodigos) {
      cargarCodigosReales(colegioIdCodigos);
      setFiltroSalaCodigos('todas');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, colegioIdCodigos]);

  const handleAsegurarCodigo = async (sec: SeccionEscolar) => {
    setGuardandoCodigoId(sec.id);
    setErrorCodigos(null);
    const resultado = await asegurarCodigoSeccionAdmin(colegioIdCodigos, sec.sala, sec.turno, sec.division);
    setGuardandoCodigoId(null);
    if (!resultado.success || !resultado.codigo) {
      setErrorCodigos(resultado.error || 'No se pudo generar el código.');
      return;
    }
    setCodigosRealesMap((prev) => ({ ...prev, [sec.id]: resultado.codigo! }));
  };

  const handleRegenerarCodigo = async (sec: SeccionEscolar) => {
    if (!window.confirm(`¿Generar un código NUEVO para "${sec.nombreCompleto}"? El código anterior dejará de funcionar para las familias que ya lo tengan.`)) {
      return;
    }
    setGuardandoCodigoId(sec.id);
    setErrorCodigos(null);
    const resultado = await regenerarCodigoSeccionAdmin(colegioIdCodigos, sec.sala, sec.turno, sec.division);
    setGuardandoCodigoId(null);
    if (!resultado.success || !resultado.codigo) {
      setErrorCodigos(resultado.error || 'No se pudo regenerar el código.');
      return;
    }
    setCodigosRealesMap((prev) => ({ ...prev, [sec.id]: resultado.codigo! }));
    setCopiadoFeedback(`Código regenerado para ${sec.nombreCompleto}: ${resultado.codigo}`);
    setTimeout(() => setCopiadoFeedback(null), 3000);
  };

  const handleGuardarCodigoManual = async (sec: SeccionEscolar, nuevoCodigo: string) => {
    const limpio = nuevoCodigo.trim();
    if (!limpio) return;
    setGuardandoCodigoId(sec.id);
    setErrorCodigos(null);
    const resultado = await actualizarCodigoSeccionAdmin(colegioIdCodigos, sec.sala, sec.turno, sec.division, limpio);
    setGuardandoCodigoId(null);
    if (!resultado.success || !resultado.codigo) {
      setErrorCodigos(resultado.error || 'No se pudo guardar el código (¿ya lo está usando otra sección?).');
      return;
    }
    setCodigosRealesMap((prev) => ({ ...prev, [sec.id]: resultado.codigo! }));
    setCopiadoFeedback(`Código guardado: ${resultado.codigo}`);
    setTimeout(() => setCopiadoFeedback(null), 2000);
  };

  const handleAsegurarTodosLosCodigos = async () => {
    const faltantes = seccionesCodigosReales.filter((sec) => !codigosRealesMap[sec.id]);
    if (faltantes.length === 0) {
      setCopiadoFeedback('Todas las secciones ya tienen un código asignado.');
      setTimeout(() => setCopiadoFeedback(null), 2500);
      return;
    }
    setCargandoCodigosReales(true);
    for (const sec of faltantes) {
      const resultado = await asegurarCodigoSeccionAdmin(colegioIdCodigos, sec.sala, sec.turno, sec.division);
      if (resultado.success && resultado.codigo) {
        setCodigosRealesMap((prev) => ({ ...prev, [sec.id]: resultado.codigo! }));
      }
    }
    setCargandoCodigosReales(false);
    setCopiadoFeedback(`¡Códigos generados para ${faltantes.length} sección(es) sin código!`);
    setTimeout(() => setCopiadoFeedback(null), 3000);
  };

  const handleDescargarExcelLegible = () => {
    try {
      const alumnosParaDifusion = alumnosColegioCodigos.map((a) => ({
        nombre: a.nombre,
        grado: a.grado,
        turno: a.turno,
        division: a.division,
      }));
      descargarExcelLegibleColegio(seccionesCodigosReales, codigosRealesMap, colegioCodigosNombre, undefined, alumnosParaDifusion);
      setCopiadoFeedback('¡Libro de Microsoft Excel (.XLSX) con 3 hojas descargado con éxito!');
      setTimeout(() => setCopiadoFeedback(null), 3500);
    } catch (err) {
      console.error('Error al descargar Excel legible:', err);
      setCopiadoFeedback('Hubo un inconveniente al generar el archivo Excel.');
      setTimeout(() => setCopiadoFeedback(null), 3500);
    }
  };

  const handleExportarNominaExcel = () => {
    try {
      const wb = XLSX.utils.book_new();
      const data = alumnosFiltradosAdmin.map((a, idx) => ({
        'N°': a.numero_lista ?? idx + 1,
        'Apellido y Nombre': a.nombre,
        'Curso / Grado': a.grado,
        'Turno': a.turno || '',
        'División': a.division,
        // Código de referencia visual (misma fórmula que usa el checkout real); ver
        // determinarCodigoParaInscripcion — no es el código secreto real de la sección
        // (ese vive en la tabla codigos_seccion), sólo sirve de guía para el fotógrafo.
        'Código de Referencia': determinarCodigoParaInscripcion({ grado: a.grado, turno: a.turno || '', division: a.division }),
        'DNI': a.dni || '',
        'Fotos Incluidas en Paquete': '3 tomas (Retrato, Grupo, Docente)'
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 30 },
        { wch: 26 },
        { wch: 12 },
        { wch: 10 },
        { wch: 20 },
        { wch: 14 },
        { wch: 35 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Nómina Alumnos');

      const nombreArchivo = `NOMINA_ALUMNOS_${colegioActualNombre.replace(/\s+/g, '_')}_${filtroSeccionAlumnos}.xlsx`;
      const ok = descargarLibroExcel(wb, nombreArchivo);

      if (ok) {
        setCopiadoFeedback('¡Nómina de alumnos exportada a Excel (.XLSX) exitosamente!');
      } else {
        setCopiadoFeedback('No se pudo iniciar la descarga. Verifique los permisos de su navegador.');
      }
      setTimeout(() => setCopiadoFeedback(null), 3000);
    } catch (err) {
      console.error('Error al exportar nómina a Excel:', err);
      setCopiadoFeedback('Hubo un inconveniente al exportar la nómina a Excel.');
      setTimeout(() => setCopiadoFeedback(null), 3000);
    }
  };

  const handleExportarCSVEspañol = () => {
    descargarCSVEspañolCompatible(seccionesCodigosReales, codigosRealesMap, colegioCodigosNombre);
    setCopiadoFeedback('¡CSV descargado con codificación UTF-8 compatible con Excel en español!');
    setTimeout(() => setCopiadoFeedback(null), 3000);
  };

  const handleCopiarPackCompletoWhatsApp = () => {
    const guiaTexto = generarGuiaWhatsAppColegioTexto(seccionesCodigosReales, codigosRealesMap, colegioCodigosNombre);
    navigator.clipboard.writeText(guiaTexto);
    setCopiadoFeedback('¡Pack completo de WhatsApp copiado al portapapeles para enviar a la Dirección!');
    setTimeout(() => setCopiadoFeedback(null), 3500);
  };

  const handleDescargarGuiaTxt = () => {
    descargarGuiaWhatsAppTxt(seccionesCodigosReales, codigosRealesMap, colegioCodigosNombre);
    setCopiadoFeedback('¡Guía de mensajes en archivo de texto (.TXT) descargada!');
    setTimeout(() => setCopiadoFeedback(null), 3000);
  };

  // Alumnos roster states — auditoría 2026-09-09: antes esta pestaña mostraba
  // ALUMNOS_NOMINA_2026, una lista de 211 alumnos escrita a mano en el código para una sola
  // sala de nivel inicial. La nómina real (la que se carga por el importador de padrón) vive
  // en la tabla 'alumnos' de Supabase — hoy son 600 alumnos de "Instituto Madre del Divino
  // Pastor", con grados de primaria (1° a 6°), nada que ver con esa lista vieja. Ahora se trae
  // la nómina real del servidor.
  const [filtroSeccionAlumnos, setFiltroSeccionAlumnos] = useState<string>('todas');
  const [busquedaAlumnos, setBusquedaAlumnos] = useState<string>('');
  const [checkedAlumnos, setCheckedAlumnos] = useState<Record<string, boolean>>({});

  // "Sección" real derivada de grado + turno + división de cada alumno (no hay ninguna tabla
  // fija de secciones para esto — cada colegio que se cargue puede tener grados distintos).
  const seccionIdDeAlumno = (a: AlumnoNominaReal): string =>
    `${a.grado || '-'}__${a.turno || '-'}__${a.division || '-'}`;

  // Distingue Primaria/Inicial de Secundaria por el texto del grado: "1° año".."6° año" es
  // secundaria; "1° grado".."7° grado" y "Sala X años" son primaria/inicial. Se usa \b para que
  // "años" (plural, de "Sala 3 años") no matchee "año" (singular, de secundaria) por error.
  const esGradoDeSecundaria = (grado: string | null | undefined): boolean => /\baño\b/i.test(grado || '');

  const seccionesReales = useMemo(() => {
    const mapa = new Map<string, { id: string; nombreCompleto: string; totalAlumnos: number; esSecundaria: boolean }>();
    alumnosNominaReal.forEach((a) => {
      const id = seccionIdDeAlumno(a);
      const existente = mapa.get(id);
      if (existente) {
        existente.totalAlumnos += 1;
      } else {
        mapa.set(id, {
          id,
          nombreCompleto: `${a.grado || 'Sin grado'} "${a.division || '-'}" (${a.turno || 'Turno sin definir'})`,
          totalAlumnos: 1,
          esSecundaria: esGradoDeSecundaria(a.grado),
        });
      }
    });
    return Array.from(mapa.values()).sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, 'es'));
  }, [alumnosNominaReal]);

  // Auditoría 2026-09 (pedido de Pablo): la nómina de Instituto Madre del Divino Pastor ya
  // junta Primaria/Inicial y Secundaria en una sola lista de 33 secciones — se separan acá para
  // poder mostrar dos desplegables independientes en vez de uno solo con todo mezclado.
  const seccionesPrimaria = useMemo(() => seccionesReales.filter((s) => !s.esSecundaria), [seccionesReales]);
  const seccionesSecundaria = useMemo(() => seccionesReales.filter((s) => s.esSecundaria), [seccionesReales]);
  const totalAlumnosPrimaria = useMemo(
    () => seccionesPrimaria.reduce((acc, s) => acc + s.totalAlumnos, 0),
    [seccionesPrimaria]
  );
  const totalAlumnosSecundaria = useMemo(
    () => seccionesSecundaria.reduce((acc, s) => acc + s.totalAlumnos, 0),
    [seccionesSecundaria]
  );
  const idsSeccionesPrimaria = useMemo(() => new Set(seccionesPrimaria.map((s) => s.id)), [seccionesPrimaria]);
  const idsSeccionesSecundaria = useMemo(() => new Set(seccionesSecundaria.map((s) => s.id)), [seccionesSecundaria]);

  const toggleCheckAlumno = (id: string) => {
    setCheckedAlumnos(prev => ({ ...prev, [id]: !prev[id] }));
  };

  const toggleSelectAllSeccion = () => {
    const allChecked = alumnosFiltradosAdmin.every(a => checkedAlumnos[a.id]);
    const next = { ...checkedAlumnos };
    alumnosFiltradosAdmin.forEach(a => {
      next[a.id] = !allChecked;
    });
    setCheckedAlumnos(next);
  };

  const alumnosFiltradosAdmin = useMemo(() => {
    return alumnosNominaReal.filter((alu) => {
      const matchSeccion =
        filtroSeccionAlumnos === 'todas' ||
        (filtroSeccionAlumnos === 'todas-primaria' && !esGradoDeSecundaria(alu.grado)) ||
        (filtroSeccionAlumnos === 'todas-secundaria' && esGradoDeSecundaria(alu.grado)) ||
        seccionIdDeAlumno(alu) === filtroSeccionAlumnos;
      const q = busquedaAlumnos.toLowerCase().trim();
      const matchSearch = !q ||
        alu.nombre.toLowerCase().includes(q) ||
        alu.grado.toLowerCase().includes(q);
      return matchSeccion && matchSearch;
    });
  }, [alumnosNominaReal, filtroSeccionAlumnos, busquedaAlumnos]);

  // Upload photo state
  const [targetColegioId, setTargetColegioId] = useState(() => colegiosList[0]?.id || 'col-isba-2026');
  const [targetCategoria, setTargetCategoria] = useState<'individual' | 'grupal' | 'docente'>('individual');
  const [targetGrado, setTargetGrado] = useState('3° grado');
  const [targetDivision, setTargetDivision] = useState('A');
  const [targetTitulo, setTargetTitulo] = useState('Retrato Individual - Toma Nueva');
  const [previewRawUrl, setPreviewRawUrl] = useState<string | null>(null);
  const [watermarkedUrl, setWatermarkedUrl] = useState<string | null>(null);
  const [isProcessingWatermark, setIsProcessingWatermark] = useState(false);
  const [uploadSuccess, setUploadSuccess] = useState(false);

  // Cierre de año (borrado de temporada, ver services/cierreAnioService.ts)
  const [cierreAnioColegioId, setCierreAnioColegioId] = useState<string>(() => colegiosList[0]?.id || '');
  const [cierreAnioResumen, setCierreAnioResumen] = useState<ResumenCierreAnio | null>(null);
  const [cierreAnioNombreConfirmado, setCierreAnioNombreConfirmado] = useState<string>('');
  const [cargandoResumenCierre, setCargandoResumenCierre] = useState(false);
  const [errorCierreAnio, setErrorCierreAnio] = useState<string | null>(null);
  const [textoConfirmacionCierre, setTextoConfirmacionCierre] = useState('');
  const [ejecutandoCierreAnio, setEjecutandoCierreAnio] = useState(false);
  const [resultadoCierreAnio, setResultadoCierreAnio] = useState<{ familias: number; alumnos: number; fotos: number; pedidos: number } | null>(null);

  // New / editing school state (el mismo formulario sirve para alta y edición)
  const [colegioEditandoId, setColegioEditandoId] = useState<string | null>(null);
  const [nuevoNombre, setNuevoNombre] = useState('');
  const [nuevaLocalidad, setNuevaLocalidad] = useState('');
  const [nuevaZona, setNuevaZona] = useState<'CABA' | 'Zona Norte' | 'Zona Sur' | 'Zona Oeste'>('CABA');
  const [nuevoCodigo, setNuevoCodigo] = useState('');
  const [nuevoWhatsapp, setNuevoWhatsapp] = useState('');
  const [nuevosGrados, setNuevosGrados] = useState('');
  const [nuevasDivisiones, setNuevasDivisiones] = useState('');
  const [nuevosTurnos, setNuevosTurnos] = useState('');
  const [guardandoColegio, setGuardandoColegio] = useState(false);
  const [errorColegio, setErrorColegio] = useState<string | null>(null);
  const [borrandoColegioId, setBorrandoColegioId] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const clean = adminPin.trim();
    if (!clean) {
      setPinError('Ingresá el PIN de acceso.');
      return;
    }

    setIsLoggingIn(true);
    setPinError('');

    try {
      const res = await loginAdminConServidor(clean);
      if (res.success) {
        setIsAuthenticated(true);
        setPinError('');
        setAdminPin('');
      } else {
        setPinError(res.error || 'PIN incorrecto.');
      }
    } catch {
      setPinError('Error de conexión al autenticar contra el servidor.');
    } finally {
      setIsLoggingIn(false);
    }
  };

  const handleCerrarSesion = () => {
    cerrarSesionAdmin();
    setIsAuthenticated(false);
    setAdminPin('');
  };

  // Watermark generator via HTML5 Canvas
  const processImageWatermark = (rawUrl: string): Promise<string> => {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext('2d');
        if (!ctx) {
          resolve(rawUrl);
          return;
        }

        ctx.drawImage(img, 0, 0);

        ctx.save();
        const text = 'RETRATO ESCOLAR · MUESTRA';
        const fontSize = Math.max(18, Math.round(canvas.width * 0.045));
        ctx.font = `bold ${fontSize}px sans-serif`;
        ctx.fillStyle = 'rgba(255, 255, 255, 0.7)';
        ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
        ctx.shadowBlur = 8;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        ctx.translate(canvas.width / 2, canvas.height / 2);
        ctx.rotate((-25 * Math.PI) / 180);

        const stepX = canvas.width * 0.5;
        const stepY = canvas.height * 0.25;
        for (let y = -canvas.height; y < canvas.height; y += stepY) {
          for (let x = -canvas.width; x < canvas.width; x += stepX) {
            ctx.fillText(text, x, y);
          }
        }
        ctx.restore();

        resolve(canvas.toDataURL('image/jpeg', 0.85));
      };
      img.src = rawUrl;
    });
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsProcessingWatermark(true);
    const reader = new FileReader();
    reader.onload = async (event) => {
      const raw = event.target?.result as string;
      setPreviewRawUrl(raw);
      const watermarked = await processImageWatermark(raw);
      setWatermarkedUrl(watermarked);
      setIsProcessingWatermark(false);
    };
    reader.readAsDataURL(file);
  };

  const handleUploadSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!watermarkedUrl) return;

    setUploadSuccess(true);
    setTimeout(() => {
      setUploadSuccess(false);
      setPreviewRawUrl(null);
      setWatermarkedUrl(null);
    }, 3000);
  };

  const parseListaColegio = (texto: string): string[] =>
    texto.split(',').map((v) => v.trim()).filter(Boolean);

  const limpiarFormularioColegio = () => {
    setColegioEditandoId(null);
    setNuevoNombre('');
    setNuevaLocalidad('');
    setNuevaZona('CABA');
    setNuevoCodigo('');
    setNuevoWhatsapp('');
    setNuevosGrados('');
    setNuevasDivisiones('');
    setNuevosTurnos('');
    setErrorColegio(null);
  };

  const handleEditarColegioClick = (c: Colegio) => {
    setColegioEditandoId(c.id);
    setNuevoNombre(c.nombre);
    setNuevaLocalidad(c.localidad);
    setNuevaZona(c.zona);
    setNuevoCodigo(c.codigoAcceso);
    setNuevoWhatsapp(c.whatsappContacto || '');
    setNuevosGrados((c.grados || []).join(', '));
    setNuevasDivisiones((c.divisiones || []).join(', '));
    setNuevosTurnos((c.turnos || []).join(', '));
    setErrorColegio(null);
  };

  const handleCrearColegio = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nuevoNombre.trim() || !nuevoCodigo.trim()) return;

    setGuardandoColegio(true);
    setErrorColegio(null);

    const datos = {
      nombre: nuevoNombre.trim(),
      localidad: nuevaLocalidad.trim() || 'Buenos Aires',
      zona: nuevaZona,
      codigoAcceso: nuevoCodigo.toUpperCase().trim(),
      whatsappContacto: nuevoWhatsapp.trim() || undefined,
      grados: parseListaColegio(nuevosGrados),
      divisiones: parseListaColegio(nuevasDivisiones),
      turnos: parseListaColegio(nuevosTurnos),
    };

    const resultado = colegioEditandoId
      ? await editarColegio(colegioEditandoId, datos)
      : await agregarColegio(datos);

    setGuardandoColegio(false);

    if (!resultado.success) {
      setErrorColegio(resultado.error || 'No se pudo guardar el colegio.');
      return;
    }

    limpiarFormularioColegio();
  };

  // Nombre exacto que hay que escribir para confirmar el cierre de año del colegio/ámbito
  // elegido actualmente (el servidor valida esto mismo del lado suyo, contra el nombre real).
  const fraseConfirmacionCierreAnio =
    cierreAnioColegioId === 'todos'
      ? 'CERRAR TODOS LOS COLEGIOS'
      : `CERRAR ${(colegiosList.find((c) => c.id === cierreAnioColegioId)?.nombre || '').toUpperCase()}`;

  const handleVerResumenCierreAnio = async () => {
    if (!cierreAnioColegioId) return;
    setCargandoResumenCierre(true);
    setErrorCierreAnio(null);
    setResultadoCierreAnio(null);
    setTextoConfirmacionCierre('');
    const resultado = await obtenerResumenCierreAnio(cierreAnioColegioId);
    setCargandoResumenCierre(false);
    if (!resultado.success || !resultado.resumen) {
      setErrorCierreAnio(resultado.error || 'No se pudo armar el resumen.');
      setCierreAnioResumen(null);
      return;
    }
    setCierreAnioResumen(resultado.resumen);
    setCierreAnioNombreConfirmado(resultado.colegioNombre || '');
  };

  const handleEjecutarCierreAnio = async () => {
    if (!cierreAnioColegioId || !cierreAnioResumen) return;
    const totalAfectado =
      cierreAnioResumen.alumnos + cierreAnioResumen.familias + cierreAnioResumen.pedidos + cierreAnioResumen.fotos;
    if (
      !window.confirm(
        `Esta acción borra ${totalAfectado} registros de temporada (alumnos, familias, pedidos, fotos y más) de forma DEFINITIVA. No se puede deshacer.\n\n¿Confirmás que querés continuar?`
      )
    ) {
      return;
    }
    setEjecutandoCierreAnio(true);
    setErrorCierreAnio(null);
    const resultado = await ejecutarCierreAnio(cierreAnioColegioId, textoConfirmacionCierre);
    setEjecutandoCierreAnio(false);
    if (!resultado.success) {
      setErrorCierreAnio(resultado.error || 'No se pudo cerrar el año.');
      return;
    }
    setResultadoCierreAnio(resultado.borrados || null);
    setCierreAnioResumen(null);
    setTextoConfirmacionCierre('');
    // La nómina y la lista de colegios pudieron haber cambiado — se refrescan solas.
    cargarNominaReal();
  };

  const handleBorrarColegioClick = async (c: Colegio) => {
    if (!window.confirm(`¿Deseás eliminar "${c.nombre}"?`)) return;

    setBorrandoColegioId(c.id);
    const resultado = await borrarColegio(c.id);
    setBorrandoColegioId(null);

    if (!resultado.success) {
      setErrorColegio(resultado.error || 'No se pudo eliminar el colegio.');
      return;
    }

    if (colegioEditandoId === c.id) {
      limpiarFormularioColegio();
    }
  };

  const construirLinkPadron = (colegioId: string): string => {
    const token = padronTokens[colegioId];
    if (!token) return '';
    // Link corto: el código de padrón ya es único de por sí, no hace falta el UUID del colegio.
    return `${window.location.origin}/padron.html?c=${encodeURIComponent(token)}`;
  };

  const handleCopiarLinkPadron = async (colegioId: string) => {
    const link = construirLinkPadron(colegioId);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopiadoPadronId(colegioId);
      setTimeout(() => setCopiadoPadronId((actual) => (actual === colegioId ? null : actual)), 2000);
    } catch {
      window.prompt('Copiá el link manualmente:', link);
    }
  };

  const handleRegenerarPadron = async (c: Colegio) => {
    if (!window.confirm(`¿Regenerar el link de carga de padrón de "${c.nombre}"? El link anterior dejará de funcionar.`)) return;

    setRegenerandoPadronId(c.id);
    const resultado = await regenerarTokenPadronAdmin(c.id);
    setRegenerandoPadronId(null);

    if (!resultado.success || !resultado.codigoPadron) {
      setErrorColegio(resultado.error || 'No se pudo regenerar el link de padrón.');
      return;
    }

    setPadronTokens((actual) => ({ ...actual, [c.id]: resultado.codigoPadron! }));
  };

  const totalRecaudado = pedidosCompletos.reduce((acc, p) => p.estadoPago === 'aprobado' ? acc + p.total : acc, 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white w-full h-full max-w-none max-h-none overflow-hidden flex flex-col shadow-2xl">
        
        {/* Modal Header — auditoría 2026-09 (pedido de Pablo): a la mitad de alto que antes */}
        <div className="px-4 py-2 sm:px-5 sm:py-2.5 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500 text-slate-950 flex items-center justify-center font-bold shrink-0">
              <Camera className="w-3.5 h-3.5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-sm font-bold font-['Outfit'] leading-tight">Panel de Control para Fotógrafos</h2>
                <span className="text-[9px] uppercase font-bold tracking-wider px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Interno
                </span>
              </div>
              <p className="text-[11px] text-slate-400 leading-tight hidden sm:block">
                Gestión de pedidos familiares, subida con marca de agua y colegios
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={handleCerrarSesion}
                className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-[11px] font-bold text-slate-300 transition-colors cursor-pointer"
                title="Cerrar sesión de administrador"
              >
                Cerrar Sesión
              </button>
            )}
            <button
              onClick={onClose}
              className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Auth Gate */}
        {!isAuthenticated ? (
          <div className="p-8 sm:p-12 max-w-md mx-auto my-auto text-center space-y-5">
            <div className="w-14 h-14 rounded-2xl bg-amber-100 text-amber-900 flex items-center justify-center mx-auto">
              <Lock className="w-7 h-7" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-slate-900 font-['Outfit']">Acceso Restringido</h3>
              <p className="text-xs text-slate-500 mt-1">
                Ingresá tu PIN de fotógrafo para acceder a la consola administrativa.
              </p>
            </div>

            <form onSubmit={handleLogin} className="space-y-3">
              <input
                type="password"
                value={adminPin}
                onChange={e => {
                  setAdminPin(e.target.value);
                  setPinError('');
                }}
                disabled={isLoggingIn}
                placeholder="Ingresá tu PIN de fotógrafo"
                className="w-full text-center px-4 py-3 rounded-xl border border-slate-300 text-sm font-bold tracking-widest focus:ring-2 focus:ring-amber-500 focus:outline-none disabled:opacity-50"
              />
              {pinError && <p className="text-xs text-rose-600 font-semibold">{pinError}</p>}

              <button
                type="submit"
                disabled={isLoggingIn}
                className="w-full py-3 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 font-bold text-sm shadow transition-all cursor-pointer flex items-center justify-center gap-2"
              >
                {isLoggingIn ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin" />
                    <span>Validando PIN en el servidor...</span>
                  </>
                ) : (
                  <span>Ingresar al Panel</span>
                )}
              </button>
            </form>
          </div>
        ) : (
          /* Authenticated Admin Dashboard */
          <div className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-3">

            {/* Navigation tabs: al inicio del panel, botones azul oscuro con letras
                amarillas. Antes era una fila con scroll horizontal que escondía la
                mayoría de las herramientas fuera de la vista. Ahora es una grilla que se
                acomoda sola (flex-wrap) y muestra todas las pestañas de una sola vez. */}
            <div className="flex flex-wrap gap-2 p-2 bg-slate-100/70 rounded-2xl">
              {[
                {
                  id: 'inscriptos',
                  label:
                    pendientesInscripcionCount > 0
                      ? `Inscriptos (${pendientesInscripcionCount} pendientes)`
                      : 'Inscriptos & Envío Códigos',
                  icon: UserCheck,
                  badge: pendientesInscripcionCount > 0 ? pendientesInscripcionCount : undefined
                },
                { id: 'padron', label: 'Padrón Autorizado', icon: Link2 },
                {
                  id: 'solicitudes',
                  label:
                    pendientesSolicitudesCodigoCount > 0
                      ? `Solicitudes de Código (${pendientesSolicitudesCodigoCount})`
                      : 'Solicitudes de Código',
                  icon: MessageSquare,
                  badge: pendientesSolicitudesCodigoCount > 0 ? pendientesSolicitudesCodigoCount : undefined,
                },
                { id: 'laboratorio', label: 'Laboratorio & Ensobrado (ZIP)', icon: Printer },
                { id: 'pedidos', label: `Pedidos Familias (${pedidosCompletos.length})`, icon: Package },
                { id: 'subir', label: 'Cargar Fotos Curso (100GB Supabase)', icon: HardDrive },
                { id: 'codigos', label: 'Códigos & Difusión WhatsApp', icon: Key },
                { id: 'alumnos', label: `Nómina 2026 (${alumnosNominaReal.length})`, icon: Users },
                { id: 'importar-alumnos', label: 'Importar Alumnos', icon: UploadCloud },
                { id: 'estado-pagos', label: 'Estado de Pagos por Curso', icon: DollarSign },
                { id: 'colegios', label: 'Colegios y Códigos', icon: School },
                { id: 'cerrar-anio', label: 'Cerrar Año', icon: Trash2 },
                { id: 'whatsapp', label: 'WhatsApp & Widget Flotante', icon: MessageSquare },
              ].map(t => {
                const Icon = t.icon;
                const active = activeTab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setActiveTab(t.id as any)}
                    className={`px-3.5 py-2.5 rounded-xl text-xs sm:text-sm font-bold flex items-center gap-2 transition-all cursor-pointer bg-blue-950 text-amber-400 border ${
                      active
                        ? 'border-amber-400 shadow-md shadow-blue-950/30 ring-2 ring-amber-400/40 text-amber-300'
                        : 'border-blue-900 hover:bg-blue-900 hover:text-amber-300'
                    }`}
                  >
                    <Icon className="w-4 h-4 shrink-0" />
                    <span>{t.label}</span>
                    {t.badge && (
                      <span className="px-1.5 py-0.2 rounded-full text-[10px] font-extrabold bg-amber-500 text-slate-950">
                        {t.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Top metrics: tarjetas compactas en una sola línea, para no ocupar
                media pantalla mostrando 3 números. */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <div className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 font-semibold">Recaudación Confirmada</span>
                <div className="text-sm font-black text-slate-900 font-['Outfit'] whitespace-nowrap">
                  ${totalRecaudado.toLocaleString('es-AR')} <span className="text-[10px] font-normal text-slate-500">ARS</span>
                </div>
              </div>

              <div className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 font-semibold">Pedidos Totales</span>
                <div className="text-sm font-black text-slate-900 font-['Outfit'] whitespace-nowrap">
                  {pedidosCompletos.length} pedidos
                </div>
              </div>

              <div className="px-3.5 py-2 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-between gap-2">
                <span className="text-[11px] text-slate-500 font-semibold">Colegios Activos</span>
                <div className="text-sm font-black text-slate-900 font-['Outfit'] whitespace-nowrap">
                  {colegiosList.length} instituciones
                </div>
              </div>
            </div>

            {/* SECCIÓN RESUMEN DE KITS SELECCIONADOS POR FAMILIAS (SUPABASE DB) */}
            <AdminResumenKitsSection />

            {/* TAB: INSCRIPTOS & GESTIÓN DE ACCESOS */}
            {activeTab === 'inscriptos' && (
              <AdminInscriptosTab onProbarCodigo={onProbarCodigo} />
            )}

            {/* TAB: PADRÓN AUTORIZADO (Excel/CSV) */}
            {activeTab === 'padron' && (
              <AdminPadronTab />
            )}

            {/* TAB: SOLICITUDES DE CÓDIGO (reemplaza el botón que abría WhatsApp por cada familia) */}
            {activeTab === 'solicitudes' && (
              <AdminSolicitudesCodigoTab />
            )}

            {/* TAB: LABORATORIO & ENSOBRADO */}
            {activeTab === 'laboratorio' && (
              <AdminLaboratorioTab
                pedidos={pedidosCompletos}
                onActualizarPedidos={(actualizados) => {
                  setPedidosCompletos(actualizados);
                  guardarPedidosEnStorage(actualizados);
                }}
                colegioNombre={colegiosList[0]?.nombre}
              />
            )}

            {/* TAB 1: PEDIDOS */}
            {activeTab === 'pedidos' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-bold text-slate-900">Listado de Pedidos de Familias</h3>
                    <span className="text-xs text-slate-500">Sincronizados en tiempo real con el portal de familias</span>
                  </div>
                  <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200">
                    {pedidosCompletos.filter(p => p.estadoPago === 'aprobado').length} Aprobados para Revelado
                  </span>
                </div>

                <div className="overflow-x-auto rounded-2xl border border-slate-200">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
                      <tr>
                        <th className="py-3 px-4">N° Pedido</th>
                        <th className="py-3 px-4">Colegio & Alumno</th>
                        <th className="py-3 px-4">Código Minilab</th>
                        <th className="py-3 px-4">Kit Seleccionado</th>
                        <th className="py-3 px-4">Total</th>
                        <th className="py-3 px-4">Pago</th>
                        <th className="py-3 px-4">Acción</th>
                        <th className="py-3 px-4"></th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {pedidosCompletos.length === 0 ? (
                        <tr>
                          <td colSpan={8} className="py-8 text-center text-slate-400 text-xs">
                            Aún no se han registrado pedidos de familias en el sistema.
                          </td>
                        </tr>
                      ) : (
                        pedidosCompletos.map(p => (
                        <tr key={p.id} className="hover:bg-slate-50 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-slate-900">
                            {p.id}
                            <span className="block text-[10px] font-normal text-slate-400">{p.fecha}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-bold text-slate-900">{p.alumnoNombre}</span>
                            <span className="block text-[11px] text-slate-500">{p.colegioNombre} · {p.grado} "{p.division}"</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className="font-mono text-[11px] font-bold text-amber-900 bg-amber-100 px-2 py-0.5 rounded border border-amber-300">
                              {p.codigoAlumno}
                            </span>
                          </td>
                          <td className="py-3 px-4 font-medium text-slate-800">
                            {p.kitNombre}
                            <span className="block text-[10px] text-slate-400">
                              {p.archivosParaLaboratorio.length} archivos para el laboratorio
                            </span>
                          </td>
                          <td className="py-3 px-4 font-bold text-slate-900">
                            ${p.total.toLocaleString('es-AR')}
                            <span className="block text-[10px] text-slate-400 uppercase">{p.metodoPago}</span>
                          </td>
                          <td className="py-3 px-4">
                            <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-bold ${
                              p.estadoPago === 'aprobado'
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-amber-100 text-amber-800'
                            }`}>
                              {p.estadoPago === 'aprobado' ? '✓ Aprobado' : '⏳ Pendiente'}
                            </span>
                          </td>
                          <td className="py-3 px-4">
                            {p.estadoPago === 'pendiente' ? (
                              <button
                                onClick={async () => {
                                  const fechaHora = `${new Date().toLocaleDateString('es-AR')} ${new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
                                  const actualizados = pedidosCompletos.map(item => 
                                    item.id === p.id 
                                      ? { 
                                          ...item, 
                                          estadoPago: 'aprobado' as const, 
                                          estadoEntrega: 'laboratorio_listo' as const,
                                          emailEnviado: true,
                                          fechaEnvioEmail: fechaHora
                                        } 
                                      : item
                                  );
                                  setPedidosCompletos(actualizados);
                                  guardarPedidosEnStorage(actualizados);

                                  // Sincronizar con el servidor y Supabase mediante token admin
                                  actualizarEstadoPedidoAdmin(p.supabaseId || p.id, {
                                    estadoPago: 'aprobado',
                                    estadoEntrega: 'laboratorio_listo',
                                  }).catch((e) => console.warn('Error al sincronizar estado con backend:', e));

                                  if (p.tutorEmail && p.tutorEmail.includes('@')) {
                                    try {
                                      await enviarFotosPorEmail({
                                        to: p.tutorEmail,
                                        tutorNombre: p.tutorNombre,
                                        alumnoNombre: p.alumnoNombre,
                                        colegioNombre: p.colegioNombre,
                                        cursoCodigo: p.cursoCodigo,
                                        pedidoId: p.id,
                                        kitNombre: p.kitNombre,
                                        total: p.total,
                                        linkDescargaHD: p.linkDescargaHD,
                                        esImpreso: p.kitId === 'kit-clasico',
                                      });
                                    } catch (e) {
                                      console.error('Error enviando email al aprobar pago:', e);
                                    }
                                  }
                                }}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[10px] shadow-xs transition-colors cursor-pointer"
                              >
                                Aprobar Pago
                              </button>
                            ) : (
                              <button
                                onClick={() => setActiveTab('laboratorio')}
                                className="text-[11px] font-semibold text-amber-700 hover:text-amber-800 underline cursor-pointer"
                              >
                                Ver en Laboratorio
                              </button>
                            )}
                          </td>
                          <td className="py-3 px-4">
                            <button
                              type="button"
                              onClick={() => handleEliminarPedido(p)}
                              disabled={eliminandoPedidoId === p.id}
                              title="Eliminar pedido"
                              className="px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 border border-rose-200 text-rose-700 font-bold text-[10px] transition-colors cursor-pointer disabled:opacity-50"
                            >
                              {eliminandoPedidoId === p.id ? 'Eliminando...' : 'Eliminar'}
                            </button>
                          </td>
                        </tr>
                      )))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            {/* TAB: GENERAR CÓDIGOS POR CURSO */}
            {activeTab === 'codigos' && (
              <div className="space-y-6 text-left">
                {/* Feedback toast */}
                {copiadoFeedback && (
                  <div className="p-3.5 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-2xl text-xs font-bold flex items-center justify-between gap-2 shadow-xs animate-in fade-in">
                    <div className="flex items-center gap-2">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{copiadoFeedback}</span>
                    </div>
                    <button 
                      onClick={() => setCopiadoFeedback(null)} 
                      className="text-[11px] text-emerald-700 hover:text-emerald-900"
                    >
                      Entendido
                    </button>
                  </div>
                )}

                {/* Error banner */}
                {errorCodigos && (
                  <div className="p-3.5 bg-red-50 border border-red-300 text-red-900 rounded-2xl text-xs font-bold flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <AlertCircle className="w-4 h-4 text-red-600 shrink-0" />
                      <span>{errorCodigos}</span>
                    </div>
                    <button onClick={() => setErrorCodigos(null)} className="text-[11px] text-red-700 hover:text-red-900">
                      Cerrar
                    </button>
                  </div>
                )}

                {/* Header & Quick Action Buttons */}
                <div className="bg-gradient-to-br from-amber-50 via-amber-100/40 to-emerald-50/50 border border-amber-200 rounded-3xl p-5 sm:p-6 shadow-xs space-y-4">
                  <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                    <div className="space-y-1.5">
                      <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-100 text-emerald-800 text-[10px] font-extrabold uppercase tracking-wider border border-emerald-200">
                        <Send className="w-3 h-3 text-emerald-600" />
                        <span>Kit de Difusión para Colegios & WhatsApp</span>
                      </div>
                      <h3 className="text-lg font-extrabold text-slate-900 flex items-center gap-2 font-['Outfit']">
                        <Key className="w-5 h-5 text-amber-600" />
                        <span>Códigos de Acceso & Difusión para Familias</span>
                      </h3>
                      <p className="text-xs text-slate-600 max-w-2xl leading-relaxed">
                        Estos son los códigos REALES que la familia tiene que escribir en el portal para entrar (los mismos que valida el sitio, guardados en el servidor — no una copia local). Generá los mensajes y notas oficiales para que la Dirección o maestras compartan en los <strong>grupos de WhatsApp</strong> o peguen en los <strong>cuadernos de comunicaciones</strong>.
                      </p>
                    </div>

                    {/* Primary Sharing and Export Suite */}
                    <div className="flex flex-wrap items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={handleDescargarExcelLegible}
                        className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-98"
                        title="Descarga el libro oficial de Microsoft Excel (.XLSX) con 3 pestañas: Códigos, Alumnos e Instrucciones"
                      >
                        <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
                        <span>Descargar Planilla Excel (.XLSX)</span>
                      </button>

                      <button
                        type="button"
                        onClick={handleCopiarPackCompletoWhatsApp}
                        className="px-3.5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-98"
                        title="Copia los mensajes de todas las salas juntos para enviar a la Dirección de la escuela"
                      >
                        <Copy className="w-3.5 h-3.5 text-amber-400" />
                        <span>Copiar Pack WhatsApp Colegio</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          setSeccionParaCircular(undefined);
                          setMostrarCircularModal(true);
                        }}
                        className="px-3.5 py-2.5 bg-white hover:bg-slate-50 border border-slate-300 text-slate-800 font-bold text-xs rounded-xl shadow-xs flex items-center gap-1.5 transition-all cursor-pointer active:scale-98"
                        title="Genera notas para recortar y pegar en el cuaderno de comunicaciones de los alumnos"
                      >
                        <Scissors className="w-3.5 h-3.5 text-amber-600" />
                        <span>Notas Imprimibles (Cuaderno)</span>
                      </button>
                    </div>
                  </div>

                  {/* Colegio selector */}
                  <div className="flex flex-col sm:flex-row sm:items-center gap-2 pt-3 border-t border-amber-200/60">
                    <label className="text-[11px] font-bold text-slate-500 uppercase tracking-wider shrink-0">Colegio:</label>
                    <select
                      value={colegioIdCodigos}
                      onChange={(e) => setColegioIdCodigos(e.target.value)}
                      className="px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-bold text-slate-900 max-w-xs"
                    >
                      {colegiosList.map((c) => (
                        <option key={c.id} value={c.id}>{c.nombre}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={handleAsegurarTodosLosCodigos}
                      disabled={cargandoCodigosReales || seccionesCodigosReales.length === 0}
                      className="px-3 py-2 bg-amber-500 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed text-slate-950 font-bold text-[11px] rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
                      title="Genera un código real para cada sección de este colegio que todavía no tenga uno"
                    >
                      <Key className="w-3.5 h-3.5" />
                      <span>Asegurar códigos para todas las secciones</span>
                    </button>
                  </div>

                  {/* Secondary Tools row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-amber-200/60 text-xs">
                    <span className="text-[11px] text-slate-500">
                      Los códigos se generan y guardan en el servidor (tabla <code className="font-mono">codigos_seccion</code>) — no hay formato "nemotécnico" adivinable por seguridad.
                    </span>

                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={handleDescargarGuiaTxt}
                        className="text-[11px] text-slate-600 hover:text-slate-900 font-semibold underline cursor-pointer"
                      >
                        Descargar Guía en .TXT
                      </button>
                      <span className="text-slate-300">·</span>
                      <button
                        type="button"
                        onClick={handleExportarCSVEspañol}
                        className="text-[11px] text-slate-600 hover:text-slate-900 font-semibold underline cursor-pointer"
                        title="CSV con UTF-8 y delimitador punto y coma para Excel en español"
                      >
                        CSV para Excel (con ;)
                      </button>
                    </div>
                  </div>
                </div>

                {/* Filter Tabs by Grado/Sala (dinámico según el colegio elegido) */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex flex-wrap gap-1.5 p-1 bg-slate-100 rounded-xl">
                    {['todas', ...gradosDisponiblesCodigos].map((tab) => (
                      <button
                        key={tab}
                        type="button"
                        onClick={() => setFiltroSalaCodigos(tab)}
                        className={`px-3 py-1.5 text-xs font-bold rounded-lg transition-all cursor-pointer ${
                          filtroSalaCodigos === tab
                            ? 'bg-white text-slate-950 shadow-xs'
                            : 'text-slate-600 hover:text-slate-900'
                        }`}
                      >
                        {tab === 'todas' ? `Todos los Cursos (${seccionesCodigosReales.length})` : tab}
                      </button>
                    ))}
                  </div>

                  <span className="text-xs text-slate-500 font-medium">
                    {cargandoCodigosReales
                      ? 'Cargando códigos…'
                      : `${seccionesCodigosReales.length} sección(es) · ${alumnosColegioCodigos.length} alumnos en nómina`}
                  </span>
                </div>

                {seccionesCodigosReales.length === 0 && !cargandoCodigosReales && (
                  <div className="p-6 text-center text-sm text-slate-500 bg-slate-50 rounded-2xl border border-dashed border-slate-300">
                    Este colegio todavía no tiene alumnos cargados en la nómina real (pestaña "Nómina Alumnos" o "Carga de Fotos").
                  </div>
                )}

                {/* Course Codes List Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {seccionesCodigosReales
                    .filter((sec) => filtroSalaCodigos === 'todas' || sec.sala === filtroSalaCodigos)
                    .map((sec) => {
                      const currentCode = codigosRealesMap[sec.id] || '';
                      const mensajeCurso = currentCode ? generarMensajeWhatsApp(sec, currentCode, colegioCodigosNombre) : '';
                      const guardando = guardandoCodigoId === sec.id;

                      return (
                        <div
                          key={sec.id}
                          className="bg-white p-4 sm:p-5 rounded-2xl border border-slate-200 shadow-xs space-y-3.5 hover:border-amber-300 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <div>
                              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-1.5">
                                <School className="w-4 h-4 text-amber-600 shrink-0" />
                                <span>{sec.nombreCompleto}</span>
                              </h4>
                              <p className="text-[11px] text-slate-500 mt-0.5">
                                {sec.sala} · Turno {sec.turno} · Div. {sec.division}
                              </p>
                            </div>
                            <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 text-[11px] font-bold shrink-0">
                              {sec.totalAlumnos} alumnos
                            </span>
                          </div>

                          {/* Code edit input */}
                          <div className="space-y-1.5 bg-slate-50 p-3 rounded-xl border border-slate-200">
                            <label className="text-[10px] uppercase font-extrabold text-slate-500 tracking-wider flex items-center justify-between">
                              <span>Código real de acceso:</span>
                              <span className="text-[10px] text-slate-400 font-normal">
                                {guardando ? 'Guardando…' : 'Editable al tipear'}
                              </span>
                            </label>
                            {!currentCode ? (
                              <button
                                type="button"
                                disabled={guardando}
                                onClick={() => handleAsegurarCodigo(sec)}
                                className="w-full px-3 py-2 bg-amber-400 hover:bg-amber-300 disabled:opacity-60 text-slate-950 text-xs font-bold rounded-lg flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                              >
                                {guardando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Key className="w-3.5 h-3.5" />}
                                <span>Generar código real para esta sección</span>
                              </button>
                            ) : (
                              <div className="flex gap-2">
                                <input
                                  type="text"
                                  defaultValue={currentCode}
                                  key={currentCode}
                                  disabled={guardando}
                                  onBlur={(e) => {
                                    const val = e.target.value.trim().toUpperCase();
                                    if (val && val !== currentCode) {
                                      handleGuardarCodigoManual(sec, val);
                                    }
                                  }}
                                  onKeyDown={(e) => {
                                    if (e.key === 'Enter') {
                                      e.preventDefault();
                                      const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                                      if (val && val !== currentCode) handleGuardarCodigoManual(sec, val);
                                    }
                                  }}
                                  className="px-3 py-1.5 text-xs font-mono font-black uppercase bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400 w-full tracking-wider text-slate-900 disabled:opacity-60"
                                />
                                <button
                                  type="button"
                                  onClick={() => handleCopiarTexto(currentCode, `Código ${currentCode} copiado al portapapeles`)}
                                  className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-slate-950 text-xs font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                                  title="Copiar código al portapapeles"
                                >
                                  <Copy className="w-3.5 h-3.5" />
                                  <span>Copiar</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={guardando}
                                  onClick={() => handleRegenerarCodigo(sec)}
                                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-60 text-slate-700 text-xs font-bold rounded-lg flex items-center gap-1 transition-colors cursor-pointer shrink-0"
                                  title="Generar un código nuevo, invalidando el anterior"
                                >
                                  <RefreshCw className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>

                          {/* Quick Message Preview & Actions */}
                          <div className="pt-2 border-t border-slate-100 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <a
                                  href={currentCode ? `https://wa.me/?text=${encodeURIComponent(mensajeCurso)}` : undefined}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  aria-disabled={!currentCode}
                                  onClick={(e) => { if (!currentCode) e.preventDefault(); }}
                                  className={`px-2.5 py-1.5 font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-colors ${
                                    currentCode
                                      ? 'bg-emerald-600 hover:bg-emerald-500 text-white cursor-pointer'
                                      : 'bg-slate-200 text-slate-400 cursor-not-allowed'
                                  }`}
                                  title={currentCode ? 'Abrir WhatsApp con el mensaje ya redactado' : 'Primero generá un código para esta sección'}
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>WhatsApp</span>
                                </a>

                                <button
                                  type="button"
                                  disabled={!currentCode}
                                  onClick={() => handleCopiarTexto(mensajeCurso, `¡Mensaje de WhatsApp para ${sec.nombreCompleto} copiado!`)}
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 disabled:opacity-50 disabled:cursor-not-allowed text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1 transition-colors cursor-pointer"
                                  title="Copiar texto completo para WhatsApp"
                                >
                                  <Copy className="w-3.5 h-3.5 text-slate-500" />
                                  <span>Copiar Texto</span>
                                </button>
                              </div>

                              <div className="flex items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSeccionParaCircular(sec.id);
                                    setMostrarCircularModal(true);
                                  }}
                                  className="text-xs font-bold text-slate-600 hover:text-slate-900 flex items-center gap-1 p-1 rounded-lg hover:bg-slate-100 transition-colors cursor-pointer"
                                  title="Ver e imprimir nota para cuaderno de este curso"
                                >
                                  <Scissors className="w-3.5 h-3.5 text-amber-600" />
                                  <span>Imprimir Nota</span>
                                </button>

                                {onProbarCodigo && currentCode && (
                                  <button
                                    type="button"
                                    onClick={() => onProbarCodigo(currentCode)}
                                    className="text-xs font-bold text-amber-700 hover:text-amber-800 flex items-center gap-1 p-1 rounded-lg hover:bg-amber-50 transition-colors cursor-pointer"
                                  >
                                    <span>Probar</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </button>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {/* TAB: NOMINA ALUMNOS 2026 */}
            {activeTab === 'alumnos' && (
              <div className="space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-50 p-4 rounded-2xl border border-slate-200">
                  <div>
                    <h3 className="text-base font-bold text-slate-900 flex items-center gap-2">
                      <Users className="w-5 h-5 text-amber-500" />
                      <span>Nómina Escolar 2026</span>
                    </h3>
                    <p className="text-xs text-slate-500">
                      {cargandoNominaReal
                        ? 'Cargando nómina real desde Supabase...'
                        : `${alumnosNominaReal.length} alumnos registrados en ${seccionesReales.length} secciones (datos reales del padrón)`}
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
                    <button
                      type="button"
                      onClick={cargarNominaReal}
                      disabled={cargandoNominaReal}
                      className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 disabled:opacity-50 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      title="Volver a traer la nómina desde Supabase"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 text-slate-500 ${cargandoNominaReal ? 'animate-spin' : ''}`} />
                      <span>Actualizar</span>
                    </button>

                    <button
                      type="button"
                      onClick={toggleSelectAllSeccion}
                      className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-100 rounded-xl text-xs font-semibold text-slate-700 flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                    >
                      <CheckSquare className="w-3.5 h-3.5 text-slate-500" />
                      <span>Chequear filtrados</span>
                    </button>

                    <button
                      type="button"
                      onClick={handleExportarNominaExcel}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 cursor-pointer shadow-xs transition-colors"
                      title="Exporta la nómina completa directamente a un archivo de Excel (.XLSX)"
                    >
                      <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-200" />
                      <span>Exportar a Excel (.XLSX)</span>
                    </button>
                  </div>
                </div>

                {/* Filters */}
                <div className="space-y-2">
                  <div className="flex flex-col sm:flex-row gap-3">
                    <div className="relative flex-1">
                      <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                      <input
                        type="text"
                        value={busquedaAlumnos}
                        onChange={(e) => setBusquedaAlumnos(e.target.value)}
                        placeholder="Buscar por nombre de alumno o grado..."
                        className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="sm:w-64">
                      <select
                        value={idsSeccionesPrimaria.has(filtroSeccionAlumnos) || filtroSeccionAlumnos === 'todas-primaria' ? filtroSeccionAlumnos : 'todas-primaria'}
                        onChange={(e) => setFiltroSeccionAlumnos(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-700"
                      >
                        <option value="todas-primaria">Primaria/Inicial: todas ({totalAlumnosPrimaria} alumnos)</option>
                        {seccionesPrimaria.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.nombreCompleto} ({sec.totalAlumnos} alumnos)
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="sm:w-64">
                      <select
                        value={idsSeccionesSecundaria.has(filtroSeccionAlumnos) || filtroSeccionAlumnos === 'todas-secundaria' ? filtroSeccionAlumnos : 'todas-secundaria'}
                        onChange={(e) => setFiltroSeccionAlumnos(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-700"
                      >
                        <option value="todas-secundaria">Secundaria: todas ({totalAlumnosSecundaria} alumnos)</option>
                        {seccionesSecundaria.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.nombreCompleto} ({sec.totalAlumnos} alumnos)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {filtroSeccionAlumnos !== 'todas' && (
                    <button
                      onClick={() => setFiltroSeccionAlumnos('todas')}
                      className="text-[11px] font-semibold text-slate-500 hover:text-slate-800 underline underline-offset-2 cursor-pointer"
                    >
                      Ver todas las secciones ({alumnosNominaReal.length} alumnos)
                    </button>
                  )}
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">✓</th>
                        <th className="py-2.5 px-3 w-12 text-slate-400">#</th>
                        <th className="py-2.5 px-4 font-bold text-slate-800">Apellido y Nombre</th>
                        <th className="py-2.5 px-4">Grado</th>
                        <th className="py-2.5 px-4">Turno</th>
                        <th className="py-2.5 px-4">División</th>
                        <th className="py-2.5 px-4 text-center">Estado Foto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {alumnosFiltradosAdmin.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">
                            {cargandoNominaReal
                              ? 'Cargando nómina...'
                              : 'No se encontraron alumnos con los criterios seleccionados.'}
                          </td>
                        </tr>
                      ) : (
                        alumnosFiltradosAdmin.map((alu, index) => {
                          const isChecked = !!checkedAlumnos[alu.id];
                          return (
                            <tr
                              key={alu.id}
                              onClick={() => toggleCheckAlumno(alu.id)}
                              className={`cursor-pointer transition-colors ${
                                isChecked ? 'bg-amber-50/50 hover:bg-amber-50' : 'hover:bg-slate-50'
                              }`}
                            >
                              <td className="py-2.5 px-3 text-center">
                                <input
                                  type="checkbox"
                                  checked={isChecked}
                                  onChange={() => toggleCheckAlumno(alu.id)}
                                  className="w-4 h-4 rounded text-amber-500 focus:ring-amber-400 cursor-pointer"
                                />
                              </td>
                              <td className="py-2.5 px-3 text-slate-400 font-mono text-[11px]">
                                {alu.numero_lista ?? index + 1}
                              </td>
                              <td className="py-2.5 px-4 font-bold text-slate-900">
                                {alu.nombre}
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium text-[11px]">
                                  {alu.grado}
                                </span>
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-medium text-[11px]">
                                  {alu.turno || '—'}
                                </span>
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="px-2 py-0.5 rounded-md bg-sky-100 text-sky-800 font-medium text-[11px]">
                                  {alu.division}
                                </span>
                              </td>
                              <td className="py-2.5 px-4 text-center">
                                {isChecked ? (
                                  <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2 py-0.5 rounded-full">
                                    <CheckCircle2 className="w-3 h-3" /> Fotografiado
                                  </span>
                                ) : (
                                  <span className="inline-block text-[10px] font-semibold text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                                    Pendiente
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })
                      )}
                    </tbody>
                  </table>
                </div>

                <div className="flex items-center justify-between text-xs text-slate-500 px-2">
                  <span>
                    Mostrando {alumnosFiltradosAdmin.length} de {alumnosNominaReal.length} alumnos
                  </span>
                  <span>
                    {Object.values(checkedAlumnos).filter(Boolean).length} alumnos marcados como fotografiados (solo en esta sesión del navegador)
                  </span>
                </div>
              </div>
            )}
            {activeTab === 'estado-pagos' && (
              <AdminEstadoPagosTab />
            )}
            {activeTab === 'importar-alumnos' && (
              <AdminImportarAlumnosTab />
            )}
            {activeTab === 'subir' && (
              <AdminLoteFotosTab />
            )}

            {/* TAB 3: COLEGIOS */}
            {activeTab === 'colegios' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <form onSubmit={handleCrearColegio} className="space-y-4 bg-slate-50 p-6 rounded-2xl border border-slate-200">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                      {colegioEditandoId ? 'Editar Colegio' : 'Dar de Alta Nuevo Colegio'}
                    </h3>
                    {colegioEditandoId && (
                      <button
                        type="button"
                        onClick={limpiarFormularioColegio}
                        className="text-[11px] font-bold text-slate-500 hover:text-slate-800 cursor-pointer"
                      >
                        Cancelar edición
                      </button>
                    )}
                  </div>

                  <p className="text-[11px] text-slate-500 -mt-2">
                    Se guarda en Supabase: queda visible al instante para todas las familias que entren al sitio.
                  </p>

                  {errorColegio && (
                    <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{errorColegio}</span>
                    </div>
                  )}

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Nombre de la Institución *</label>
                    <input
                      type="text"
                      required
                      value={nuevoNombre}
                      onChange={e => setNuevoNombre(e.target.value)}
                      placeholder="Ej: Colegio San Jorge"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Localidad / Barrio</label>
                    <input
                      type="text"
                      value={nuevaLocalidad}
                      onChange={e => setNuevaLocalidad(e.target.value)}
                      placeholder="Ej: Quilmes / Zona Sur"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">Código de Acceso Familias *</label>
                    <input
                      type="text"
                      required
                      value={nuevoCodigo}
                      onChange={e => setNuevoCodigo(e.target.value)}
                      placeholder="Ej: SANJORGE26"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-mono font-bold uppercase"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="text-xs font-bold text-slate-700">WhatsApp de Solicitud de Códigos (Opcional)</label>
                    <input
                      type="text"
                      value={nuevoWhatsapp}
                      onChange={e => setNuevoWhatsapp(e.target.value)}
                      placeholder="Ej: 54911xxxxxxxx (vacío para usar número general)"
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-mono"
                    />
                    <p className="text-[10px] text-slate-500">
                      Si lo dejás en blanco, usará el número configurado en la pestaña WhatsApp.
                    </p>
                  </div>

                  <div className="pt-2 border-t border-slate-200 space-y-3">
                    <p className="text-[11px] font-bold text-slate-600 uppercase tracking-wider">
                      Grados, Divisiones y Turnos de este Colegio
                    </p>
                    <p className="text-[10px] text-slate-500 -mt-2">
                      Tildá los que apliquen. Si no encontrás alguno, agregalo con "+ Agregar". Si no tildás nada, se usa una lista genérica por defecto.
                    </p>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Grados / Salas</label>
                      <SelectorMultiple
                        value={nuevosGrados}
                        onChange={setNuevosGrados}
                        opciones={OPCIONES_GRADOS_COLEGIO}
                        placeholderOtro="Ej: Nivelación, Plurigrado..."
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Divisiones</label>
                      <SelectorMultiple
                        value={nuevasDivisiones}
                        onChange={setNuevasDivisiones}
                        opciones={OPCIONES_DIVISIONES_COLEGIO}
                        placeholderOtro="Ej: E, Única..."
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Turnos</label>
                      <SelectorMultiple
                        value={nuevosTurnos}
                        onChange={setNuevosTurnos}
                        opciones={OPCIONES_TURNOS_COLEGIO}
                        placeholderOtro="Ej: Nocturno..."
                      />
                    </div>
                  </div>

                  <button
                    type="submit"
                    disabled={guardandoColegio}
                    className="w-full py-2.5 rounded-xl bg-amber-500 hover:bg-amber-600 disabled:opacity-60 text-slate-950 font-bold text-xs shadow flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    {guardandoColegio ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : null}
                    <span>
                      {guardandoColegio
                        ? 'Guardando...'
                        : colegioEditandoId
                        ? 'Guardar Cambios'
                        : 'Guardar Colegio'}
                    </span>
                  </button>
                </form>

                <div className="space-y-3">
                  <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider">
                    Colegios Activos ({colegiosList.length})
                  </h3>
                  <div className="divide-y divide-slate-100 max-h-[28rem] overflow-y-auto bg-white rounded-2xl border border-slate-200">
                    {colegiosList.map(c => (
                      <div key={c.id} className="p-3.5 hover:bg-slate-50 transition-colors space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h4 className="text-xs font-bold text-slate-900">{c.nombre}</h4>
                            <div className="flex items-center gap-2 flex-wrap mt-0.5">
                              <span className="text-[11px] text-slate-500">{c.localidad} ({c.zona})</span>
                              {c.whatsappContacto && (
                                <span className="text-[10px] bg-emerald-100 text-emerald-800 font-mono font-bold px-1.5 py-0.5 rounded">
                                  WA: {c.whatsappContacto}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="px-2 py-0.5 rounded bg-slate-100 font-mono text-xs font-bold text-slate-800">
                              {c.codigoAcceso}
                            </span>
                            <button
                              type="button"
                              onClick={() => handleEditarColegioClick(c)}
                              className="p-1 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer"
                              title="Editar colegio"
                            >
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {colegiosList.length > 1 && (
                              <button
                                type="button"
                                disabled={borrandoColegioId === c.id}
                                onClick={() => handleBorrarColegioClick(c)}
                                className="p-1 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer"
                                title="Eliminar colegio"
                              >
                                {borrandoColegioId === c.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <Trash2 className="w-3.5 h-3.5" />
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                        <div className="flex flex-wrap gap-1 text-[10px] text-slate-500">
                          <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded">
                            {(c.grados || []).length} grados
                          </span>
                          <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded">
                            {(c.divisiones || []).length} divisiones
                          </span>
                          <span className="px-1.5 py-0.5 bg-slate-50 border border-slate-200 rounded">
                            {(c.turnos || []).length} turnos
                          </span>
                        </div>

                        <div className="pt-1.5 mt-1.5 border-t border-slate-100 space-y-1">
                          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
                            Link de carga de padrón (para la institución)
                          </p>
                          {padronTokens[c.id] ? (
                            <div className="flex items-center gap-1.5">
                              <input
                                type="text"
                                readOnly
                                value={construirLinkPadron(c.id)}
                                onFocus={(e) => e.target.select()}
                                className="flex-1 min-w-0 px-2 py-1 rounded-lg border border-slate-200 bg-slate-50 text-[10px] font-mono text-slate-600"
                              />
                              <button
                                type="button"
                                onClick={() => handleCopiarLinkPadron(c.id)}
                                title="Copiar link"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-amber-600 hover:bg-amber-50 transition-colors cursor-pointer shrink-0"
                              >
                                {copiadoPadronId === c.id ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                disabled={regenerandoPadronId === c.id}
                                onClick={() => handleRegenerarPadron(c)}
                                title="Regenerar link (invalida el anterior)"
                                className="p-1.5 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-50 transition-colors cursor-pointer shrink-0"
                              >
                                {regenerandoPadronId === c.id ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                                ) : (
                                  <RefreshCw className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <p className="text-[10px] text-slate-400">Cargando link...</p>
                          )}
                          <p className="text-[9px] text-slate-400">
                            Compartilo solo con la institución — ellos cargan ahí los datos de contacto de las familias.
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* TAB: CERRAR AÑO (borrado real de temporada, ver services/cierreAnioService.ts) */}
            {activeTab === 'cerrar-anio' && (
              <div className="max-w-2xl space-y-5">
                <div className="p-4 rounded-2xl bg-rose-50 border border-rose-200 flex items-start gap-3">
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div className="space-y-1">
                    <h3 className="text-sm font-bold text-rose-900">Cerrar año / arrancar temporada nueva</h3>
                    <p className="text-[11px] text-rose-800 leading-relaxed">
                      Esto borra, para el colegio que elijas (o para todos), los datos DE LA TEMPORADA:
                      alumnos, familias, pedidos, fotos y sus archivos en storage, inscripciones, padres
                      autorizados y códigos de sección. El colegio en sí <strong>no</strong> se borra —
                      queda listo para cargarle la nómina y las fotos del año que viene. Es una acción
                      irreversible sobre datos reales: no hay forma de deshacerla.
                    </p>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs font-bold text-slate-700">Colegio a cerrar</label>
                  <select
                    value={cierreAnioColegioId}
                    onChange={(e) => {
                      setCierreAnioColegioId(e.target.value);
                      setCierreAnioResumen(null);
                      setResultadoCierreAnio(null);
                      setErrorCierreAnio(null);
                      setTextoConfirmacionCierre('');
                    }}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                  >
                    {colegiosList.map((c) => (
                      <option key={c.id} value={c.id}>{c.nombre}</option>
                    ))}
                    <option value="todos">— Todos los colegios —</option>
                  </select>
                </div>

                <button
                  type="button"
                  onClick={handleVerResumenCierreAnio}
                  disabled={!cierreAnioColegioId || cargandoResumenCierre}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-900 disabled:opacity-50 text-white font-bold text-xs shadow flex items-center gap-1.5 cursor-pointer"
                >
                  {cargandoResumenCierre ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Eye className="w-3.5 h-3.5" />}
                  <span>{cargandoResumenCierre ? 'Calculando...' : 'Ver qué se borraría'}</span>
                </button>

                {errorCierreAnio && (
                  <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{errorCierreAnio}</span>
                  </div>
                )}

                {resultadoCierreAnio && (
                  <div className="p-3.5 rounded-2xl bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs space-y-1">
                    <p className="font-bold">Año cerrado correctamente.</p>
                    <p>
                      Se borraron {resultadoCierreAnio.alumnos} alumnos, {resultadoCierreAnio.familias} familias,{' '}
                      {resultadoCierreAnio.pedidos} pedidos y {resultadoCierreAnio.fotos} fotos (con sus archivos).
                    </p>
                  </div>
                )}

                {cierreAnioResumen && (
                  <div className="p-4 rounded-2xl bg-white border-2 border-rose-200 space-y-4">
                    <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                      Se va a borrar de "{cierreAnioNombreConfirmado}"
                    </h4>
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-center">
                      {[
                        ['Alumnos', cierreAnioResumen.alumnos],
                        ['Familias', cierreAnioResumen.familias],
                        ['Pedidos', cierreAnioResumen.pedidos],
                        ['Fotos', cierreAnioResumen.fotos],
                        ['Fotos en pedidos', cierreAnioResumen.pedidoFotos],
                        ['Inscripciones', cierreAnioResumen.inscripciones],
                        ['Padres autorizados', cierreAnioResumen.padresAutorizados],
                        ['Códigos de sección', cierreAnioResumen.codigosSeccion],
                        ['Solicitudes de código', cierreAnioResumen.solicitudesCodigo],
                      ].map(([label, valor]) => (
                        <div key={label as string} className="p-2 rounded-xl bg-slate-50 border border-slate-200">
                          <div className="text-lg font-black text-slate-900">{valor as number}</div>
                          <div className="text-[9px] text-slate-500 font-bold uppercase">{label}</div>
                        </div>
                      ))}
                    </div>

                    <div className="pt-2 border-t border-slate-200 space-y-1.5">
                      <label className="text-xs font-bold text-slate-700">
                        Para confirmar, escribí exactamente: <span className="font-mono text-rose-700">{fraseConfirmacionCierreAnio}</span>
                      </label>
                      <input
                        type="text"
                        value={textoConfirmacionCierre}
                        onChange={(e) => setTextoConfirmacionCierre(e.target.value)}
                        placeholder={fraseConfirmacionCierreAnio}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white font-mono"
                      />
                    </div>

                    <button
                      type="button"
                      disabled={
                        ejecutandoCierreAnio ||
                        textoConfirmacionCierre.trim().toLowerCase() !== fraseConfirmacionCierreAnio.trim().toLowerCase()
                      }
                      onClick={handleEjecutarCierreAnio}
                      className="w-full py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 disabled:opacity-40 text-white font-bold text-xs shadow flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {ejecutandoCierreAnio ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                      <span>{ejecutandoCierreAnio ? 'Cerrando año...' : 'Cerrar año (borrado definitivo)'}</span>
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* TAB: WHATSAPP CONFIG & SUPABASE */}
            {activeTab === 'whatsapp' && (
              <>
                {/* SECCIÓN WHATSAPP: CAMPO DE ENTRADA Y BOTÓN GUARDAR EN TABLA 'configuracion' DE SUPABASE.
                    Antes estaba siempre visible arriba del todo; se usa poco, así que ahora vive
                    dentro de esta pestaña. */}
                <div className="bg-white rounded-2xl p-4 sm:p-5 border-2 border-emerald-500/40 shadow-xs space-y-3.5 relative overflow-hidden mb-4">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                        <Phone className="w-5 h-5" />
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-black text-slate-900 font-['Outfit']">
                            Número de WhatsApp (Widget Flotante & Atención)
                          </h4>
                          <span className="text-[10px] font-mono font-bold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded-full border border-emerald-300 flex items-center gap-1">
                            <Database className="w-2.5 h-2.5" />
                            <span>Supabase: configuracion</span>
                          </span>
                        </div>
                        <p className="text-xs text-slate-500">
                          Ingresá el número de teléfono con código de país para guardarlo de manera persistente en Supabase y sincronizarlo al instante con el widget flotante.
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 text-xs text-slate-500 bg-slate-50 px-3 py-1.5 rounded-xl border border-slate-200 shrink-0">
                      <span>Actual:</span>
                      <strong className="font-mono text-emerald-700 font-bold">
                        {formatearNumeroVisual(whatsappNumero)}
                      </strong>
                    </div>
                  </div>

                  <form onSubmit={handleGuardarWhatsApp} className="flex flex-col sm:flex-row gap-2.5 items-stretch sm:items-center">
                    <div className="relative flex-1">
                      <div className="absolute left-3.5 top-3 flex items-center pointer-events-none text-slate-400">
                        <Globe className="w-4 h-4 text-emerald-600" />
                      </div>
                      <input
                        id="admin-modal-input-whatsapp"
                        type="text"
                        required
                        value={whatsappNumero}
                        onChange={(e) => setWhatsappNumero(e.target.value)}
                        placeholder="Ej: +54 9 11 2862-5916 o 5491128625916"
                        className="w-full pl-10 pr-4 py-2.5 rounded-xl border-2 border-emerald-500/40 text-sm font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-600 bg-emerald-50/20 transition-all"
                      />
                    </div>

                    <button
                      id="admin-modal-btn-guardar-whatsapp"
                      type="submit"
                      disabled={whatsappGuardando || !whatsappNumero.trim()}
                      className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 active:scale-95 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
                    >
                      <Save className="w-4 h-4" />
                      <span>{whatsappGuardando ? 'Guardando...' : 'Guardar en Supabase'}</span>
                    </button>
                  </form>

                  {whatsappFeedback && (
                    <div className="p-3 rounded-xl bg-emerald-50 border border-emerald-300 text-emerald-900 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      <span>{whatsappFeedback}</span>
                    </div>
                  )}

                  {whatsappError && (
                    <div className="p-3 rounded-xl bg-rose-50 border border-rose-300 text-rose-900 text-xs font-semibold flex items-center gap-2 animate-in fade-in">
                      <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
                      <span>{whatsappError}</span>
                    </div>
                  )}
                </div>

                <AdminConfigWhatsAppTab />
              </>
            )}

          </div>
        )}

        {/* WhatsApp Message Preview Modal */}
        {mensajeWhatsAppModal && (
          <div
            onClick={() => setMensajeWhatsAppModal(null)}
            className="fixed inset-0 z-70 bg-slate-950/80 backdrop-blur-xs flex items-center justify-center p-4"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="bg-white max-w-lg w-full rounded-3xl overflow-hidden shadow-2xl border border-slate-200 text-left animate-in fade-in zoom-in-95 duration-150"
            >
              <div className="p-4 sm:p-5 bg-emerald-800 text-white flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <div className="w-8 h-8 rounded-xl bg-emerald-700 flex items-center justify-center text-white">
                    <MessageSquare className="w-4 h-4" />
                  </div>
                  <div>
                    <h3 className="text-sm font-bold text-white">Comunicado para Grupo de Familias</h3>
                    <p className="text-[11px] text-emerald-200">{mensajeWhatsAppModal.seccion.nombreCompleto}</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setMensajeWhatsAppModal(null)}
                  className="p-1 rounded-lg hover:bg-emerald-700/60 text-emerald-200 hover:text-white"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-5 space-y-4">
                <div className="space-y-1">
                  <label className="text-[10px] uppercase font-bold text-slate-500 tracking-wider">
                    Mensaje preformateado listo para copiar:
                  </label>
                  <textarea
                    readOnly
                    value={mensajeWhatsAppModal.texto}
                    rows={10}
                    className="w-full text-xs font-mono p-3 bg-slate-50 border border-slate-300 rounded-xl leading-relaxed focus:outline-hidden text-slate-800 resize-none"
                  />
                </div>

                <div className="flex flex-col sm:flex-row gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard.writeText(mensajeWhatsAppModal.texto);
                      setCopiadoFeedback('¡Mensaje para WhatsApp copiado al portapapeles!');
                      setTimeout(() => setCopiadoFeedback(null), 2500);
                      setMensajeWhatsAppModal(null);
                    }}
                    className="flex-1 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 shadow-xs transition-colors cursor-pointer"
                  >
                    <Copy className="w-4 h-4" />
                    <span>Copiar Mensaje Completo</span>
                  </button>

                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(mensajeWhatsAppModal.texto)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar a WhatsApp</span>
                  </a>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Printable & Cutout Notes Modal */}
        <CircularImprimibleModal
          isOpen={mostrarCircularModal}
          onClose={() => setMostrarCircularModal(false)}
          secciones={seccionesCodigosReales}
          codigosMap={codigosRealesMap}
          colegioNombre={colegioCodigosNombre}
          seccionSeleccionadaInicial={seccionParaCircular}
        />

      </div>
    </div>
  );
}
