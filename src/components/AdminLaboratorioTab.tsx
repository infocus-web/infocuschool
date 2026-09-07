import { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  Printer, Download, Mail, CheckCircle2, FolderDown, FileCode,
  Layers, Search, RefreshCw, FileText, Check, Sparkles, AlertCircle, FileSpreadsheet,
  Globe, ShieldCheck, Send, ExternalLink, ChevronDown, ChevronUp
} from 'lucide-react';
import { 
  PedidoEscolarCompleto, 
  descargarLoteLaboratorioZip, 
  guardarPedidosEnStorage,
  formatearCodigoCliente
} from '../services/pedidosLabService';
import { 
  enviarFotosPorEmail, 
  consultarEstadoResend, 
  enviarEmailPruebaResend, 
  EstadoResend 
} from '../services/emailService';
import { descargarLibroExcel } from '../services/excelDownloadHelper';
import { SECCIONES_INICIAL_2026 } from '../data/alumnosData';
import { CODIGOS_CURSOS_INICIALES } from '../data/codigosCursos';
import ModalPlanillaExcelLab from './ModalPlanillaExcelLab';

interface AdminLaboratorioTabProps {
  pedidos: PedidoEscolarCompleto[];
  onActualizarPedidos: (pedidos: PedidoEscolarCompleto[]) => void;
  colegioNombre?: string;
}

