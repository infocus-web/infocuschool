import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle, CheckCircle2, ExternalLink, Loader2, LogOut, Mail, RefreshCw, Send, Sparkles, Upload,
} from 'lucide-react';
import {
  DestinatarioCampana,
  EnvioZoho,
  EstadoZoho,
  desconectarZoho,
  mandarCampanaRealZoho,
  mandarCorreoPruebaZoho,
  obtenerEstadoZoho,
  obtenerHistorialZoho,
  obtenerUrlConexionZoho,
  parsearCsvDestinatarios,
} from '../services/zohoCampanaService';

const ASUNTO_INICIAL = 'Una propuesta pensada especialmente para {{institucion}} — Ciclo 2026';
const CUERPO_INICIAL = `Hola equipo de {{institucion}}:

Mi nombre es Pablo Alderete, de Retrato Escolar (Productora Infocus). Nos dedicamos a la cobertura fotográfica escolar y nos encantaría sumar a {{institucion}} a las instituciones con las que trabajamos en la Zona Norte durante el ciclo lectivo 2026.

Sabemos lo que significa para una familia tener esas fotos que después quedan para siempre — el primer día, el acto, la salida — y por eso ponemos mucho cuidado en que todo el proceso sea simple tanto para el colegio como para cada familia.

COBERTURA ESCOLAR 2026

• Cobertura fotográfica profesional, con fotógrafos con experiencia en el ámbito escolar.
• Coordinación flexible, adaptada a los tiempos y actividades de cada institución.
• Todo el proceso organizado de punta a punta, sin que el colegio tenga que ocuparse de la logística.
• Un canal directo de atención tanto para el colegio como para las familias.

Nos encantaría mostrarles con más detalle cómo trabajamos — acá pueden ver ejemplos y la propuesta completa:
https://www.retratoescolar.com.ar/cobertura-2026.html

Si les interesa, coordinamos una charla breve, cuando les quede cómodo, para contarles cómo podemos adaptar la cobertura a {{institucion}} y responder cualquier duda.

¡Esperamos poder acompañarlos este ciclo lectivo!

Saludos,

Pablo Alderete
Retrato Escolar | Productora Infocus
https://www.retratoescolar.com.ar/`;

