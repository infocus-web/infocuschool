import React, { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  X, Lock, Camera, Upload, CheckCircle2, DollarSign, Package,
  School, RefreshCw, Eye, AlertCircle, ArrowRight, Users, Search, CheckSquare, Square, Download,
  Key, Copy, Check, MessageSquare, Sparkles, Send, ExternalLink, Printer, HardDrive, FileCode, Mail,
  FileSpreadsheet, Scissors, FileText, UserCheck, Trash2, Phone, Save, Database, Globe,
  Pencil, Loader2, Link2
} from 'lucide-react';
import { getSupabase } from '../services/supabaseClient';
import {
  obtenerConfiguracionWhatsApp,
  guardarNumeroWhatsAppFlotante,
  sanitizarNumeroWhatsApp,
  formatearNumeroVisual,
  ConfiguracionWhatsApp
} from '../services/configuracionService';
import { FOTOS_MUESTRA, KITS_DISPONIBLES } from '../data/colegiosData';
import { useColegiosLista, obtenerTokensPadronAdmin, regenerarTokenPadronAdmin } from '../services/colegiosService';
import { ALUMNOS_NOMINA_2026, SECCIONES_INICIAL_2026 } from '../data/alumnosData';
import { 
  getCodigosCursos, guardarCodigoCurso, regenerarTodosLosCodigos, getMensajeWhatsAppParaCurso 
} from '../data/codigosCursos';
import { 
  obtenerPedidosGuardados, 
  guardarPedidosEnStorage, 
  PedidoEscolarCompleto 
} from '../services/pedidosLabService';
import {
  obtenerInscripcionesAdmin
} from '../services/inscripcionesService';
import { 
  descargarExcelLegibleColegio,
  descargarCSVEspañolCompatible,
  descargarGuiaWhatsAppTxt,
  generarGuiaWhatsAppColegioTexto,
  generarMensajeWhatsApp
} from '../services/difusionEscolarService';
import { descargarLibroExcel } from '../services/excelDownloadHelper';
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
  const [activeTab, setActiveTab] = useState<'inscriptos' | 'padron' | 'laboratorio' | 'pedidos' | 'subir' | 'codigos' | 'alumnos' | 'colegios' | 'whatsapp' | 'solicitudes'>('inscriptos');

  // Real synced orders for photo lab and families
  const [pedidosCompletos, setPedidosCompletos] = useState<PedidoEscolarCompleto[]>(() => obtenerPedidosGuardados());
  // Id del pedido que se está eliminando (para deshabilitar el botón mientras se procesa)
  const [eliminandoPedidoId, setEliminandoPedidoId] = useState<string | null>(null);

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
      // 1. Guardar de forma persistente en Supabase en la tabla 'configuracion'
      const supabase = getSupabase();
      let persistidoEnSupabase = false;

      if (supabase) {
        const payload = {
          clave: 'whatsapp_flotante',
          valor: limpio,
          datos_extra: {
            actualizado_desde: 'AdminModal',
            tipo: 'widget_flotante',
          },
          updated_at: new Date().toISOString(),
        };

        // Guardar en la tabla 'configuracion' (única tabla real de configuración en Supabase)
        const { error: errConfiguracion } = await supabase
          .from('configuracion')
          .upsert(payload, { onConflict: 'clave' });

        if (!errConfiguracion) {
          persistidoEnSupabase = true;
        }
      }

      // 2. Persistir localmente en Storage y emitir evento reactivo para WhatsAppFloating
      await guardarNumeroWhatsAppFlotante(limpio);
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

  // Course codes state
  const [codigosMap, setCodigosMap] = useState<Record<string, string>>(() => getCodigosCursos());
  const [copiadoFeedback, setCopiadoFeedback] = useState<string | null>(null);
  const [filtroSalaCodigos, setFiltroSalaCodigos] = useState<string>('todas');
  const [mensajeWhatsAppModal, setMensajeWhatsAppModal] = useState<{ seccion: any; codigo: string; texto: string } | null>(null);

  const handleCopiarTexto = (texto: string, label: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoFeedback(label);
    setTimeout(() => setCopiadoFeedback(null), 2500);
  };

  const handleGuardarCodigo = (seccionId: string, nuevoCodigo: string) => {
    const updated = guardarCodigoCurso(seccionId, nuevoCodigo);
    setCodigosMap(updated);
    setCopiadoFeedback(`Código guardado: ${nuevoCodigo.toUpperCase()}`);
    setTimeout(() => setCopiadoFeedback(null), 2000);
  };

  const handleRegenerarCodigos = (tipo: 'nemotecnico' | 'pin') => {
    const updated = regenerarTodosLosCodigos(tipo);
    setCodigosMap(updated);
    setCopiadoFeedback('¡Códigos regenerados exitosamente para todos los cursos!');
    setTimeout(() => setCopiadoFeedback(null), 2500);
  };

  const [mostrarCircularModal, setMostrarCircularModal] = useState(false);
  const [seccionParaCircular, setSeccionParaCircular] = useState<string | undefined>(undefined);

  const colegioActualNombre = colegiosList[0]?.nombre || 'Instituto Madre del Divino Pastor';

  const handleDescargarExcelLegible = () => {
    try {
      descargarExcelLegibleColegio(SECCIONES_INICIAL_2026, codigosMap, colegioActualNombre);
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
        'N°': idx + 1,
        'Apellido': a.apellido,
        'Nombre': a.nombre,
        'Curso / Sala': a.grado,
        'Turno': a.turno,
        'División': a.division,
        'Código de Acceso': codigosMap[a.seccionId] || a.seccionId,
        'Fotos Incluidas en Paquete': '3 tomas (Retrato, Grupo, Docente)'
      }));
      const ws = XLSX.utils.json_to_sheet(data);
      ws['!cols'] = [
        { wch: 6 },
        { wch: 22 },
        { wch: 22 },
        { wch: 26 },
        { wch: 12 },
        { wch: 10 },
        { wch: 20 },
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
    descargarCSVEspañolCompatible(SECCIONES_INICIAL_2026, codigosMap, colegioActualNombre);
    setCopiadoFeedback('¡CSV descargado con codificación UTF-8 compatible con Excel en español!');
    setTimeout(() => setCopiadoFeedback(null), 3000);
  };

  const handleCopiarPackCompletoWhatsApp = () => {
    const guiaTexto = generarGuiaWhatsAppColegioTexto(SECCIONES_INICIAL_2026, codigosMap, colegioActualNombre);
    navigator.clipboard.writeText(guiaTexto);
    setCopiadoFeedback('¡Pack completo de WhatsApp copiado al portapapeles para enviar a la Dirección!');
    setTimeout(() => setCopiadoFeedback(null), 3500);
  };

  const handleDescargarGuiaTxt = () => {
    descargarGuiaWhatsAppTxt(SECCIONES_INICIAL_2026, codigosMap, colegioActualNombre);
    setCopiadoFeedback('¡Guía de mensajes en archivo de texto (.TXT) descargada!');
    setTimeout(() => setCopiadoFeedback(null), 3000);
  };

  // Alumnos roster states
  const [filtroSeccionAlumnos, setFiltroSeccionAlumnos] = useState<string>('todas');
  const [busquedaAlumnos, setBusquedaAlumnos] = useState<string>('');
  const [checkedAlumnos, setCheckedAlumnos] = useState<Record<string, boolean>>({});

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
    return ALUMNOS_NOMINA_2026.filter((alu) => {
      const matchSeccion = filtroSeccionAlumnos === 'todas' || alu.seccionId === filtroSeccionAlumnos;
      const q = busquedaAlumnos.toLowerCase().trim();
      const matchSearch = !q || 
        `${alu.apellido} ${alu.nombre}`.toLowerCase().includes(q) ||
        `${alu.nombre} ${alu.apellido}`.toLowerCase().includes(q) ||
        alu.grado.toLowerCase().includes(q);
      return matchSeccion && matchSearch;
    });
  }, [filtroSeccionAlumnos, busquedaAlumnos]);

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
    return `${window.location.origin}/padron.html?colegio=${encodeURIComponent(colegioId)}&codigo=${encodeURIComponent(token)}`;
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
        
        {/* Modal Header */}
        <div className="p-5 sm:p-6 border-b border-slate-200 bg-slate-900 text-white flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-500 text-slate-950 flex items-center justify-center font-bold">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold font-['Outfit']">Panel de Control para Fotógrafos</h2>
                <span className="text-[10px] uppercase font-bold tracking-wider px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                  Interno
                </span>
              </div>
              <p className="text-xs text-slate-400">
                Gestión de pedidos familiares, subida con marca de agua y colegios
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {isAuthenticated && (
              <button
                onClick={handleCerrarSesion}
                className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 transition-colors cursor-pointer"
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
                { id: 'alumnos', label: `Nómina 2026 (${ALUMNOS_NOMINA_2026.length})`, icon: Users },
                { id: 'colegios', label: 'Colegios y Códigos', icon: School },
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
                        Generá los mensajes y notas oficiales para que la Dirección o maestras compartan en los <strong>grupos de WhatsApp</strong> o peguen en los <strong>cuadernos de comunicaciones</strong>. Sin códigos técnicos ni archivos ilegibles.
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

                  {/* Secondary Tools row */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-amber-200/60 text-xs">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Generar Formato:</span>
                      <button
                        type="button"
                        onClick={() => handleRegenerarCodigos('nemotecnico')}
                        className="px-2.5 py-1.5 bg-amber-200/80 hover:bg-amber-300 text-amber-950 font-bold text-[11px] rounded-lg transition-colors cursor-pointer"
                        title="Códigos nemotécnicos como SALA-3TM"
                      >
                        Nemotécnicos (SALA-3TM)
                      </button>
                      <button
                        type="button"
                        onClick={() => handleRegenerarCodigos('pin')}
                        className="px-2.5 py-1.5 bg-slate-200/80 hover:bg-slate-300 text-slate-800 font-bold text-[11px] rounded-lg transition-colors cursor-pointer"
                        title="PINs numéricos como INF3-412"
                      >
                        PINs Aleatorios
                      </button>
                    </div>

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

                {/* Filter Tabs by Sala */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="flex gap-1.5 p-1 bg-slate-100 rounded-xl">
                    {['todas', 'Sala 3', 'Sala 4', 'Sala 5'].map((tab) => (
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
                        {tab === 'todas' ? `Todos los Cursos (${SECCIONES_INICIAL_2026.length})` : tab}
                      </button>
                    ))}
                  </div>

                  <span className="text-xs text-slate-500 font-medium">
                    11 cursos configurados · 211 alumnos en nómina
                  </span>
                </div>

                {/* Course Codes List Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {SECCIONES_INICIAL_2026
                    .filter((sec) => filtroSalaCodigos === 'todas' || sec.sala.includes(filtroSalaCodigos))
                    .map((sec) => {
                      const currentCode = codigosMap[sec.id] || '';
                      const mensajeCurso = generarMensajeWhatsApp(sec, currentCode, colegioActualNombre);

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
                              <span>Código para las familias:</span>
                              <span className="text-[10px] text-slate-400 font-normal">Editable al tipear</span>
                            </label>
                            <div className="flex gap-2">
                              <input
                                type="text"
                                defaultValue={currentCode}
                                key={currentCode}
                                onBlur={(e) => {
                                  const val = e.target.value.trim().toUpperCase();
                                  if (val && val !== currentCode) {
                                    handleGuardarCodigo(sec.id, val);
                                  }
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter') {
                                    e.preventDefault();
                                    const val = (e.target as HTMLInputElement).value.trim().toUpperCase();
                                    if (val) handleGuardarCodigo(sec.id, val);
                                  }
                                }}
                                className="px-3 py-1.5 text-xs font-mono font-black uppercase bg-white border border-slate-300 rounded-lg focus:outline-hidden focus:ring-2 focus:ring-amber-400 w-full tracking-wider text-slate-900"
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
                            </div>
                          </div>

                          {/* Quick Message Preview & Actions */}
                          <div className="pt-2 border-t border-slate-100 space-y-2">
                            <div className="flex items-center justify-between gap-2 flex-wrap">
                              <div className="flex items-center gap-2">
                                <a
                                  href={`https://wa.me/?text=${encodeURIComponent(mensajeCurso)}`}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
                                  title="Abrir WhatsApp con el mensaje ya redactado"
                                >
                                  <Send className="w-3.5 h-3.5" />
                                  <span>WhatsApp</span>
                                </a>

                                <button
                                  type="button"
                                  onClick={() => handleCopiarTexto(mensajeCurso, `¡Mensaje de WhatsApp para ${sec.nombreCompleto} copiado!`)}
                                  className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold text-xs rounded-xl flex items-center gap-1 transition-colors cursor-pointer"
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

                                {onProbarCodigo && (
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
                      {ALUMNOS_NOMINA_2026.length} alumnos registrados en {SECCIONES_INICIAL_2026.length} secciones / salas
                    </p>
                  </div>

                  <div className="flex items-center gap-2 flex-wrap">
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
                        placeholder="Buscar por apellido o nombre de alumno..."
                        className="w-full pl-9 pr-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                      />
                    </div>
                    <div className="sm:w-72">
                      <select
                        value={filtroSeccionAlumnos}
                        onChange={(e) => setFiltroSeccionAlumnos(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 font-medium text-slate-700"
                      >
                        <option value="todas">Todas las secciones ({ALUMNOS_NOMINA_2026.length} alumnos)</option>
                        {SECCIONES_INICIAL_2026.map((sec) => (
                          <option key={sec.id} value={sec.id}>
                            {sec.nombreCompleto} ({sec.totalAlumnos} alumnos)
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {/* Section badges pills */}
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
                    <button
                      onClick={() => setFiltroSeccionAlumnos('todas')}
                      className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                        filtroSeccionAlumnos === 'todas'
                          ? 'bg-amber-400 text-slate-950'
                          : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                      }`}
                    >
                      Todas ({ALUMNOS_NOMINA_2026.length})
                    </button>
                    {SECCIONES_INICIAL_2026.map((sec) => (
                      <button
                        key={sec.id}
                        onClick={() => setFiltroSeccionAlumnos(sec.id)}
                        className={`px-2.5 py-1 rounded-lg text-[11px] font-medium whitespace-nowrap transition-colors cursor-pointer ${
                          filtroSeccionAlumnos === sec.id
                            ? 'bg-amber-400 text-slate-950 font-bold shadow-xs'
                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                        }`}
                      >
                        {sec.nombreCompleto} ({sec.totalAlumnos})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Table */}
                <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200">
                      <tr>
                        <th className="py-2.5 px-3 w-10 text-center">✓</th>
                        <th className="py-2.5 px-3 w-12 text-slate-400">#</th>
                        <th className="py-2.5 px-4 font-bold text-slate-800">Apellido y Nombre</th>
                        <th className="py-2.5 px-4">Sala</th>
                        <th className="py-2.5 px-4">Turno</th>
                        <th className="py-2.5 px-4">División</th>
                        <th className="py-2.5 px-4 text-center">Estado Foto</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {alumnosFiltradosAdmin.length === 0 ? (
                        <tr>
                          <td colSpan={7} className="py-8 text-center text-slate-400">
                            No se encontraron alumnos con los criterios seleccionados.
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
                                {index + 1}
                              </td>
                              <td className="py-2.5 px-4 font-bold text-slate-900">
                                {alu.apellido}, {alu.nombre}
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-medium text-[11px]">
                                  {alu.grado}
                                </span>
                              </td>
                              <td className="py-2.5 px-4">
                                <span className="px-2 py-0.5 rounded-md bg-amber-100 text-amber-900 font-medium text-[11px]">
                                  {alu.turno}
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
                    Mostrando {alumnosFiltradosAdmin.length} de {ALUMNOS_NOMINA_2026.length} alumnos
                  </span>
                  <span>
                    {Object.values(checkedAlumnos).filter(Boolean).length} alumnos marcados como fotografiados
                  </span>
                </div>
              </div>
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
                      Separá cada valor con una coma. Si dejás alguno vacío, se usa una lista genérica por defecto.
                    </p>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Grados / Salas</label>
                      <textarea
                        value={nuevosGrados}
                        onChange={e => setNuevosGrados(e.target.value)}
                        placeholder="Ej: Sala 3 años, Sala 4 años, Sala 5 años, 1° grado, 2° grado..."
                        rows={2}
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white resize-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Divisiones</label>
                      <input
                        type="text"
                        value={nuevasDivisiones}
                        onChange={e => setNuevasDivisiones(e.target.value)}
                        placeholder="Ej: A, B, C, Jornada Extendida"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="text-xs font-bold text-slate-700">Turnos</label>
                      <input
                        type="text"
                        value={nuevosTurnos}
                        onChange={e => setNuevosTurnos(e.target.value)}
                        placeholder="Ej: Mañana, Tarde, Jornada Extendida / Completa"
                        className="w-full px-3 py-2 rounded-xl border border-slate-300 text-xs bg-white"
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
          secciones={SECCIONES_INICIAL_2026}
          codigosMap={codigosMap}
          colegioNombre={colegioActualNombre}
          seccionSeleccionadaInicial={seccionParaCircular}
        />

      </div>
    </div>
  );
}
