import { useState, useMemo, useEffect } from 'react';
import * as XLSX from 'xlsx';
import {
  Printer, Download, Mail, CheckCircle2, FolderDown, FileCode,
  Search, RefreshCw, FileText, Check, Sparkles, AlertCircle, AlertTriangle, FileSpreadsheet,
  Globe, ShieldCheck, Send, ExternalLink, ChevronDown, ChevronUp, QrCode, X
} from 'lucide-react';
import {
  PedidoEscolarCompleto,
  descargarLoteLaboratorioZip,
  guardarPedidosEnStorage,
  formatearCodigoCliente,
  generarZipHDAdmin,
  marcarPedidoRetirado
} from '../services/pedidosLabService';
import { fetchAdminAutenticado } from '../services/adminAuthService';
import { 
  enviarFotosPorEmail, 
  consultarEstadoResend, 
  enviarEmailPruebaResend, 
  EstadoResend,
  enviarActualizacionPedidos,
  TipoActualizacionPedido,
} from '../services/emailService';
import { descargarLibroExcel } from '../services/excelDownloadHelper';
import ModalPlanillaExcelLab from './ModalPlanillaExcelLab';

/** Formatea un timestamp ISO de Supabase como "18/09" (día/mes corto) para las fichas de estado. */
function formatearFechaCorta(iso?: string | null): string | null {
  if (!iso) return null;
  const fecha = new Date(iso);
  if (Number.isNaN(fecha.getTime())) return null;
  return fecha.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit' });
}

// Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo: "quiero una línea de
// tiempo unificada"). Antes el estado de un pedido se veía repartido en fichitas sueltas
// (fecha de producción por un lado, fecha de retiro por otro, nada para el retiro físico porque
// esa etapa ni existía) — acá se junta todo en una sola tira visual de 4 pasos, en el mismo orden
// que exige el servidor (ver ETAPAS_LAB en server.ts): Pagado → En producción → Listo para
// retirar → Retirado. Es sólo una vista: la fuente de verdad sigue siendo estado_lab en la base.
function LineaDeTiempoPedido({ pedido }: { pedido: PedidoEscolarCompleto }) {
  const pasos = [
    { key: 'pagado', label: 'Pagado', alcanzado: pedido.estadoPago === 'aprobado', fecha: null as string | null | undefined },
    { key: 'en_produccion', label: 'Producción', alcanzado: Boolean(pedido.estadoLab), fecha: pedido.fechaEnvioProduccion },
    { key: 'listo_retiro', label: 'Listo p/ retirar', alcanzado: pedido.estadoLab === 'listo_retiro' || pedido.estadoLab === 'entregado', fecha: pedido.fechaEnvioListoRetiro },
    { key: 'entregado', label: 'Retirado', alcanzado: pedido.estadoLab === 'entregado', fecha: pedido.fechaEntregado },
  ];
  return (
    <div className="flex items-center" title={pasos.filter(p => p.alcanzado).map(p => `${p.label}${p.fecha ? ` (${formatearFechaCorta(p.fecha)})` : ''}`).join(' → ') || 'Sin avanzar todavía'}>
      {pasos.map((paso, indice) => (
        <div key={paso.key} className="flex items-center">
          <div className="flex flex-col items-center gap-0.5">
            <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${paso.alcanzado ? 'bg-emerald-500' : 'bg-slate-200'}`} />
            <span className={`text-[8.5px] font-bold uppercase tracking-tight whitespace-nowrap ${paso.alcanzado ? 'text-emerald-700' : 'text-slate-400'}`}>
              {paso.label}
            </span>
            {paso.fecha && (
              <span className="text-[8px] text-slate-400">{formatearFechaCorta(paso.fecha)}</span>
            )}
          </div>
          {indice < pasos.length - 1 && (
            <div className={`h-0.5 w-4 sm:w-6 -mt-3.5 ${pasos[indice + 1].alcanzado ? 'bg-emerald-500' : 'bg-slate-200'}`} />
          )}
        </div>
      ))}
    </div>
  );
}

interface TarjetaPedidoLaboratorioProps {
  pedido: PedidoEscolarCompleto;
  seleccionado: boolean;
  seleccionable: boolean;
  bloqueadoPorEnvio: boolean;
  marcandoRetirado: boolean;
  modoEstructuraCarpetas: 'solo_2_carpetas_tamano' | 'por_alumno';
  onToggleSeleccion: () => void;
  onDescargarZip: () => void;
  onReenviarEmail: () => void;
  onAbrirQr: () => void;
  onMarcarRetirado: () => void;
}

/**
 * Auditoría 2026-09-21 (pedido de Pablo: "el panel de administración completo se ve muy chiquito
 * en el celular"). La tabla de pedidos de Laboratorio (más abajo en este archivo) tiene 8 columnas
 * densas pensadas para pantalla de escritorio — en el celular, aunque scrollea sin romperse
 * (overflow-x-auto ya estaba), obliga a ir y volver horizontalmente para relacionar cada dato con
 * el alumno. Esta tarjeta es la MISMA información, en una sola columna que no necesita scroll
 * horizontal ni achicar el texto — se usa sólo en pantallas chicas (ver "sm:hidden" / "hidden
 * sm:block" en el return principal), la tabla de escritorio no cambia en nada.
 */
function TarjetaPedidoLaboratorio({
  pedido,
  seleccionado,
  seleccionable,
  bloqueadoPorEnvio,
  marcandoRetirado,
  modoEstructuraCarpetas,
  onToggleSeleccion,
  onDescargarZip,
  onReenviarEmail,
  onAbrirQr,
  onMarcarRetirado,
}: TarjetaPedidoLaboratorioProps) {
  return (
    <div className={`rounded-2xl border p-4 space-y-3 ${seleccionado ? 'bg-sky-50 border-sky-300' : 'bg-white border-slate-200'}`}>
      <div className="flex items-start justify-between gap-3">
        <label className="flex items-start gap-2.5 min-w-0 cursor-pointer">
          <input
            type="checkbox"
            checked={seleccionado}
            onChange={onToggleSeleccion}
            disabled={!seleccionable || bloqueadoPorEnvio}
            aria-label={`Seleccionar a ${pedido.alumnoNombre}`}
            className="w-5 h-5 mt-0.5 accent-sky-600 cursor-pointer disabled:cursor-not-allowed shrink-0"
          />
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm truncate">{pedido.alumnoNombre}</p>
            <span className="inline-block font-mono text-[11px] font-bold text-amber-800 bg-amber-100 px-1.5 py-0.5 rounded mt-0.5">
              {pedido.codigoAlumno}
            </span>
          </div>
        </label>
        <span className="font-mono text-xs font-bold text-slate-400 shrink-0">
          #{String(pedido.alumnoNumeroLista).padStart(2, '0')}
        </span>
      </div>

      <div className="text-xs text-slate-600">
        <span className="font-semibold text-slate-800">{pedido.grado} "{pedido.division}"</span>
        <span className="text-slate-400"> · Turno {pedido.turno} · </span>
        <span className="font-mono text-slate-400">{pedido.cursoCodigo}</span>
      </div>

      <div className="pt-1">
        <LineaDeTiempoPedido pedido={pedido} />
        {pedido.estadoLab === 'listo_retiro' && (
          <button
            type="button"
            onClick={onMarcarRetirado}
            disabled={marcandoRetirado}
            className="mt-2 w-full py-2.5 rounded-xl bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-xs font-bold flex items-center justify-center gap-1.5 cursor-pointer"
          >
            {marcandoRetirado ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
            Marcar retirado
          </button>
        )}
      </div>

      {/* Archivos asignados para minilab — mismo diseño que la tabla, para poder chequear en el
          celular antes de imprimir que no falte ninguna foto. */}
      <div className="space-y-1">
        {pedido.archivosParaLaboratorio.map((archivo) => (
          <div
            key={archivo.id}
            className={`w-full text-left p-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 ${
              archivo.sinFotoReal
                ? 'bg-red-50 border-red-300 text-red-900 font-bold'
                : 'bg-slate-50 border-slate-200 text-slate-700'
            }`}
          >
            <div className="flex items-center gap-1.5 truncate min-w-0">
              {archivo.sinFotoReal || !archivo.urlMuestra ? (
                <div className="w-6 h-6 rounded border border-red-300 bg-red-100 flex items-center justify-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                </div>
              ) : (
                <img src={archivo.urlMuestra} alt="" className="w-6 h-6 rounded object-cover border border-slate-200 shrink-0 bg-white" />
              )}
              <span className="truncate">
                {modoEstructuraCarpetas === 'solo_2_carpetas_tamano' ? (
                  <>
                    <span className={archivo.sinFotoReal ? 'font-semibold' : 'text-amber-700 font-semibold'}>{archivo.tamanoImpresion}/</span>
                    <span>{archivo.nombreArchivoLab}</span>
                  </>
                ) : (
                  <span>{archivo.nombreArchivoLab}</span>
                )}
              </span>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              {archivo.sinFotoReal && (
                <span className="text-[9px] uppercase font-extrabold bg-red-600 text-white px-1.5 py-0.5 rounded shadow-2xs">Falta foto</span>
              )}
              {archivo.esCopiaExtra && (
                <span className="text-[9px] uppercase font-extrabold bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded shadow-2xs">COPIA {archivo.numeroCopia || 2}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      <div className="pt-1 border-t border-slate-100">
        <div className="text-xs font-semibold text-slate-800 truncate" title={pedido.tutorEmail}>{pedido.tutorEmail}</div>
        <span className="text-[11px] text-slate-500 block">{pedido.tutorNombre}</span>
        <div className="mt-1.5">
          {pedido.emailEnviado && pedido.linkDescargaHD ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
              <Check className="w-3 h-3 text-emerald-600" />
              HD Enviado ({pedido.fechaEnvioEmail ? pedido.fechaEnvioEmail.split(' ')[0] : 'OK'})
            </span>
          ) : pedido.emailEnviado && !pedido.linkDescargaHD ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200">
              <AlertTriangle className="w-3 h-3 text-red-600" />
              Falta el .zip HD
            </span>
          ) : (
            <span className="text-[10px] text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full border border-amber-200">Pendiente envío</span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 pt-1">
        <button
          type="button"
          onClick={onDescargarZip}
          className="py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 flex flex-col items-center justify-center gap-1 cursor-pointer"
          title="Descargar ZIP renombrado de este alumno"
        >
          <Download className="w-4 h-4" />
          <span className="text-[10px] font-bold">ZIP</span>
        </button>
        <button
          type="button"
          onClick={onReenviarEmail}
          className="py-2.5 rounded-xl bg-sky-50 hover:bg-sky-100 text-sky-700 flex flex-col items-center justify-center gap-1 cursor-pointer"
          title={`Reenviar enlace Ultra HD por email a ${pedido.tutorEmail}`}
        >
          <Mail className="w-4 h-4" />
          <span className="text-[10px] font-bold">Email HD</span>
        </button>
        <button
          type="button"
          onClick={onAbrirQr}
          disabled={!pedido.supabaseId}
          className="py-2.5 rounded-xl bg-violet-50 hover:bg-violet-100 disabled:opacity-40 text-violet-700 flex flex-col items-center justify-center gap-1 cursor-pointer"
          title="Ver / descargar el QR para pegar en el sobre del laboratorio"
        >
          <QrCode className="w-4 h-4" />
          <span className="text-[10px] font-bold">QR</span>
        </button>
      </div>
    </div>
  );
}

interface AdminLaboratorioTabProps {
  pedidos: PedidoEscolarCompleto[];
  onActualizarPedidos: (pedidos: PedidoEscolarCompleto[]) => void;
  colegioNombre?: string;
  // Nombre de alumno para arrancar con la búsqueda ya cargada — usado por "Ver en
  // Laboratorio" desde la pestaña de Pedidos, para llevar directo al pedido en
  // cuestión en vez de dejar al fotógrafo a buscarlo a mano entre todos (15/9).
  busquedaInicial?: string;
  // Auditoría 2026-09-22 (pedido de Pablo): cantidad de colegios activos, para mostrarla en la
  // fila de métricas de este panel — antes vivía sola en la barra "Recaudación/Pedidos/Colegios"
  // de la cabecera de AdminModal.tsx, que Pablo pidió eliminar. La recaudación no necesita venir
  // por prop porque ya se puede derivar de `pedidos` (que AdminModal pasa completo, sin filtrar).
  totalColegios?: number;
}

export default function AdminLaboratorioTab({
  pedidos,
  onActualizarPedidos,
  colegioNombre = 'Instituto Madre del Divino Pastor',
  busquedaInicial = '',
  totalColegios = 0
}: AdminLaboratorioTabProps) {
  const [cursoFiltro, setCursoFiltro] = useState<string>('todos');
  const [modoEstructuraCarpetas, setModoEstructuraCarpetas] = useState<'solo_2_carpetas_tamano' | 'por_alumno'>('solo_2_carpetas_tamano');
  const [busquedaAlumno, setBusquedaAlumno] = useState<string>(busquedaInicial);
  const [isDescargandoZip, setIsDescargandoZip] = useState<boolean>(false);
  const [zipFeedbackMsg, setZipFeedbackMsg] = useState<string | null>(null);
  const [emailFeedbackMsg, setEmailFeedbackMsg] = useState<string | null>(null);
  const [pedidosSeleccionados, setPedidosSeleccionados] = useState<Set<string>>(new Set());
  const [enviandoActualizacion, setEnviandoActualizacion] = useState<TipoActualizacionPedido | null>(null);
  const [modalExcelAbierto, setModalExcelAbierto] = useState<boolean>(false);
  const [resendEstado, setResendEstado] = useState<EstadoResend | null>(null);
  const [testEmailInput, setTestEmailInput] = useState<string>('alderpol@gmail.com');
  const [isEnviandoPrueba, setIsEnviandoPrueba] = useState<boolean>(false);
  const [feedbackPrueba, setFeedbackPrueba] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);
  // Tarjeta de dominio de correo: es información de referencia que casi no cambia, así que
  // arranca colapsada (solo el resumen de una línea) para no ocupar espacio de entrada.
  const [dominioExpandido, setDominioExpandido] = useState(false);
  // Auditoría 2026-09-20 (revisión completa de estados): id del pedido que se está marcando como
  // retirado en este momento, para deshabilitar sólo ESE botón mientras se confirma con el
  // servidor (en vez de bloquear toda la tabla).
  const [marcandoRetiradoId, setMarcandoRetiradoId] = useState<string | null>(null);

  // Auditoría 2026-09-21 (pedido de Pablo: poder escanear con el celular un QR impreso en el
  // sobre físico de cada pedido — al escanearlo desde el laboratorio, abre directo el pedido y
  // deja avisar "Listo para retirar" sin buscarlo a mano). Estado del lightbox que muestra/baja
  // ese QR desde esta misma tabla.
  const [qrPedido, setQrPedido] = useState<PedidoEscolarCompleto | null>(null);
  const [qrBlobUrl, setQrBlobUrl] = useState<string | null>(null);
  const [qrError, setQrError] = useState<string | null>(null);

  const handleAbrirQr = async (pedido: PedidoEscolarCompleto) => {
    if (!pedido.supabaseId) return;
    setQrPedido(pedido);
    setQrBlobUrl(null);
    setQrError(null);
    try {
      const res = await fetchAdminAutenticado(`/api/admin/pedidos/${encodeURIComponent(pedido.supabaseId)}/qr`);
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setQrError(data.error || 'No se pudo generar el código QR.');
        return;
      }
      const blob = await res.blob();
      setQrBlobUrl(URL.createObjectURL(blob));
    } catch (err: any) {
      setQrError(err?.message || 'Error de red al generar el código QR.');
    }
  };

  const handleCerrarQr = () => {
    if (qrBlobUrl) URL.revokeObjectURL(qrBlobUrl);
    setQrPedido(null);
    setQrBlobUrl(null);
    setQrError(null);
  };

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

  const pedidosAprobados = useMemo(() => {
    return pedidos.filter(p => p.estadoPago === 'aprobado');
  }, [pedidos]);

  // Auditoría 2026-09-22 (pedido de Pablo): recaudación total, para la fila de métricas de acá
  // abajo — misma fórmula que usaba la barra "Recaudación/Pedidos/Colegios" de AdminModal.tsx
  // (que Pablo pidió eliminar), aplicada sobre `pedidos` (la lista completa sin filtrar por
  // curso/búsqueda que llega por prop), no sobre `pedidosFiltrados`.
  const totalRecaudado = useMemo(
    () => pedidosAprobados.reduce((acc, p) => acc + p.total, 0),
    [pedidosAprobados]
  );

  // Auditoría 2026-09-20 (bug real reportado por Pablo): antes, si el .zip HD fallaba al momento
  // del pago, nada volvía a intentarlo — quedaba en manos de que alguien notara pedido por pedido
  // que faltaba el link. Esta lista junta a todos los pagados sin link real todavía, para poder
  // reintentarlos de una sola vez en vez de ir fila por fila.
  const pedidosConHDPendiente = useMemo(
    () => pedidosAprobados.filter((p) => !p.linkDescargaHD && p.tutorEmail?.includes('@')),
    [pedidosAprobados]
  );
  const [isReintentandoTodosHD, setIsReintentandoTodosHD] = useState(false);

  // Cursos para las pastillas de filtro — auditoría 2026-09-09: antes esto salía de
  // SECCIONES_INICIAL_2026 (una lista fija de 11 secciones de una sola sala de nivel
  // inicial, mostrando solo las primeras 5) cruzada con CODIGOS_CURSOS_INICIALES (el mapa
  // de códigos inventados en localStorage, sin relación con los pedidos reales). Ahora se
  // arma directo con los cursos que de verdad aparecen en los pedidos aprobados — funciona
  // para cualquier colegio y cualquier cantidad de secciones.
  const cursosPresentes = useMemo(() => {
    const mapa = new Map<string, { codigo: string; label: string; count: number }>();
    pedidosAprobados.forEach((p) => {
      const codigo = p.cursoCodigo || 'SIN-CODIGO';
      const existente = mapa.get(codigo);
      if (existente) {
        existente.count += 1;
      } else {
        mapa.set(codigo, {
          codigo,
          label: `${p.grado || codigo}${p.division ? ` "${p.division}"` : ''}`,
          count: 1,
        });
      }
    });
    return Array.from(mapa.values()).sort((a, b) => a.label.localeCompare(b.label, 'es'));
  }, [pedidosAprobados]);

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

  const pedidosFiltradosConEmail = useMemo(
    () => pedidosFiltrados.filter((pedido) => pedido.tutorEmail?.includes('@')),
    [pedidosFiltrados]
  );
  const todosSeleccionados = pedidosFiltradosConEmail.length > 0
    && pedidosFiltradosConEmail.every((pedido) => pedidosSeleccionados.has(pedido.id));

  // Auditoría 2026-09-20 (pedido de Pablo): el botón de "En producción" ya no se desactiva
  // cuando el pedido tildado ya había recibido ese aviso antes — ahora se puede reenviar, pero
  // el texto avisa que es un reenvío (y la fecha de la primera vez se muestra aparte, por fila).
  // Mismo criterio, simétrico, para "Listo para retirar".
  const pedidosSeleccionadosArr = useMemo(
    () => pedidos.filter((pedido) => pedidosSeleccionados.has(pedido.id)),
    [pedidos, pedidosSeleccionados]
  );
  const todosYaEnProduccion = pedidosSeleccionadosArr.length > 0
    && pedidosSeleccionadosArr.every((pedido) => Boolean(pedido.estadoLab));
  const todosYaListoRetiro = pedidosSeleccionadosArr.length > 0
    && pedidosSeleccionadosArr.every((pedido) => pedido.estadoLab === 'listo_retiro');
  // Auditoría 2026-09-20 (bug real reportado por Pablo: pudo avisar "Listo para retirar" a un
  // pedido que nunca pasó por "En producción"). El botón ahora se bloquea si hay algún
  // seleccionado sin ese paso previo — el servidor también lo rechaza como segunda barrera
  // (ver /api/admin/pedidos/notificar-estado), pero acá se avisa antes de intentar mandar nada.
  const algunoSinProduccion = pedidosSeleccionadosArr.some((pedido) => !pedido.estadoLab);
  // Auditoría 2026-09-20 (revisión completa de estados): mismo criterio en sentido inverso — el
  // servidor ahora también rechaza "En producción" para un pedido que ya está en una etapa
  // posterior (ver puedeAvanzarEtapaLab en server.ts, que antes permitía retroceder estado_lab sin
  // querer). Se avisa acá antes de intentarlo, en vez de dejar que el pedido falle en silencio.
  const algunoYaAvanzoMasAlla = pedidosSeleccionadosArr.some((pedido) => pedido.estadoLab === 'listo_retiro' || pedido.estadoLab === 'entregado');

  const alternarSeleccionPedido = (pedidoId: string) => {
    setPedidosSeleccionados((actuales) => {
      const siguientes = new Set(actuales);
      if (siguientes.has(pedidoId)) siguientes.delete(pedidoId);
      else siguientes.add(pedidoId);
      return siguientes;
    });
  };

  const alternarSeleccionTodos = () => {
    setPedidosSeleccionados((actuales) => {
      const siguientes = new Set(actuales);
      pedidosFiltradosConEmail.forEach((pedido) => {
        if (todosSeleccionados) siguientes.delete(pedido.id);
        else siguientes.add(pedido.id);
      });
      return siguientes;
    });
  };

  const handleEnviarActualizacion = async (tipo: TipoActualizacionPedido) => {
    const seleccionados = pedidos.filter(
      (pedido) => pedidosSeleccionados.has(pedido.id) && pedido.tutorEmail?.includes('@')
    );
    if (seleccionados.length === 0) {
      setEmailFeedbackMsg('Seleccioná al menos un cliente con email válido.');
      return;
    }
    setEnviandoActualizacion(tipo);
    setEmailFeedbackMsg(`Enviando ${seleccionados.length} email${seleccionados.length === 1 ? '' : 's'}...`);
    const resultado = await enviarActualizacionPedidos(tipo, seleccionados.map((pedido) => ({
      // "pedidoId" es el UUID real (para que el servidor encuentre la fila); "pedidoFriendlyId"
      // es el número de pedido legible (IFS-2026-XXXX) que sí debe ver el cliente en el email —
      // antes se mandaba el UUID como si fuera el número de pedido (auditoría 2026-09-18,
      // reporte de Pablo: "Pedido: ef97bafb-6f4b-4e08-a9d9-6703de4000a7" en el correo real).
      pedidoId: pedido.supabaseId || pedido.id,
      pedidoFriendlyId: pedido.id,
      to: pedido.tutorEmail,
      tutorNombre: pedido.tutorNombre,
      alumnoNombre: pedido.alumnoNombre,
      colegioNombre: pedido.colegioNombre,
    })));
    setEnviandoActualizacion(null);
    if (resultado.success) {
      setEmailFeedbackMsg(`✅ Se enviaron ${resultado.enviados} email${resultado.enviados === 1 ? '' : 's'} correctamente.`);
      setPedidosSeleccionados(new Set());
    } else {
      setEmailFeedbackMsg(`⚠️ Se enviaron ${resultado.enviados}; fallaron ${resultado.fallidos}. ${resultado.error || resultado.errores?.[0] || ''}`);
    }
    // Auditoría 2026-09-20 (bug real reportado por Pablo): antes, después de mandar el aviso, el
    // pedido en memoria (el array "pedidos" que vive en el componente padre) nunca se actualizaba
    // — así que si el fotógrafo destildaba y volvía a tildar el mismo pedido, el panel no tenía
    // forma de saber que ya se le había avisado "En producción" y el botón volvía a comportarse
    // como si fuera la primera vez. Ahora, apenas el servidor confirma qué quedó guardado
    // (resultado.resultados, con la fecha de PRIMER envío ya resuelta ahí), se refleja al toque
    // en el estado local — sin esperar a que se vuelva a abrir la pestaña.
    if (resultado.resultados && resultado.resultados.length > 0) {
      const porId = new Map(resultado.resultados.map((r) => [r.pedidoId, r]));
      onActualizarPedidos(
        pedidos.map((pedido) => {
          const actualizado = porId.get(pedido.supabaseId || pedido.id);
          if (!actualizado) return pedido;
          return {
            ...pedido,
            estadoLab: actualizado.estadoLab,
            fechaEnvioProduccion: actualizado.fechaEnvioProduccion || pedido.fechaEnvioProduccion,
            fechaEnvioListoRetiro: actualizado.fechaEnvioListoRetiro || pedido.fechaEnvioListoRetiro,
            estadoEntrega: actualizado.estadoLab === 'listo_retiro' ? 'listo_retiro' : pedido.estadoEntrega,
          };
        })
      );
    }
  };

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

    // Auditoría 2026-09-18 (pedido de Pablo: automatizar el .zip de descarga HD): el .zip ya se
    // intenta armar solo apenas se confirma el pago (en el webhook). Si por lo que sea no está
    // listo todavía (linkDescargaHD vacío), este botón reintenta armarlo antes de mandar el
    // correo, en vez de mandar el mail sin link como pasaba siempre antes de esta auditoría.
    let linkDescargaHD = pedido.linkDescargaHD;
    if (!linkDescargaHD && pedido.supabaseId) {
      setEmailFeedbackMsg('Generando el .zip HD con las fotos de este pedido...');
      const resultadoZip = await generarZipHDAdmin(pedido.supabaseId);
      if (resultadoZip.success && resultadoZip.linkDescargaHD) {
        linkDescargaHD = resultadoZip.linkDescargaHD;
      } else {
        console.warn('No se pudo generar el .zip HD automáticamente:', resultadoZip.error);
      }
    }

    setEmailFeedbackMsg(`Enviando fotos HD a ${pedido.tutorEmail} desde fotos@retratoescolar.com.ar...`);

    try {
      const res = await enviarFotosPorEmail({
        to: pedido.tutorEmail,
        tutorNombre: pedido.tutorNombre,
        alumnoNombre: pedido.alumnoNombre,
        colegioNombre: pedido.colegioNombre,
        cursoCodigo: pedido.cursoCodigo,
        pedidoId: pedido.id,
        // Auditoría 2026-09-20: sin esto, el servidor no tenía forma de saber a qué fila de
        // Supabase corresponde este reenvío y el resultado (link real + fecha) nunca quedaba
        // grabado — el panel seguía mostrando "Pendiente envío" aunque el correo ya hubiera salido.
        pedidoSupabaseId: pedido.supabaseId,
        kitNombre: pedido.kitNombre,
        total: pedido.total,
        linkDescargaHD,
        esImpreso: pedido.kitId === 'kit-clasico',
      });

      // Auditoría 2026-09-23 (bug real encontrado en auditoría de código, ALTO): antes esto
      // marcaba `emailEnviado: true` y `fechaEnvioEmail` de forma incondicional, sin mirar
      // `res.success` — el `else if (res.warning)` de abajo incluso mostraba un mensaje "ℹ️...
      // Entrega registrada" para el caso en que RESEND_API_KEY no está configurada en el
      // servidor, que es justamente un envío SIMULADO (`enviarCorreoFotosHD` en server.ts
      // devuelve `success: false, warning: ..., simulated: true` en ese caso — nunca `success:
      // true` junto con `warning`). Si Resend estaba caído, el token admin vencido, o cualquier
      // otro error del backend, el pedido igual quedaba marcado "HD Enviado ✓" en el panel
      // (bloque `pedido.emailEnviado && pedido.linkDescargaHD`) aunque la familia nunca hubiera
      // recibido nada — y como el panel ya decía "enviado", Pablo no volvía a intentarlo. Esto se
      // disparaba en cadena por "Reintentar todos" (handleReintentarTodosHD), que llama a esta
      // función en bucle: si el proveedor de correo estaba caído durante el reintento masivo,
      // terminaba marcando falsamente a TODOS como enviados. Ahora sólo se graba
      // emailEnviado/fechaEnvioEmail cuando `res.success` es realmente true.
      if (res.success) {
        const pedidosActualizados = pedidos.map(p => {
          if (p.id === pedido.id) {
            return {
              ...p,
              emailEnviado: true,
              fechaEnvioEmail: fechaHora,
              linkDescargaHD: linkDescargaHD || p.linkDescargaHD,
            };
          }
          return p;
        });
        onActualizarPedidos(pedidosActualizados);
        guardarPedidosEnStorage(pedidosActualizados);
        setEmailFeedbackMsg(`✅ Correo con enlaces HD enviado con éxito a ${pedido.tutorEmail} desde fotos@retratoescolar.com.ar (ID: ${res.messageId || 'OK'})`);
      } else if (linkDescargaHD && linkDescargaHD !== pedido.linkDescargaHD) {
        // El envío no se confirmó, pero si se llegó a generar un .zip HD nuevo (arriba), igual
        // vale la pena guardar ese link para no tener que regenerarlo en el próximo intento —
        // sin tocar emailEnviado, que sigue reflejando la realidad (no se mandó).
        const pedidosActualizados = pedidos.map(p =>
          p.id === pedido.id ? { ...p, linkDescargaHD } : p
        );
        onActualizarPedidos(pedidosActualizados);
        guardarPedidosEnStorage(pedidosActualizados);
        setEmailFeedbackMsg(`⚠️ ${res.warning || res.error || 'No se pudo confirmar el envío del correo'} (no se marcó como enviado para ${pedido.tutorEmail})`);
      } else {
        setEmailFeedbackMsg(`⚠️ ${res.warning || res.error || 'No se pudo confirmar el envío del correo'} (no se marcó como enviado para ${pedido.tutorEmail})`);
      }
    } catch (err: any) {
      setEmailFeedbackMsg(`Error de conexión al enviar correo: ${err?.message || err}`);
    }
    setTimeout(() => setEmailFeedbackMsg(null), 7000);
  };

  // Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo): antes no existía forma
  // de cerrar el pipeline — el panel se quedaba en "Listo para retirar" para siempre. El servidor
  // (POST /api/admin/pedidos/:id/marcar-retirado) exige que el pedido ya esté en "listo_retiro",
  // así que acá alcanza con reflejar lo que el servidor confirme, sin duplicar esa validación.
  const handleMarcarRetirado = async (pedido: PedidoEscolarCompleto) => {
    if (!pedido.supabaseId) return;
    setMarcandoRetiradoId(pedido.id);
    const resultado = await marcarPedidoRetirado(pedido.supabaseId);
    setMarcandoRetiradoId(null);
    if (resultado.success) {
      const pedidosActualizados = pedidos.map((p) =>
        p.id === pedido.id
          ? { ...p, estadoLab: (resultado.estadoLab as PedidoEscolarCompleto['estadoLab']) || 'entregado', fechaEntregado: resultado.fechaEntregado || p.fechaEntregado }
          : p
      );
      onActualizarPedidos(pedidosActualizados);
      guardarPedidosEnStorage(pedidosActualizados);
      setEmailFeedbackMsg(`✅ ${pedido.alumnoNombre}: marcado como retirado.`);
    } else {
      setEmailFeedbackMsg(`⚠️ ${resultado.error || 'No se pudo marcar el pedido como retirado.'}`);
    }
    setTimeout(() => setEmailFeedbackMsg(null), 5000);
  };

  // Auditoría 2026-09-20: reintento masivo para los pedidos pagados a los que todavía les falta
  // el .zip HD real (ver pedidosConHDPendiente) — uno por uno y en secuencia, no en paralelo, para
  // no saturar Resend/Storage si son varios de golpe.
  const handleReintentarTodosHD = async () => {
    if (pedidosConHDPendiente.length === 0) return;
    setIsReintentandoTodosHD(true);
    for (const pedido of pedidosConHDPendiente) {
      setEmailFeedbackMsg(`Reintentando HD de ${pedido.alumnoNombre}...`);
      // eslint-disable-next-line no-await-in-loop
      await handleReenviarEmailHD(pedido);
    }
    setIsReintentandoTodosHD(false);
    setEmailFeedbackMsg(`✅ Reintento terminado para ${pedidosConHDPendiente.length} pedido${pedidosConHDPendiente.length === 1 ? '' : 's'}.`);
    setTimeout(() => setEmailFeedbackMsg(null), 6000);
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

      {/* Auditoría 2026-09-20 (bug real reportado por Pablo: "no le llega el enlace de descarga
          de fotos HD al cliente"). Alerta visible apenas se abre el panel, en vez de que Pablo
          tenga que descubrirlo pedido por pedido — con un botón para reintentar todos de una. */}
      {pedidosConHDPendiente.length > 0 && (
        <div className="p-4 rounded-2xl bg-red-50 border border-red-300 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-5 h-5 text-red-600 shrink-0" />
            <div>
              <p className="text-xs font-bold text-red-950">
                {pedidosConHDPendiente.length} pedido{pedidosConHDPendiente.length === 1 ? '' : 's'} pagado{pedidosConHDPendiente.length === 1 ? '' : 's'} sin el .zip HD real todavía
              </p>
              <p className="text-[11px] text-red-700 mt-0.5">
                Esas familias sólo recibieron el texto de "en breve te enviaremos el enlace" — el link nunca se generó ni se mandó. Revisá que las fotos del curso ya estén cargadas y reintentá.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={handleReintentarTodosHD}
            disabled={isReintentandoTodosHD}
            className="px-3.5 py-2 bg-red-600 hover:bg-red-500 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl transition-all shadow-sm flex items-center gap-2 cursor-pointer active:scale-98 shrink-0"
          >
            {isReintentandoTodosHD ? <RefreshCw className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
            {isReintentandoTodosHD ? 'Reintentando...' : `Reintentar los ${pedidosConHDPendiente.length}`}
          </button>
        </div>
      )}

      {/* TARJETA DE DOMINIO VERIFICADO (retratoescolar.com.ar) — colapsada por defecto:
          es información de referencia que casi nunca cambia, así que solo se muestra un
          resumen de una línea hasta que se hace clic para expandirla.
          Auditoría 2026-09-22 (pedido de Pablo): la fila colapsada ocupaba el doble de alto de
          lo necesario para ser sólo un indicador de referencia — se reduce el padding/íconos/
          texto a la mitad. Además se agrupa, en este wrapper sin gap propio, con el banner de
          abajo (que normalmente quedaría separado por el space-y-6 del contenedor padre) para
          eliminar el aire entre ambas franjas oscuras. */}
      <div>
      <div className="rounded-2xl bg-gradient-to-br from-emerald-950/90 via-slate-900 to-slate-900 border border-emerald-500/30 text-white shadow-sm overflow-hidden rounded-b-none">
        <button
          type="button"
          onClick={() => setDominioExpandido(!dominioExpandido)}
          className="w-full p-2 sm:p-2.5 flex items-center justify-between gap-3 cursor-pointer text-left"
        >
          <div className="flex items-center gap-2 min-w-0">
            <div className="w-6 h-6 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center shrink-0">
              <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
            </div>
            <div className="min-w-0 flex flex-wrap items-center gap-x-2 gap-y-0.5">
              <span className="text-[10px] uppercase tracking-wider font-bold text-slate-400">Dominio de Correo Transaccional</span>
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-extrabold bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shrink-0">
                <Check className="w-2.5 h-2.5 text-emerald-400" />
                Verificado
              </span>
              <span className="text-[10px] text-slate-300 truncate">retratoescolar.com.ar · listo para enviar emails</span>
            </div>
          </div>
          {dominioExpandido ? (
            <ChevronUp className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
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
      <div className="p-5 rounded-2xl rounded-t-none bg-gradient-to-r from-slate-900 to-slate-800 text-white shadow-md space-y-3">
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
      </div>

      {/* Metrics Row — pedido de Pablo (22/9): esta fila ocupaba casi media pantalla como 4
          tarjetas grandes separadas para datos que son sólo de referencia rápida. Se compacta a
          una única tira de chips en línea. Auditoría 2026-09-22: además absorbe la vieja barra
          "Recaudación/Pedidos/Colegios" de la cabecera del panel (AdminModal.tsx), que Pablo pidió
          eliminar de ahí y traer acá — se calculan con `totalRecaudado` (derivado de `pedidos`,
          la lista completa) y con la nueva prop `totalColegios`. */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-slate-200 bg-white px-4 py-2.5 shadow-xs text-xs">
        <span className="text-slate-500">
          Recaudación <strong className="text-slate-900 font-extrabold">${totalRecaudado.toLocaleString('es-AR')}</strong>
        </span>
        <span className="text-slate-500">
          Colegios <strong className="text-slate-900 font-extrabold">{totalColegios}</strong>
        </span>
        <div className="h-3.5 w-px bg-slate-200" />
        <span className="text-slate-500">
          Pedidos para Imprenta <strong className="text-slate-900 font-extrabold">{pedidosFiltrados.length}</strong>
        </span>
        <span className="text-slate-500">
          Ampliaciones 15x21cm <strong className="text-indigo-600 font-extrabold">{totalCopias15x21}</strong>
        </span>
        <span className="text-slate-500">
          Grupales 20x30cm <strong className="text-emerald-600 font-extrabold">{totalCopias20x30}</strong>
        </span>
        <span className="text-slate-500">
          Entregas HD por Email <strong className="text-amber-600 font-extrabold">{pedidosFiltrados.filter(p => p.emailEnviado).length}/{pedidosFiltrados.length}</strong>
        </span>
      </div>

      {/* Filters & Search Toolbar */}
      {/* Pedido de Pablo (22/9): los filtros de curso/búsqueda y la barra de "Avisos de estado
          por email" ocupaban dos bloques apilados, cada uno con su propio padding/borde grande.
          Se compactan en UNA sola fila (flex-wrap: en pantallas angostas sigue bajando de línea
          en vez de desbordar), con textos e íconos a la mitad de tamaño. min-w-0 en la lista de
          cursos evita que se desborde y tape al buscador (ver auditoría anterior). */}
      <div className="flex flex-wrap items-center gap-1.5 pt-2 text-[11px]">
        <div className="flex items-center gap-1.5 min-w-0 max-w-full overflow-x-auto pb-1">
          <button
            onClick={() => setCursoFiltro('todos')}
            className={`px-2 py-1 rounded-lg font-bold transition-colors cursor-pointer whitespace-nowrap ${
              cursoFiltro === 'todos'
                ? 'bg-slate-900 text-white shadow-xs'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            Todos ({pedidosAprobados.length})
          </button>

          {cursosPresentes.map((c) => (
            <button
              key={c.codigo}
              onClick={() => setCursoFiltro(c.codigo)}
              className={`px-2 py-1 rounded-lg font-bold transition-colors cursor-pointer whitespace-nowrap ${
                cursoFiltro === c.codigo
                  ? 'bg-amber-400 text-slate-950 shadow-xs'
                  : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {c.label} ({c.count})
            </button>
          ))}
        </div>

        <div className="relative w-36 shrink-0">
          <Search className="w-3 h-3 absolute left-2 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={busquedaAlumno}
            onChange={(e) => setBusquedaAlumno(e.target.value)}
            placeholder="Buscar..."
            className="w-full pl-6 pr-2 py-1 rounded-lg border border-slate-200 bg-white focus:outline-hidden focus:ring-2 focus:ring-amber-400"
          />
        </div>

        <div className="h-4 w-px bg-slate-200 mx-1 shrink-0" />

        <div className="flex items-center gap-1.5 shrink-0 rounded-lg bg-sky-50 border border-sky-200 px-2 py-1">
          <span className="font-bold text-sky-950">Avisos:</span>
          <span className="text-sky-700">{pedidosSeleccionados.size} sel.</span>
        </div>
        <button type="button" onClick={alternarSeleccionTodos} disabled={pedidosFiltradosConEmail.length === 0 || Boolean(enviandoActualizacion)} className="px-2 py-1 rounded-lg border border-sky-300 bg-white hover:bg-sky-100 disabled:opacity-50 font-bold text-sky-800 cursor-pointer whitespace-nowrap">
          {todosSeleccionados ? 'Quitar' : 'Todos'}
        </button>
        <button
          type="button"
          onClick={() => handleEnviarActualizacion('en_produccion')}
          disabled={pedidosSeleccionados.size === 0 || Boolean(enviandoActualizacion) || algunoYaAvanzoMasAlla}
          title={
            algunoYaAvanzoMasAlla
              ? 'Alguno de los seleccionados ya está en una etapa posterior (Listo para retirar o Retirado) — avisar "En producción" ahora lo haría retroceder, y el servidor lo va a rechazar.'
              : todosYaEnProduccion
                ? 'Ya se le había avisado "En producción" a todos los seleccionados — esto manda el aviso de nuevo.'
                : 'Enviar aviso de "En producción" a los seleccionados'
          }
          className="px-2 py-1 rounded-lg bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          {enviandoActualizacion === 'en_produccion' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Printer className="w-3 h-3" />} {todosYaEnProduccion ? 'Reenviar "En producción"' : 'En producción'}
        </button>
        <button
          type="button"
          onClick={() => handleEnviarActualizacion('listo_retiro')}
          disabled={pedidosSeleccionados.size === 0 || Boolean(enviandoActualizacion) || algunoSinProduccion}
          title={
            algunoSinProduccion
              ? 'Alguno de los seleccionados todavía no pasó por "En producción" — avisale primero, o destildalo para no bloquear al resto.'
              : todosYaListoRetiro
                ? 'Ya se le había avisado "Listo para retirar" a todos los seleccionados — esto manda el aviso de nuevo.'
                : 'Enviar aviso de "Listo para retirar" a los seleccionados'
          }
          className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-bold flex items-center gap-1 cursor-pointer whitespace-nowrap"
        >
          {enviandoActualizacion === 'listo_retiro' ? <RefreshCw className="w-3 h-3 animate-spin" /> : <CheckCircle2 className="w-3 h-3" />} {todosYaListoRetiro ? 'Reenviar "Listo p/retirar"' : 'Listo p/retirar'}
        </button>
      </div>

      {/* Auditoría 2026-09-20: antes nada explicaba por qué convenía frenar acá — ahora el
          aviso queda visible en vez de que el fotógrafo sólo vea el botón gris. Se mantienen
          como alertas propias (no entran en la fila compacta de arriba) porque son advertencias
          funcionales, no controles. */}
      {algunoSinProduccion && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          No podés avisar "Listo para retirar" a alguno de los seleccionados porque todavía no pasó por "En producción". Primero enviá ese aviso, o quitalo de la selección.
        </p>
      )}
      {algunoYaAvanzoMasAlla && (
        <p className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 flex items-center gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          No podés avisar "En producción" a alguno de los seleccionados porque ya está en una etapa posterior. Quitalo de la selección si sólo querés avisarle a los demás.
        </p>
      )}

      {/* Orders & Lab Files — tarjetas para celular (auditoría 2026-09-21, ver
          TarjetaPedidoLaboratorio más arriba), tabla completa para escritorio. Misma data, mismos
          handlers — sólo cambia cómo se presentan según el ancho de pantalla. */}
      <div className="sm:hidden space-y-3">
        {pedidosFiltrados.length === 0 ? (
          <div className="py-10 text-center text-slate-400 space-y-2 bg-white rounded-2xl border border-slate-200">
            <AlertCircle className="w-6 h-6 mx-auto text-slate-300" />
            <p className="text-xs">No se encontraron pedidos con los filtros aplicados.</p>
          </div>
        ) : (
          pedidosFiltrados.map((pedido) => (
            <div key={pedido.id}>
              <TarjetaPedidoLaboratorio
                pedido={pedido}
                seleccionado={pedidosSeleccionados.has(pedido.id)}
                seleccionable={Boolean(pedido.tutorEmail?.includes('@'))}
                bloqueadoPorEnvio={Boolean(enviandoActualizacion)}
                marcandoRetirado={marcandoRetiradoId === pedido.id}
                modoEstructuraCarpetas={modoEstructuraCarpetas}
                onToggleSeleccion={() => alternarSeleccionPedido(pedido.id)}
                onDescargarZip={() => handleDescargarZipAlumno(pedido)}
                onReenviarEmail={() => handleReenviarEmailHD(pedido)}
                onAbrirQr={() => handleAbrirQr(pedido)}
                onMarcarRetirado={() => handleMarcarRetirado(pedido)}
              />
            </div>
          ))
        )}
      </div>

      <div className="hidden sm:block bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-xs">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 text-slate-500 uppercase font-semibold border-b border-slate-200 text-[10px] tracking-wider">
              <tr>
                <th className="py-3 px-3 w-12 text-center"><input type="checkbox" checked={todosSeleccionados} onChange={alternarSeleccionTodos} disabled={pedidosFiltradosConEmail.length === 0} aria-label="Seleccionar todos los clientes visibles" className="w-4 h-4 accent-sky-600 cursor-pointer" /></th>
                <th className="py-3 px-3 w-12 text-center">N°</th>
                <th className="py-3 px-4">Alumno & Código Escolar</th>
                <th className="py-3 px-4">Curso & Turno</th>
                <th className="py-3 px-4">Etapa del Pedido</th>
                <th className="py-3 px-4">Archivos Asignados para Minilab</th>
                <th className="py-3 px-4">Entrega HD por Email</th>
                <th className="py-3 px-4 text-center">Acciones</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {pedidosFiltrados.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-10 text-center text-slate-400 space-y-2">
                    <AlertCircle className="w-6 h-6 mx-auto text-slate-300" />
                    <p className="text-xs">No se encontraron pedidos con los filtros aplicados.</p>
                  </td>
                </tr>
              ) : (
                pedidosFiltrados.map((pedido) => {
                  return (
                    <tr key={pedido.id} className={`hover:bg-slate-50/80 transition-colors ${pedidosSeleccionados.has(pedido.id) ? 'bg-sky-50/70' : ''}`}>
                      <td className="py-3.5 px-3 text-center"><input type="checkbox" checked={pedidosSeleccionados.has(pedido.id)} onChange={() => alternarSeleccionPedido(pedido.id)} disabled={!pedido.tutorEmail?.includes('@') || Boolean(enviandoActualizacion)} aria-label={`Seleccionar a ${pedido.alumnoNombre}`} title={pedido.tutorEmail?.includes('@') ? 'Seleccionar cliente' : 'Este pedido no tiene un email válido'} className="w-4 h-4 accent-sky-600 cursor-pointer disabled:cursor-not-allowed" /></td>
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

                      {/* Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo):
                          línea de tiempo única en vez de fichas sueltas — ver LineaDeTiempoPedido
                          más arriba en el archivo. Acá también vive la acción que faltaba: marcar
                          que la familia ya retiró el pedido (antes esa etapa no tenía botón). */}
                      <td className="py-3.5 px-4">
                        <LineaDeTiempoPedido pedido={pedido} />
                        {pedido.estadoLab === 'listo_retiro' && (
                          <button
                            type="button"
                            onClick={() => handleMarcarRetirado(pedido)}
                            disabled={marcandoRetiradoId === pedido.id}
                            className="mt-1.5 px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 disabled:opacity-50 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer"
                          >
                            {marcandoRetiradoId === pedido.id ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                            Marcar retirado
                          </button>
                        )}
                      </td>

                      {/* Photo files renamed for minilab */}
                      <td className="py-3.5 px-4">
                        <div className="space-y-1 max-w-md">
                          {pedido.archivosParaLaboratorio.map((archivo) => {
                            return (
                              <div
                                key={archivo.id}
                                className={`w-full text-left p-1.5 rounded-lg border text-[11px] font-mono flex items-center justify-between gap-2 ${
                                  archivo.sinFotoReal
                                    ? 'bg-red-50 border-red-300 text-red-900 font-bold'
                                    : 'bg-slate-50 border-slate-200 text-slate-700'
                                }`}
                                title={archivo.sinFotoReal ? 'Falta la foto real elegida por la familia — revisar a mano' : undefined}
                              >
                                <div className="flex items-center gap-1.5 truncate">
                                  {/* Miniatura real de la foto — para poder confirmar de un vistazo
                                      qué foto exacta se va a imprimir en cada archivo, sin tener
                                      que abrir nada (pedido de Pablo, 15/9). */}
                                  {archivo.sinFotoReal || !archivo.urlMuestra ? (
                                    <div className="w-6 h-6 rounded border border-red-300 bg-red-100 flex items-center justify-center shrink-0">
                                      <AlertTriangle className="w-3.5 h-3.5 text-red-500" />
                                    </div>
                                  ) : (
                                    <img
                                      src={archivo.urlMuestra}
                                      alt=""
                                      className="w-6 h-6 rounded object-cover border border-slate-200 shrink-0 bg-white"
                                    />
                                  )}
                                  <span className="truncate">
                                    {modoEstructuraCarpetas === 'solo_2_carpetas_tamano' ? (
                                      <>
                                        <span className={archivo.sinFotoReal ? 'font-semibold' : 'text-amber-700 font-semibold'}>{archivo.tamanoImpresion}/</span>
                                        <span>{archivo.nombreArchivoLab}</span>
                                      </>
                                    ) : (
                                      <span>{archivo.nombreArchivoLab}</span>
                                    )}
                                  </span>
                                </div>
                                <div className="flex items-center gap-1 shrink-0">
                                  {archivo.sinFotoReal && (
                                    <span className="text-[9px] uppercase font-extrabold bg-red-600 text-white px-1.5 py-0.5 rounded shadow-2xs">
                                      Falta foto
                                    </span>
                                  )}
                                  {archivo.esCopiaExtra && (
                                    <span className="text-[9px] uppercase font-extrabold bg-amber-400 text-slate-950 px-1.5 py-0.5 rounded shadow-2xs">
                                      COPIA {archivo.numeroCopia || 2}
                                    </span>
                                  )}
                                  <span className="text-[10px] uppercase font-bold text-slate-500 bg-white px-1.5 py-0.5 rounded border border-slate-200">
                                    {archivo.tamanoImpresion}
                                  </span>
                                </div>
                              </div>
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
                          {/* Auditoría 2026-09-20 (bug real reportado por Pablo: "no le llega el
                              enlace de descarga de fotos HD al cliente"). Causa raíz: cuando el
                              .zip HD no se pudo armar a tiempo del pago, el correo automático sale
                              igual pero con el texto de "en breve" en vez del link — y antes esto
                              se veía IGUAL que "HD Enviado" (sólo miraba emailEnviado). Ahora se
                              distingue de un vistazo: enviado con link real, enviado sin link
                              (requiere acción), o directamente pendiente. */}
                          {pedido.emailEnviado && pedido.linkDescargaHD ? (
                            <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                              <Check className="w-3 h-3 text-emerald-600" />
                              HD Enviado ({pedido.fechaEnvioEmail ? pedido.fechaEnvioEmail.split(' ')[0] : 'OK'})
                            </span>
                          ) : pedido.emailEnviado && !pedido.linkDescargaHD ? (
                            <span
                              className="inline-flex items-center gap-1 text-[10px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full border border-red-200"
                              title='El correo salió, pero sin el .zip real — al cliente le llegó el texto "en breve te enviaremos el enlace" y ahí se cortó. Usá "Reenviar enlace Ultra HD" para generar el .zip y mandarlo de verdad.'
                            >
                              <AlertTriangle className="w-3 h-3 text-red-600" />
                              Falta el .zip HD
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

                          <button
                            onClick={() => handleAbrirQr(pedido)}
                            disabled={!pedido.supabaseId}
                            className="p-1.5 bg-violet-50 hover:bg-violet-100 disabled:opacity-40 text-violet-700 rounded-lg transition-colors cursor-pointer"
                            title="Ver / descargar el QR para pegar en el sobre del laboratorio"
                          >
                            <QrCode className="w-4 h-4" />
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

      {/* Auditoría 2026-09-21: lightbox del QR de un pedido puntual — se pega impreso en el sobre
          físico del laboratorio; al escanearlo con la cámara del celular abre el pedido en
          /?escaneo=<id> (ver EscaneoPedidoModal en App.tsx) para avisar "Listo para retirar" o
          "Marcar retirado" sin tener que buscarlo a mano en este panel. */}
      {qrPedido && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={handleCerrarQr}>
          <div className="bg-white rounded-2xl p-6 max-w-xs w-full text-center" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <p className="font-bold text-slate-900 text-sm truncate">{qrPedido.alumnoNombre}</p>
              <button type="button" onClick={handleCerrarQr} className="text-slate-400 hover:text-slate-700 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[11px] text-slate-500 mb-3">{qrPedido.codigoAlumno}</p>
            {qrError ? (
              <p className="text-sm text-red-600">{qrError}</p>
            ) : qrBlobUrl ? (
              <>
                <img src={qrBlobUrl} alt={`QR del pedido de ${qrPedido.alumnoNombre}`} className="w-full aspect-square rounded-xl border border-slate-200" />
                <a
                  href={qrBlobUrl}
                  download={`QR_${qrPedido.codigoAlumno || qrPedido.id}.png`}
                  className="mt-3 inline-flex items-center justify-center gap-1.5 w-full px-3 py-2 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-bold cursor-pointer"
                >
                  <Download className="w-3.5 h-3.5" /> Descargar para imprimir
                </a>
                <p className="text-[10px] text-slate-400 mt-2">Pegalo en el sobre — al escanearlo te va a pedir tu PIN de admin la primera vez.</p>
              </>
            ) : (
              <div className="py-10 flex items-center justify-center">
                <RefreshCw className="w-6 h-6 text-slate-300 animate-spin" />
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