export default function AdminLaboratorioTab({
  pedidos,
  onActualizarPedidos,
  colegioNombre = 'Instituto Madre del Divino Pastor'
}: AdminLaboratorioTabProps) {
  const [cursoFiltro, setCursoFiltro] = useState<string>('todos');
  const [modoEstructuraCarpetas, setModoEstructuraCarpetas] = useState<'solo_2_carpetas_tamano' | 'por_alumno'>('solo_2_carpetas_tamano');
  const [busquedaAlumno, setBusquedaAlumno] = useState<string>('');
  const [isDescargandoZip, setIsDescargandoZip] = useState<boolean>(false);
  const [zipFeedbackMsg, setZipFeedbackMsg] = useState<string | null>(null);
  const [emailFeedbackMsg, setEmailFeedbackMsg] = useState<string | null>(null);
  const [modalExcelAbierto, setModalExcelAbierto] = useState<boolean>(false);
  const [resendEstado, setResendEstado] = useState<EstadoResend | null>(null);
  const [testEmailInput, setTestEmailInput] = useState<string>('alderpol@gmail.com');
  const [isEnviandoPrueba, setIsEnviandoPrueba] = useState<boolean>(false);
  const [feedbackPrueba, setFeedbackPrueba] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  // Tarjeta de dominio de correo: es información de referencia que casi no cambia, así que
  // arranca colapsada (solo el resumen de una línea) para no ocupar espacio de entrada.
  const [dominioExpandido, setDominioExpandido] = useState(false);

  useEffect(() => {
    consultarEstadoResend().then(setResendEstado).catch(() => {});
  }, []);

  const handleEnviarPruebaEmail = async () => {
    if (!testEmailInput || !testEmailInput.includes('@')) {
      setFeedbackPrueba({ tipo: 'error', texto: 'Por favor ingresá un correo electrónico válido' });
      return;
    }
    setIsEnviandoPrueba(true);
    setFeedbackPrueba(null);
    try {
      const res = await enviarEmailPruebaResend(testEmailInput.trim());
      if (res.success) {
        setFeedbackPrueba({
          tipo: 'ok',
          texto: `¡Correo de prueba enviado con éxito a ${testEmailInput} desde fotos@retratoescolar.com.ar! (ID: ${res.messageId || 'OK'})`
        });
      } else {
        setFeedbackPrueba({
          tipo: 'error',
          texto: res.error || res.warning || 'No se pudo enviar. Asegúrate de tener RESEND_API_KEY configurada en tus variables de entorno.'
        });
      }
    } catch (e: any) {
      setFeedbackPrueba({ tipo: 'error', texto: e?.message || 'Error de red al intentar enviar.' });
    } finally {
      setIsEnviandoPrueba(false);
    }
  };

  // Selected photo to preview backprint (defaults to the user's exact example)
  const [fotoPreviewDorso, setFotoPreviewDorso] = useState<{
    nombreArchivo: string;
    alumnoNombre: string;
    codigoCurso: string;
    tamano: string;
    tipo: string;
  }>({
    nombreArchivo: '3ATT_FABRICIO_PEREZ.jpg',
    alumnoNombre: 'Fabricio Pérez',
    codigoCurso: '3ATT',
    tamano: '15x21 cm',
    tipo: 'Retrato Individual'
  });

  const pedidosAprobados = useMemo(() => {
    return pedidos.filter(p => p.estadoPago === 'aprobado');
  }, [pedidos]);

  const pedidosFiltrados = useMemo(() => {
    return pedidosAprobados.filter(p => {
      const matchCurso = cursoFiltro === 'todos' || p.cursoCodigo === cursoFiltro;
      const q = busquedaAlumno.toLowerCase().trim();
      const matchBusqueda = !q || 
        p.alumnoNombre.toLowerCase().includes(q) || 
        p.codigoAlumno.toLowerCase().includes(q) ||
        p.tutorEmail.toLowerCase().includes(q);
      return matchCurso && matchBusqueda;
    });
  }, [pedidosAprobados, cursoFiltro, busquedaAlumno]);

  // Statistics calculation
  const totalCopias15x21 = useMemo(() => {
    return pedidosFiltrados.reduce((acc, p) => {
      return acc + p.archivosParaLaboratorio.filter(a => a.tamanoImpresion === '15x21').length;
    }, 0);
  }, [pedidosFiltrados]);

  const totalCopias20x30 = useMemo(() => {
    return pedidosFiltrados.reduce((acc, p) => {
      return acc + p.archivosParaLaboratorio.filter(a => a.tamanoImpresion === '20x30').length;
    }, 0);
  }, [pedidosFiltrados]);

  // Handle ZIP batch download
  const handleDescargarLoteCompleto = async () => {
    if (pedidosFiltrados.length === 0) return;
    setIsDescargandoZip(true);
    setZipFeedbackMsg(null);

    try {
      const zipBlob = await descargarLoteLaboratorioZip(pedidos, {
        nombreColegio: colegioNombre,
        filtroCurso: cursoFiltro,
        estructuraCarpetas: modoEstructuraCarpetas
      });

      // Trigger download
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      const nombreArchivoZip = `LABORATORIO_${cursoFiltro === 'todos' ? 'TODOS_LOS_CURSOS' : cursoFiltro}_${modoEstructuraCarpetas === 'solo_2_carpetas_tamano' ? '2CARPETAS' : 'POR_ALUMNO'}.zip`;
      a.download = nombreArchivoZip;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      const detalleMsg = modoEstructuraCarpetas === 'solo_2_carpetas_tamano'
        ? '¡Lote generado con exactamente 2 carpetas (15x21 y 20x30) y archivos JPG sueltos con código de cliente (ej: 3ATT_FABRICIO_PEREZ.jpg)!'
        : '¡Lote generado con subcarpetas por alumno!';
      setZipFeedbackMsg(detalleMsg);
      setTimeout(() => setZipFeedbackMsg(null), 8000);
    } catch (err) {
      console.error('Error generando lote ZIP:', err);
      setZipFeedbackMsg('Hubo un inconveniente al empaquetar el ZIP. Por favor reintentá.');
    } finally {
      setIsDescargandoZip(false);
    }
  };

  // Handle single student ZIP download
  const handleDescargarZipAlumno = async (pedido: PedidoEscolarCompleto) => {
    setIsDescargandoZip(true);
    try {
      const zipBlob = await descargarLoteLaboratorioZip([pedido], {
        nombreColegio: colegioNombre,
        filtroCurso: pedido.cursoCodigo,
        organizarEnSubcarpetasPorAlumno: false
      });
      const url = URL.createObjectURL(zipBlob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${pedido.codigoAlumno}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      setZipFeedbackMsg(`¡Fotos de ${pedido.alumnoNombre} descargadas con nombres para laboratorio!`);
      setTimeout(() => setZipFeedbackMsg(null), 4000);
    } catch (err) {
      console.error(err);
    } finally {
      setIsDescargandoZip(false);
    }
  };

  // Datos estructurados para la planilla de control de pedidos en Excel
  const datosPlanillaExcel = useMemo(() => {
    return pedidosFiltrados.map((p, idx) => {
      const codigoCliente = p.codigoAlumno || formatearCodigoCliente(p.cursoCodigo, p.alumnoNombre);
      const listaArchivos = p.archivosParaLaboratorio && p.archivosParaLaboratorio.length > 0
        ? p.archivosParaLaboratorio.map(a => `${a.tamanoImpresion}: ${a.nombreArchivoLab}${a.esCopiaExtra ? ' (COPIA EXTRA)' : ''}`).join(' | ')
        : '15x21 + 20x30';
      const tieneCopiasExtras = p.archivosParaLaboratorio.some(a => a.esCopiaExtra);

      return {
        'N°': idx + 1,
        'ID Pedido': p.id,
        'Fecha': p.fecha,
        'Código Cliente (Archivo Minilab)': codigoCliente,
        'Curso / Sala': `${p.cursoCodigo} - ${p.grado} (${p.division})`,
        'Turno': p.turno || 'Tarde',
        'Alumno': p.alumnoNombre,
        'N° Lista': p.alumnoNumeroLista || idx + 1,
        'Tutor Responsable': p.tutorNombre,
        'Teléfono': p.tutorTelefono,
        'Email': p.tutorEmail,
        'Kit Contratado': p.kitNombre + (tieneCopiasExtras ? ' (+ COPIA EXTRA)' : ''),
        'Cantidad Fotos': p.archivosParaLaboratorio?.length || 2,
        'Archivos a Imprimir': listaArchivos,
        'Estado Pago': p.estadoPago.toUpperCase(),
        'Importe Total': `$${p.total.toLocaleString('es-AR')}`,
        'Ubicación 15x21': `15x21/${codigoCliente}.jpg`,
        'Ubicación 20x30': `20x30/${codigoCliente}.jpg`
      };
    });
  }, [pedidosFiltrados]);

  // Exportar planilla de control de pedidos a Excel (.XLSX)
  const handleExportarExcelLaboratorio = () => {
    // 1. Abrir de inmediato el modal de confirmación, descarga y vista previa
    setModalExcelAbierto(true);

    // 2. Intentar la descarga directa en segundo plano
    try {
      const wb = XLSX.utils.book_new();
      const ws = XLSX.utils.json_to_sheet(datosPlanillaExcel);
      ws['!cols'] = [
        { wch: 5 },
        { wch: 18 },
        { wch: 18 },
        { wch: 30 },
        { wch: 22 },
        { wch: 12 },
        { wch: 26 },
        { wch: 10 },
        { wch: 22 },
        { wch: 16 },
        { wch: 26 },
        { wch: 24 },
        { wch: 15 },
        { wch: 45 },
        { wch: 14 },
        { wch: 15 },
        { wch: 26 },
        { wch: 26 }
      ];
      XLSX.utils.book_append_sheet(wb, ws, 'Planilla de Control');

      const nombreArchivo = `PLANILLA_LABORATORIO_${colegioNombre.replace(/\s+/g, '_')}_${cursoFiltro}.xlsx`;
      const ok = descargarLibroExcel(wb, nombreArchivo);

      if (ok) {
        setZipFeedbackMsg(`¡Iniciando descarga de planilla Excel: ${nombreArchivo}!`);
      } else {
        setZipFeedbackMsg('Si tu navegador no descargó automáticamente, podés usar los botones del panel.');
      }
      setTimeout(() => setZipFeedbackMsg(null), 5000);
    } catch (err) {
      console.error('Error al exportar planilla Excel de laboratorio:', err);
    }
  };

  const handleReenviarEmailHD = async (pedido: PedidoEscolarCompleto) => {
    if (!pedido.tutorEmail || !pedido.tutorEmail.includes('@')) {
      setEmailFeedbackMsg(`⚠️ El alumno ${pedido.alumnoNombre} no cuenta con un email de tutor registrado.`);
      setTimeout(() => setEmailFeedbackMsg(null), 5000);
      return;
    }

    const ahora = new Date();
    const fechaHora = `${ahora.toLocaleDateString('es-AR')} ${ahora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}`;
    
    setEmailFeedbackMsg(`Enviando fotos HD a ${pedido.tutorEmail} desde fotos@retratoescolar.com.ar...`);

    try {
      const res = await enviarFotosPorEmail({
        to: pedido.tutorEmail,
        tutorNombre: pedido.tutorNombre,
        alumnoNombre: pedido.alumnoNombre,
        colegioNombre: pedido.colegioNombre,
        cursoCodigo: pedido.cursoCodigo,
        pedidoId: pedido.id,
        kitNombre: pedido.kitNombre,
        total: pedido.total,
        linkDescargaHD: pedido.linkDescargaHD,
        esImpreso: pedido.kitId === 'kit-clasico',
      });

      const pedidosActualizados = pedidos.map(p => {
        if (p.id === pedido.id) {
          return {
            ...p,
            emailEnviado: true,
            fechaEnvioEmail: fechaHora
          };
        }
        return p;
      });

      onActualizarPedidos(pedidosActualizados);
      guardarPedidosEnStorage(pedidosActualizados);

      if (res.success) {
        setEmailFeedbackMsg(`✅ Correo con enlaces HD enviado con éxito a ${pedido.tutorEmail} desde fotos@retratoescolar.com.ar (ID: ${res.messageId || 'OK'})`);
      } else if (res.warning) {
        setEmailFeedbackMsg(`ℹ️ ${res.warning} (Entrega registrada para ${pedido.tutorEmail})`);
      } else {
        setEmailFeedbackMsg(`⚠️ ${res.error || 'Aviso durante el envío'}`);
      }
    } catch (err: any) {
      setEmailFeedbackMsg(`Error de conexión al enviar correo: ${err?.message || err}`);
    }
    setTimeout(() => setEmailFeedbackMsg(null), 7000);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Feedback Toast */}
      {zipFeedbackMsg && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-2xl text-xs font-bold flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{zipFeedbackMsg}</span>
          </div>
          <button 
            onClick={() => setZipFeedbackMsg(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs px-2 py-1 rounded bg-emerald-100 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {emailFeedbackMsg && (
        <div className="p-4 bg-sky-50 border border-sky-300 text-sky-950 rounded-2xl text-xs font-bold flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2.5">
            <Mail className="w-5 h-5 text-sky-600 shrink-0" />
            <span>{emailFeedbackMsg}</span>
          </div>
          <button 
            onClick={() => setEmailFeedbackMsg(null)}
            className="text-sky-700 hover:text-sky-900 text-xs px-2 py-1 rounded bg-sky-100 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* TARJETA DE DOMINIO VERIFICADO (retratoescolar.com.ar) — colapsada por defecto:
          es información de referencia que casi nunca cambia, así que solo se muestra un
          resumen de una línea hasta que se hace clic para expandirla. */}
      <div className="rounded-2xl bg-gradient-to-br from-emerald-950/90 via-slate-900 to-slate-900 border border-emerald-500/30 text-white shadow-sm overflow-hidden">
        <button
          type="button"
          onClick={() => setDominioExpandido(!dominioExpandido)}
          className="w-full p-4 sm:p-5 flex items-center justify-between gap-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-9 h-9 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-4.5 h-4.5 text-emerald-400" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs uppercase tracking-wider font-bold text-slate-400">Dominio de Correo Transaccional</span>
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                  <Check className="w-3 h-3 text-emerald-400" />
                  Verificado
                </span>
              </div>
              <p className="text-xs text-slate-300 truncate">retratoescolar.com.ar · listo para enviar emails</p>
            </div>
          </div>
          {dominioExpandido ? (
            <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
          )}
        </button>

        {dominioExpandido && (
          <div className="px-4 sm:px-5 pb-4 sm:pb-5 space-y-4 animate-in fade-in duration-150">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1 border-t border-slate-800/80">
              <div className="pt-3">
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-mono text-slate-300 bg-slate-800 border border-slate-700">
                  <Globe className="w-3 h-3 text-sky-400" />
                  Vercel · sa-east-1
                </span>
                <h4 className="text-base sm:text-lg font-black text-white font-['Outfit'] mt-1.5">
                  retratoescolar.com.ar
                </h4>
                <p className="text-xs text-slate-300 mt-0.5">
                  Los enlaces de fotos Ultra HD y los comprobantes se envían a los padres desde <code className="text-emerald-300 font-bold bg-slate-950/60 px-1.5 py-0.5 rounded">fotos@retratoescolar.com.ar</code> con firmas SPF, DKIM y DMARC autorizadas.
                </p>
              </div>

              <div className="flex items-center gap-2 self-end sm:self-center pt-3 sm:pt-0">
                <span className="text-[11px] text-emerald-400 font-semibold flex items-center gap-1.5 bg-emerald-950/60 px-3 py-1.5 rounded-xl border border-emerald-800/60">
                  <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                  Listo para enviar emails
                </span>
              </div>
            </div>

            {/* Mini formulario de prueba de envío */}
            <div className="pt-3 border-t border-slate-800/80 flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
              <div className="text-xs text-slate-400 flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-400 shrink-0" />
                <span>Probar entrega en bandeja de entrada:</span>
              </div>

              <div className="flex items-center gap-2 flex-1 max-w-md">
                <input
                  type="email"
                  value={testEmailInput}
                  onChange={(e) => setTestEmailInput(e.target.value)}
                  placeholder="tu-email@gmail.com"
                  className="flex-1 px-3 py-2 rounded-xl bg-slate-950/80 border border-slate-700 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 font-mono"
                />
                <button
                  type="button"
                  onClick={handleEnviarPruebaEmail}
                  disabled={isEnviandoPrueba}
                  className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold text-xs flex items-center gap-1.5 transition-all shadow-sm shrink-0 cursor-pointer active:scale-95"
                >
                  {isEnviandoPrueba ? (
                    <>
                      <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                      <span>Enviando...</span>
                    </>
                  ) : (
                    <>
                      <Send className="w-3.5 h-3.5" />
                      <span>Enviar Prueba</span>
                    </>
                  )}
                </button>
              </div>
            </div>

            {feedbackPrueba && (
              <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 animate-in fade-in ${
                feedbackPrueba.tipo === 'ok'
                  ? 'bg-emerald-900/40 border border-emerald-600/50 text-emerald-200'
                  : 'bg-rose-950/40 border border-rose-700/50 text-rose-200'
              }`}>
                {feedbackPrueba.tipo === 'ok' ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span>{feedbackPrueba.texto}</span>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Top Explanation Banner */}
      <div className="p-5 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-md space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md shrink-0">
              <Printer className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold font-['Outfit'] flex items-center gap-2">
                <span>Preparación Automatizada para Laboratorio & Minilab</span>
                <span className="text-[10px] uppercase tracking-wider font-bold bg-amber-400/20 text-amber-300 px-2 py-0.5 rounded-full border border-amber-400/30">
                  Noritsu · Fuji · Klick
                </span>
              </h3>
              <p className="text-xs text-slate-300 mt-0.5">
                Genera un archivo ZIP con exactamente 2 carpetas (<code className="text-amber-300 font-bold">15x21</code> y <code className="text-amber-300 font-bold">20x30</code>) y los archivos JPG sueltos dentro con el código de cliente (ej: <code className="text-amber-300 font-bold">3ATT_FABRICIO_PEREZ.jpg</code>).
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <button
              onClick={handleExportarExcelLaboratorio}
              disabled={pedidosFiltrados.length === 0}
              className="px-3.5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-all shadow-md shadow-emerald-600/20 flex items-center gap-2 cursor-pointer active:scale-98"
              title="Descarga la planilla de control de pedidos para el laboratorio en formato Excel (.XLSX)"
            >
              <FileSpreadsheet className="w-4 h-4 text-emerald-200" />
              <span>Planilla Excel (.XLSX)</span>
            </button>

            <button
              onClick={handleDescargarLoteCompleto}
              disabled={isDescargandoZip || pedidosFiltrados.length === 0}
              className="px-4 py-2.5 bg-amber-400 hover:bg-amber-300 disabled:opacity-50 text-slate-950 font-extrabold text-xs rounded-xl transition-all shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer active:scale-98"
            >
              {isDescargandoZip ? (
                <>
                  <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                  <span>Generando ZIP del Lote...</span>
                </>
              ) : (
                <>
                  <FolderDown className="w-4 h-4 text-slate-950" />
                  <span>Descargar Lote para Laboratorio (.ZIP)</span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* Packing & Options bar */}
        <div className="pt-3 border-t border-slate-700/80 flex flex-wrap items-center justify-between gap-4 text-xs">
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-slate-400 font-bold uppercase text-[10px] tracking-wider">Estructura del ZIP:</span>
            
            <label className="text-slate-200 font-semibold flex items-center gap-2 cursor-pointer hover:text-white transition-colors">
              <input
                type="radio"
                name="estructuraCarpetas"
                value="solo_2_carpetas_tamano"
                checked={modoEstructuraCarpetas === 'solo_2_carpetas_tamano'}
                onChange={() => setModoEstructuraCarpetas('solo_2_carpetas_tamano')}
                className="w-4 h-4 text-amber-400 focus:ring-amber-400"
              />
              <span className="flex items-center gap-1.5">
                <span>Solo 2 carpetas (<code className="text-amber-300 bg-slate-950 px-1 py-0.5 rounded font-mono">15x21</code> y <code className="text-amber-300 bg-slate-950 px-1 py-0.5 rounded font-mono">20x30</code>) con archivos sueltos</span>
                <span className="text-[10px] bg-amber-400/20 text-amber-300 font-bold px-1.5 py-0.5 rounded">Recomendado</span>
              </span>
            </label>

            <label className="text-slate-400 font-normal flex items-center gap-2 cursor-pointer hover:text-slate-200 transition-colors">
              <input
                type="radio"
                name="estructuraCarpetas"
                value="por_alumno"
                checked={modoEstructuraCarpetas === 'por_alumno'}
                onChange={() => setModoEstructuraCarpetas('por_alumno')}
                className="w-4 h-4 text-amber-400 focus:ring-amber-400"
              />
              <span>Subcarpeta por alumno (<code className="text-slate-300 bg-slate-950 px-1 py-0.5 rounded font-mono">CURSO/ALUMNO/</code>)</span>
            </label>
          </div>

          <span className="text-[11px] text-slate-400">
            Nomenclatura: <code className="text-amber-300 font-bold">[CURSO]_[ALUMNO].jpg</code> (ej: <code className="text-amber-300 font-mono font-bold">3ATT_FABRICIO_PEREZ.jpg</code>)
          </span>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Pedidos para Imprenta</span>
          <div className="text-xl font-extrabold text-slate-900 mt-1 font-['Outfit']">
            {pedidosFiltrados.length} <span className="text-xs font-normal text-slate-500">alumnos</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Ampliaciones 15x21 cm</span>
          <div className="text-xl font-extrabold text-indigo-600 mt-1 font-['Outfit']">
            {totalCopias15x21} <span className="text-xs font-normal text-slate-500">copias</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Grupales 20x30 cm</span>
          <div className="text-xl font-extrabold text-emerald-600 mt-1 font-['Outfit']">
            {totalCopias20x30} <span className="text-xs font-normal text-slate-500">copias</span>
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-white border border-slate-200 shadow-xs">
          <span className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Entregas HD por Email</span>
          <div className="text-xl font-extrabold text-amber-600 mt-1 font-['Outfit']">
            {pedidosFiltrados.filter(p => p.emailEnviado).length} / {pedidosFiltrados.length}
          </div>
        </div>
      </div>

      {/* Interactive Backprint Simulator (Visual Dorso del Papel Químico) */}
      <div className="p-5 rounded-2xl bg-amber-50/70 border border-amber-200 shadow-xs space-y-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-amber-600" />
            <span className="text-xs font-bold text-amber-950 uppercase tracking-wider">
              Simulador del Dorso de Impresión Química (Backprint del Minilab)
            </span>
          </div>
          <span className="text-[11px] text-amber-800 font-medium">
            Hacé clic en cualquier foto abajo para inspeccionar cómo sale del laboratorio
          </span>
        </div>

        {/* Paper Back Graphic Card */}
        <div className="relative max-w-2xl mx-auto rounded-xl bg-gradient-to-b from-stone-100 to-stone-200 p-6 border-2 border-dashed border-stone-300 shadow-inner font-mono text-stone-700 select-none overflow-hidden">
          {/* Faint manufacturer paper pattern watermark */}
          <div className="absolute inset-0 opacity-15 pointer-events-none flex flex-wrap gap-8 items-center justify-center -rotate-12 text-[11px] font-bold tracking-widest text-stone-900">
            <span>FUJICOLOR CRYSTAL ARCHIVE</span>
            <span>KODAK ROYAL PAPER</span>
            <span>FUJICOLOR CRYSTAL ARCHIVE</span>
            <span>KODAK ROYAL PAPER</span>
          </div>

          {/* Minilab Inkjet dot matrix backprint stamping simulation */}
          <div className="relative z-10 space-y-2 bg-white/70 backdrop-blur-xs p-4 rounded-lg border border-stone-300">
            <div className="flex items-center justify-between text-[11px] text-stone-500 pb-1 border-b border-stone-200">
              <span>REVERSO DEL PAPEL FOTOGRÁFICO 260g</span>
              <span className="font-semibold text-emerald-700">NORITSU QSS-3701HD · LÍNEA 1</span>
            </div>

            <div className="py-2 px-3 bg-stone-900 text-emerald-400 rounded font-mono text-xs sm:text-sm font-black tracking-widest break-all shadow-inner border border-stone-800">
              &gt; {fotoPreviewDorso.nombreArchivo} &lt;
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-stone-600 pt-1">
              <span><strong>Alumno:</strong> {fotoPreviewDorso.alumnoNombre}</span>
              <span><strong>Toma:</strong> {fotoPreviewDorso.tipo} ({fotoPreviewDorso.tamano})</span>
              <span><strong>Curso:</strong> {fotoPreviewDorso.codigoCurso}</span>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-amber-900 text-center">
          💡 <strong>Beneficio clave para el fotógrafo:</strong> Al salir las copias de la canasta del minilab, el operador o tú solo tienen que leer la inscripción del reverso para saber exactamente a qué alumno pertenece la foto y guardarla en su sobre conmemorativo sin confusiones.
        </p>
      </div>

      {/* Filters & Search Toolbar */}
      {/* min-w-0 en la fila de pills es lo que evita que la lista de cursos se
          desborde y quede tapada por/tapando el buscador cuando ambos comparten la fila
          (sin min-w-0, un flex item con overflow-x-auto ignora el ancho del contenedor). */}
      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-center justify-between pt-2">
        <div className="flex items-center gap-2 w-full sm:min-w-0 sm:flex-1 overflow-x-auto pb-1">
          <button
            onClick={() => setCursoFiltro('todos')}
            className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer ${
              cursoFiltro === 'todos'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos los Cursos ({pedidosAprobados.length})
          </button>

          {SECCIONES_INICIAL_2026.slice(0, 5).map(sec => {
            const code = CODIGOS_CURSOS_INICIALES[sec.id] || sec.id;
            const count = pedidosAprobados.filter(p => p.cursoCodigo === code).length;
            return (
              <button
                key={sec.id}
                onClick={() => setCursoFiltro(code)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold transition-colors cursor-pointer whitespace-nowrap ${
                  cursoFiltro === code
                    ? 'bg-amber-400 text-slate-950 shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {sec.nombreCompleto} ({count})
              </button>
            );
          })}
        </div>

        {/* Search input */}
        <div className="relative w-full sm:w-64 shrink-0">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={busquedaAlumno}
            onChange={(e) => setBusquedaAlumno(e.target.value)}
            placeholder="Buscar por alumno o código..."
            className="w-full pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
          />
        </div>
      </div>

      {/* Orders & Lab Files Table */}
      <div className="bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-3 w-12 text-center">N°</th>
                <th className="py-3 px-4">Alumno & Código Escolar</th>
                <th className="py-3 px-4">Curso & Turno</th>
                <th className="py-3 px-4">Archivos Asignados para Minilab</th>
                <th className="py-3 px-4">Entrega HD por Email</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-10 text-center text-slate-400 space-y-2">
                    <AlertCircle className="w-6 h-6 mx-auto text-slate-300" />
                    <p className="text-xs">No se encontraron pedidos con los filtros aplicados.</p>
                  </td>
                </tr>
              ) : (
                pedidosFiltrados.map((pedido) => {
                  return (
                    <tr key={pedido.id} className="hover:bg-slate-50/80 transition-colors">
                      <td className="py-3.5 px-3 text-center font-mono font-bold text-slate-400">
                        #{String(pedido.alumnoNumeroLista).padStart(2, '0')}
                      </td>

                      <td className="py-3.5 px-4">
                        <div className="font-bold text-slate-900 text-sm">
                          {pedido.alumnoNombre}
                        </div>
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className="font-mono text-[10px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded">
                            {pedido.codigoAlumno}
                          </span>
                        </div>
                      </td>

                      <td className="py-3.5 px-4">
                        <span className="font-semibold text-slate-800">{pedido.grado} "{pedido.division}"</span>
                        <span className="block text-[11px] text-slate-500">Turno {pedido.turno}</span>
                        <span className="text-[10px] text-slate-400 font-mono">{pedido.cursoCodigo}</span>
                      </td>

                      {/* Photo files renamed for minilab */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1 max-w-md">
                          {pedido.archivosParaLaboratorio.map((archivo) => {
                            const isSelectedInPreview = fotoPreviewDorso.nombreArchivo === archivo.nombreArchivoLab;
                            return (
                              <button
                                key={archivo.id}
                                onClick={() => setFotoPreviewDorso({
                                  nombreArchivo: archivo.nombreArchivoLab,
                                  alumnoNombre: pedido.alumnoNombre,
                                  codigoCurso: pedido.cursoCodigo,
                                  tamano: archivo.tamanoImpresion,
                                  tipo: archivo.tipo === 'individual' ? 'Retrato Individual' : archivo.tipo === 'grupal' ? 'Foto Grupal' : 'Foto Docente'
                                })}
                                className={`w-full text-left p-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 transition-all cursor-pointer ${
                                  isSelectedInPreview
                                    ? 'bg-amber-100 border-amber-400 text-amber-950 font-bold shadow-xs'
                                    : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-700'
                                }`}
                                title="Ver en simulador de dorso"
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  <FileCode className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                  <span className="truncate">
                                    {modoEstructuraCarpetas === 'solo_2_carpetas_tamano' ? (
                                      <>
                                        <span className="text-amber-700 font-semibold">{archivo.tamanoImpresion}/</span>
                                        <span>{archivo.nombreArchivoLab}</span>
                                      </>
                                    ) : (
                                      <span>{archivo.nombreArchivoLab}</span>
                                    )}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {archivo.esCopiaExtra && (
                                    <span className="text-[9px] uppercase font-extrabold bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded shadow-2xs">
                                      COPIA {archivo.numeroCopia || 2}
                                    </span>
                                  )}
                                  <span className="text-[10px] uppercase font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                    {archivo.tamanoImpresion}
                                  </span>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </td>

                      {/* Parent Email and HD delivery status */}
                      <td className="py-3.5 px-4">
                        <div className="text-xs font-semibold text-slate-800 truncate max-w-[180px]" title={pedido.tutorEmail}>
                          {pedido.tutorEmail}
                        </div>
                        <span className="text-[11px] text-slate-500 block">{pedido.tutorNombre}</span>

                        <div className="mt-1 flex items-center gap-1">
                          {pedido.emailEnviado ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <Check className="w-3 h-3 text-emerald-600" />
                              HD Enviado ({pedido.fechaEnvioEmail ? pedido.fechaEnvioEmail.split(' ')[0] : 'OK'})
                            </span>
                          ) : (
                            <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">
                              Pendiente envío
                            </span>
                          )}
                        </div>
                      </td>

                      {/* Actions */}
                      <td className="py-3.5 px-4 text-center">
                        <div className="flex items-center justify-center gap-1.5">
                          <button
                            onClick={() => handleDescargarZipAlumno(pedido)}
                            className="p-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-lg transition-colors cursor-pointer"
                            title="Descargar ZIP renombrado de este alumno"
                          >
                            <Download className="w-4 h-4" />
                          </button>

                          <button
                            onClick={() => handleReenviarEmailHD(pedido)}
                            className="p-1.5 bg-sky-50 hover:bg-sky-100 text-sky-700 rounded-lg transition-colors cursor-pointer"
                            title={`Reenviar enlace Ultra HD por email a ${pedido.tutorEmail}`}
                          >
                            <Mail className="w-4 h-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal de Exportación y Vista Previa de Planilla Excel / CSV / Copiar */}
      <ModalPlanillaExcelLab
        isOpen={modalExcelAbierto}
        onClose={() => setModalExcelAbierto(false)}
        datosPlanilla={datosPlanillaExcel}
        nombreColegio={colegioNombre}
        cursoFiltro={cursoFiltro}
      />
    </div>
  );
}