export default function AdminZohoCampanaTab() {
  const [estado, setEstado] = useState<EstadoZoho | null>(null);
  const [cargandoEstado, setCargandoEstado] = useState(true);
  const [conectando, setConectando] = useState(false);
  const [desconectando, setDesconectando] = useState(false);
  const [error, setError] = useState('');

  const [remitente, setRemitente] = useState('');
  const [asunto, setAsunto] = useState(ASUNTO_INICIAL);
  const [cuerpoHtml, setCuerpoHtml] = useState(CUERPO_INICIAL);
  const [csvTexto, setCsvTexto] = useState('');
  const [previewIndex, setPreviewIndex] = useState(0);

  const [emailPrueba, setEmailPrueba] = useState('');
  const [enviandoPrueba, setEnviandoPrueba] = useState(false);
  const [pruebaOk, setPruebaOk] = useState(false);
  const [mensajePrueba, setMensajePrueba] = useState<{ tipo: 'ok' | 'error'; texto: string } | null>(null);

  const [confirmarEnvioReal, setConfirmarEnvioReal] = useState(false);
  const [enviandoReal, setEnviandoReal] = useState(false);
  const [progreso, setProgreso] = useState<{ procesados: number; total: number } | null>(null);
  const [resultadosReales, setResultadosReales] = useState<{ enviados: number; errores: number; omitidos: number; detalle: string[] } | null>(null);

  const [historial, setHistorial] = useState<EnvioZoho[]>([]);
  const [mostrarHistorial, setMostrarHistorial] = useState(false);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const cargarEstado = useCallback(async () => {
    setCargandoEstado(true);
    const data = await obtenerEstadoZoho();
    setEstado(data);
    if (data.remitentesPermitidos.length > 0) {
      setRemitente((actual) => actual || data.remitentesPermitidos[0]);
    }
    setCargandoEstado(false);
  }, []);

  useEffect(() => { void cargarEstado(); }, [cargarEstado]);

  const destinatarios = useMemo<DestinatarioCampana[]>(() => parsearCsvDestinatarios(csvTexto), [csvTexto]);

  // Cualquier cambio a la plantilla o a la lista invalida la prueba anterior — no queremos que
  // Pablo pruebe un texto y termine mandando otro distinto sin volver a probarlo.
  useEffect(() => { setPruebaOk(false); setConfirmarEnvioReal(false); }, [asunto, cuerpoHtml, remitente]);

  const conectar = async () => {
    setConectando(true);
    setError('');
    const res = await obtenerUrlConexionZoho();
    if (res.success && res.url) {
      window.location.href = res.url;
    } else {
      setError(res.error || 'No se pudo iniciar la conexión con Zoho.');
      setConectando(false);
    }
  };

  const desconectar = async () => {
    if (!confirm('¿Desconectar la cuenta de Zoho? Vas a tener que volver a autorizarla para mandar más correos.')) return;
    setDesconectando(true);
    const res = await desconectarZoho();
    if (res.success) await cargarEstado();
    else setError(res.error || 'No se pudo desconectar.');
    setDesconectando(false);
  };

  const cargarHistorial = async () => {
    setCargandoHistorial(true);
    setHistorial(await obtenerHistorialZoho());
    setCargandoHistorial(false);
  };

  const previewDestinatario = destinatarios[previewIndex] || destinatarios[0];
  const personalizar = (texto: string, d?: DestinatarioCampana) =>
    !d ? texto : texto
      .replace(/\{\{\s*institucion\s*\}\}/gi, d.institucion || '')
      .replace(/\{\{\s*localidad_partido\s*\}\}/gi, d.localidad_partido || '')
      .replace(/\{\{\s*nivel\s*\}\}/gi, d.nivel || '');

  const handleArchivoCsv = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => setCsvTexto(String(reader.result || ''));
    reader.readAsText(file, 'utf-8');
  };

  const mandarPrueba = async () => {
    setMensajePrueba(null);
    if (!emailPrueba.trim()) {
      setMensajePrueba({ tipo: 'error', texto: 'Escribí tu propio email para recibir la prueba.' });
      return;
    }
    setEnviandoPrueba(true);
    const res = await mandarCorreoPruebaZoho({
      destinatarioEjemplo: previewDestinatario || {},
      asunto,
      cuerpoHtml,
      remitente,
      emailPrueba: emailPrueba.trim(),
    });
    setEnviandoPrueba(false);
    if (res.success) {
      setPruebaOk(true);
      setMensajePrueba({ tipo: 'ok', texto: `Prueba enviada a ${emailPrueba.trim()} — revisá tu bandeja (y spam) antes de mandar la campaña real.` });
    } else {
      setPruebaOk(false);
      setMensajePrueba({ tipo: 'error', texto: res.error || 'No se pudo mandar la prueba.' });
    }
  };

  const mandarReal = async () => {
    if (!pruebaOk || !confirmarEnvioReal || destinatarios.length === 0) return;
    setEnviandoReal(true);
    setResultadosReales(null);
    setProgreso({ procesados: 0, total: destinatarios.length });
    const res = await mandarCampanaRealZoho(
      { destinatarios, asunto, cuerpoHtml, remitente },
      (procesados, total) => setProgreso({ procesados, total })
    );
    setEnviandoReal(false);
    const enviados = res.resultados.filter((r) => r.estado === 'enviado').length;
    const errores = res.resultados.filter((r) => r.estado === 'error');
    const omitidos = res.resultados.filter((r) => r.estado === 'omitido').length;
    setResultadosReales({
      enviados,
      errores: errores.length,
      omitidos,
      detalle: errores.map((e) => `${e.email}: ${e.error || 'error desconocido'}`),
    });
    if (!res.success) setError(res.error || 'El envío se cortó antes de terminar.');
    setConfirmarEnvioReal(false);
    setPruebaOk(false);
  };

  if (cargandoEstado) {
    return <div className="py-14 text-center text-slate-400"><Loader2 className="w-6 h-6 animate-spin mx-auto" /></div>;
  }

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      <div className="p-4 rounded-2xl border border-violet-200 bg-violet-50 text-violet-950 flex items-start gap-3">
        <Sparkles className="w-5 h-5 text-violet-600 shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-bold">Campaña de prospección a colegios (vía API de Zoho Mail)</p>
          <p className="text-xs text-violet-800 mt-0.5">
            Manda los correos personalizados uno por uno directo desde acá, sin pasar por la interfaz web de Zoho —
            evita el bloqueo de "Mail Merge" que dio error con la cuenta nueva. Siempre exige un correo de prueba
            exitoso antes de habilitar el envío real.
          </p>
        </div>
      </div>

      {error && (
        <p className="p-3 rounded-xl border border-red-200 bg-red-50 text-red-700 text-xs flex items-start gap-2">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />{error}
        </p>
      )}

      {!estado?.zohoConfigurado && (
        <p className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-amber-800 text-xs">
          Faltan las variables ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI en el servidor.
        </p>
      )}

      {estado?.zohoConfigurado && !estado.conectado && (
        <div className="p-6 rounded-2xl border border-dashed border-slate-300 text-center space-y-3">
          <p className="text-sm text-slate-600">Todavía no conectaste una cuenta de Zoho Mail.</p>
          <button
            type="button"
            disabled={conectando}
            onClick={() => void conectar()}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-slate-950 hover:bg-slate-800 text-white rounded-xl text-sm font-bold disabled:opacity-50 cursor-pointer"
          >
            {conectando ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />}
            {conectando ? 'Redirigiendo a Zoho...' : 'Conectar con Zoho'}
          </button>
        </div>
      )}

      {estado?.conectado && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-emerald-200 bg-emerald-50">
            <p className="text-xs font-bold text-emerald-800 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />Conectado como {estado.cuentaEmail || 'cuenta de Zoho'}
            </p>
            <button type="button" disabled={desconectando} onClick={() => void desconectar()} className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-red-600 cursor-pointer disabled:opacity-50">
              {desconectando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <LogOut className="w-3.5 h-3.5" />}Desconectar
            </button>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
              <div>
                <label className="text-xs font-bold text-slate-700">Remitente</label>
                <select value={remitente} onChange={(e) => setRemitente(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs bg-white">
                  {estado.remitentesPermitidos.map((r) => <option key={r} value={r}>{r}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Asunto</label>
                <input value={asunto} onChange={(e) => setAsunto(e.target.value)} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs" />
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Cuerpo del correo</label>
                <textarea value={cuerpoHtml} onChange={(e) => setCuerpoHtml(e.target.value)} rows={12} className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-xs font-mono resize-y" />
                <p className="text-[10px] text-slate-400 mt-1">
                  Variables disponibles: {'{{institucion}}'}, {'{{localidad_partido}}'}, {'{{nivel}}'}. Escribilo como texto
                  normal (párrafos separados por una línea en blanco, viñetas con "• ") — al enviarse se convierte
                  automáticamente a un formato de carta prolijo, no hace falta escribir HTML.
                </p>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-700">Lista de colegios (CSV con columnas To/institucion/localidad_partido/nivel)</label>
                <textarea value={csvTexto} onChange={(e) => setCsvTexto(e.target.value)} rows={5} placeholder='"To","institucion","localidad_partido","nivel"' className="w-full mt-1 px-3 py-2 border border-slate-200 rounded-xl text-[11px] font-mono resize-y" />
                <label className="mt-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold text-sky-700 cursor-pointer hover:text-sky-900">
                  <Upload className="w-3.5 h-3.5" />Subir archivo .csv
                  <input type="file" accept=".csv" className="hidden" onChange={(e) => e.target.files?.[0] && handleArchivoCsv(e.target.files[0])} />
                </label>
                <p className="text-[10px] text-slate-400 mt-1">{destinatarios.length} destinatario(s) detectado(s).</p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="p-3 rounded-xl border border-slate-200 bg-slate-50">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-bold text-slate-700">Vista previa</p>
                  {destinatarios.length > 1 && (
                    <select value={previewIndex} onChange={(e) => setPreviewIndex(Number(e.target.value))} className="text-[11px] border border-slate-200 rounded-lg px-1.5 py-1 bg-white">
                      {destinatarios.map((d, i) => <option key={i} value={i}>{d.institucion || d.email}</option>)}
                    </select>
                  )}
                </div>
                {previewDestinatario ? (
                  <div className="mt-2 text-xs">
                    <p className="font-bold text-slate-800">{personalizar(asunto, previewDestinatario)}</p>
                    <p className="mt-1 text-slate-500">Para: {previewDestinatario.email}</p>
                    <p className="mt-2 whitespace-pre-wrap text-slate-700 max-h-56 overflow-y-auto">{personalizar(cuerpoHtml, previewDestinatario)}</p>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-slate-400">Cargá la lista de colegios para ver la vista previa personalizada.</p>
                )}
              </div>

              <div className="p-3 rounded-xl border border-sky-200 bg-sky-50 space-y-2">
                <p className="text-xs font-bold text-sky-950">Paso 1 — Correo de prueba (obligatorio)</p>
                <div className="flex gap-2">
                  <input type="email" value={emailPrueba} onChange={(e) => setEmailPrueba(e.target.value)} placeholder="tu-email@ejemplo.com" className="flex-1 px-3 py-2 border border-sky-200 rounded-xl text-xs bg-white" />
                  <button type="button" disabled={enviandoPrueba || !asunto.trim() || !cuerpoHtml.trim()} onClick={() => void mandarPrueba()} className="px-3 py-2 bg-sky-600 hover:bg-sky-500 text-white rounded-xl text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer">
                    {enviandoPrueba ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mail className="w-3.5 h-3.5" />}Mandar prueba
                  </button>
                </div>
                {mensajePrueba && (
                  <p className={`text-[11px] font-semibold ${mensajePrueba.tipo === 'ok' ? 'text-emerald-700' : 'text-red-700'}`}>{mensajePrueba.texto}</p>
                )}
              </div>

              <div className={`p-3 rounded-xl border space-y-2 ${pruebaOk ? 'border-amber-300 bg-amber-50' : 'border-slate-200 bg-slate-50 opacity-60'}`}>
                <p className="text-xs font-bold text-amber-950">Paso 2 — Envío real a {destinatarios.length} colegio(s)</p>
                <label className="flex items-start gap-2 text-[11px] text-amber-900">
                  <input type="checkbox" disabled={!pruebaOk} checked={confirmarEnvioReal} onChange={(e) => setConfirmarEnvioReal(e.target.checked)} className="mt-0.5" />
                  Ya revisé el correo de prueba y confirmo que quiero mandar la campaña real a los {destinatarios.length} colegios de la lista.
                </label>
                <button
                  type="button"
                  disabled={!pruebaOk || !confirmarEnvioReal || enviandoReal || destinatarios.length === 0}
                  onClick={() => void mandarReal()}
                  className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2.5 bg-slate-950 hover:bg-slate-800 text-white rounded-xl text-xs font-bold disabled:opacity-40 cursor-pointer"
                >
                  {enviandoReal ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                  {enviandoReal ? `Enviando... (${progreso?.procesados || 0}/${progreso?.total || destinatarios.length})` : `Enviar campaña real a ${destinatarios.length} colegio(s)`}
                </button>
                {!pruebaOk && <p className="text-[10px] text-slate-400">Se habilita después de un correo de prueba exitoso.</p>}
                {resultadosReales && (
                  <div className="text-[11px] mt-1 space-y-1">
                    <p className="font-bold text-emerald-700">{resultadosReales.enviados} enviados · {resultadosReales.omitidos} ya enviados antes (omitidos) · {resultadosReales.errores} con error</p>
                    {resultadosReales.detalle.map((linea, i) => <p key={i} className="text-red-600">{linea}</p>)}
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="pt-2">
            <button type="button" onClick={() => { setMostrarHistorial((v) => !v); if (!mostrarHistorial) void cargarHistorial(); }} className="text-xs font-bold text-slate-500 hover:text-slate-800 inline-flex items-center gap-1.5 cursor-pointer">
              <RefreshCw className={`w-3.5 h-3.5 ${cargandoHistorial ? 'animate-spin' : ''}`} />{mostrarHistorial ? 'Ocultar' : 'Ver'} historial de envíos
            </button>
            {mostrarHistorial && (
              <div className="mt-2 border border-slate-200 rounded-xl divide-y divide-slate-100 max-h-72 overflow-y-auto">
                {historial.length === 0 ? (
                  <p className="p-3 text-xs text-slate-400">Sin envíos registrados todavía.</p>
                ) : historial.map((envio) => (
                  <div key={envio.id} className="p-2.5 text-[11px] flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="font-semibold text-slate-800 truncate">{envio.destinatario_email} {envio.institucion ? `· ${envio.institucion}` : ''}</p>
                      <p className="text-slate-400">{new Date(envio.created_at).toLocaleString('es-AR')} · {envio.tipo === 'prueba' ? 'Prueba' : 'Real'}</p>
                    </div>
                    <span className={`shrink-0 px-2 py-0.5 rounded-full font-bold ${envio.estado === 'enviado' ? 'bg-emerald-100 text-emerald-700' : 'bg-red-100 text-red-700'}`}>
                      {envio.estado === 'enviado' ? 'Enviado' : 'Error'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
