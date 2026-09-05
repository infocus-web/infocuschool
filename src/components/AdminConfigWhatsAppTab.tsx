import React, { useState, useEffect } from 'react';
import {
  MessageCircle, Check, Copy, Save, Phone, ShieldCheck,
  AlertCircle, ExternalLink, Database, RefreshCw, Sparkles, CheckCircle2,
  Building2, School
} from 'lucide-react';
import {
  useWhatsAppConfig,
  sanitizarNumeroWhatsApp,
  formatearNumeroVisual,
  getScriptSqlSupabase
} from '../services/configuracionService';
import { useColegiosLista, actualizarWhatsappColegio } from '../services/colegiosService';
import { getSupabase, getSupabaseConfig } from '../services/supabaseClient';

export default function AdminConfigWhatsAppTab() {
  const { config, actualizarConfig, cargando, estadoGuardado, limpiarEstadoGuardado } = useWhatsAppConfig();
  const { colegios, recargarColegios } = useColegiosLista();

  // Local form state
  const [numeroInput, setNumeroInput] = useState(config.whatsappSolicitudCodigo);
  const [nombreContactoInput, setNombreContactoInput] = useState(config.nombreContacto);
  const [mensajePredeterminadoInput, setMensajePredeterminadoInput] = useState(config.mensajePredeterminado);
  const [copiadoSql, setCopiadoSql] = useState(false);
  const [mostrarSql, setMostrarSql] = useState(false);
  const [alertaExito, setAlertaExito] = useState<string | null>(null);

  // Per-school WhatsApp state
  const [colegioSeleccionadoId, setColegioSeleccionadoId] = useState<string>('');
  const [colegioWhatsappInput, setColegioWhatsappInput] = useState<string>('');

  useEffect(() => {
    setNumeroInput(config.whatsappSolicitudCodigo);
    setNombreContactoInput(config.nombreContacto);
    setMensajePredeterminadoInput(config.mensajePredeterminado);
  }, [config]);

  useEffect(() => {
    if (colegios.length > 0 && !colegioSeleccionadoId) {
      setColegioSeleccionadoId(colegios[0].id);
      setColegioWhatsappInput(colegios[0].whatsappContacto || '');
    }
  }, [colegios]);

  const handleColegioChange = (id: string) => {
    setColegioSeleccionadoId(id);
    const col = colegios.find(c => c.id === id);
    setColegioWhatsappInput(col?.whatsappContacto || '');
  };

  const handleGuardarColegioWhatsapp = (e: React.FormEvent) => {
    e.preventDefault();
    if (!colegioSeleccionadoId) return;

    actualizarWhatsappColegio(colegioSeleccionadoId, colegioWhatsappInput);
    recargarColegios();
    const col = colegios.find(c => c.id === colegioSeleccionadoId);
    setAlertaExito(`WhatsApp específico actualizado para "${col?.nombre || 'Colegio'}".`);
    setTimeout(() => setAlertaExito(null), 4000);
  };

  const numeroSanitizado = sanitizarNumeroWhatsApp(numeroInput);
  const enlacePrueba = `https://wa.me/${numeroSanitizado}?text=${encodeURIComponent(
    'Hola, me comunico para solicitar el código de curso para ver las fotos escolares en el portal.'
  )}`;

  const handleGuardarGeneral = async (e: React.FormEvent) => {
    e.preventDefault();
    limpiarEstadoGuardado();

    const res = await actualizarConfig({
      whatsappSolicitudCodigo: numeroInput,
      nombreContacto: nombreContactoInput.trim() || 'Atención de Códigos',
      mensajePredeterminado: mensajePredeterminadoInput.trim(),
    });

    setAlertaExito('¡Número de WhatsApp guardado con éxito! Las familias ya verán este destino de contacto al solicitar el código.');
    setTimeout(() => setAlertaExito(null), 5000);
  };

  const handleCopiarSql = () => {
    navigator.clipboard.writeText(getScriptSqlSupabase());
    setCopiadoSql(true);
    setTimeout(() => setCopiadoSql(false), 3000);
  };

  const supabaseConfig = getSupabaseConfig();
  const tieneSupabase = !!supabaseConfig.anonKey && supabaseConfig.anonKey !== '';

  return (
    <div className="space-y-8 text-left max-w-5xl mx-auto pb-10">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-emerald-900 via-teal-900 to-slate-900 rounded-3xl p-6 sm:p-8 text-white shadow-xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-80 h-80 bg-emerald-500/10 rounded-full blur-3xl pointer-events-none" />
        <div className="relative z-10 space-y-3">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/20 border border-emerald-400/30 text-emerald-300 text-xs font-bold uppercase tracking-wider">
            <MessageCircle className="w-3.5 h-3.5" />
            <span>Configuración de Contacto & WhatsApp</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white font-['Outfit'] tracking-tight">
            WhatsApp para Solicitud de Código de Curso
          </h2>
          <p className="text-sm text-emerald-100/90 max-w-2xl leading-relaxed">
            Podés cambiar este número todas las veces que quieras. Cuando las familias hagan clic en{' '}
            <strong className="text-white bg-emerald-800/60 px-1.5 py-0.5 rounded">"Solicitar Código por WhatsApp"</strong>{' '}
            en el portal, se abrirá el chat directamente con el número que configures acá (de la escuela, secretaría o soporte).
          </p>
        </div>
      </div>

      {alertaExito && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl flex items-center gap-3 text-emerald-900 animate-in fade-in duration-200">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="text-xs font-bold">{alertaExito}</p>
        </div>
      )}

      {/* Main Grid: Form & Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Form Settings */}
        <div className="lg:col-span-7 bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-xs space-y-6">
          <div className="flex items-center justify-between border-b border-slate-100 pb-4">
            <div>
              <h3 className="text-base font-bold text-slate-900">Número de WhatsApp Principal</h3>
              <p className="text-xs text-slate-500">Aplica por defecto a todas las instituciones y solicitudes de código.</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-amber-100 text-amber-900">
              Editable en cualquier momento
            </span>
          </div>

          <form onSubmit={handleGuardarGeneral} className="space-y-5">
            {/* Phone input */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                <span>Número de WhatsApp de Destino *</span>
                <span className="text-[11px] text-slate-400 font-normal">
                  (Podés poner el del colegio, secretaría o el tuyo)
                </span>
              </label>
              <div className="relative">
                <div className="absolute left-3.5 top-3 flex items-center gap-1 text-slate-400">
                  <Phone className="w-4 h-4 text-emerald-600" />
                </div>
                <input
                  type="text"
                  required
                  value={numeroInput}
                  onChange={(e) => setNumeroInput(e.target.value)}
                  placeholder="Ej: 5491128625916 o 11 2862-5916"
                  className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 focus:border-emerald-500 bg-slate-50/50"
                />
              </div>
              <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                <span>
                  Formato internacional procesado:{' '}
                  <strong className="text-emerald-700 font-mono font-bold">
                    {numeroSanitizado ? formatearNumeroVisual(numeroSanitizado) : 'Ingresá un número'}
                  </strong>
                </span>
                {numeroSanitizado && (
                  <span className="text-slate-400 font-mono">wa.me/{numeroSanitizado}</span>
                )}
              </div>
            </div>

            {/* Name/entity label */}
            <div className="space-y-1.5">
              <label className="text-xs font-bold text-slate-700">
                Nombre o Identificación de la Persona/Área que recibe
              </label>
              <input
                type="text"
                value={nombreContactoInput}
                onChange={(e) => setNombreContactoInput(e.target.value)}
                placeholder="Ej: Secretaría Escolar / Atención de Familias"
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
              />
            </div>

            {/* Action buttons */}
            <div className="pt-3 border-t border-slate-100 flex flex-col sm:flex-row items-center gap-3">
              <button
                type="submit"
                disabled={cargando || !numeroSanitizado}
                className="w-full sm:flex-1 py-3 px-5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
              >
                <Save className="w-4 h-4" />
                <span>{cargando ? 'Guardando cambios...' : 'Guardar y Aplicar Número'}</span>
              </button>

              <a
                href={enlacePrueba}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full sm:w-auto px-4 py-3 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
                title="Abre WhatsApp en una nueva pestaña para comprobar que el número funcione"
              >
                <ExternalLink className="w-3.5 h-3.5 text-emerald-400" />
                <span>Probar Enlace</span>
              </a>
            </div>

            {/* Status indicators */}
            <div className="pt-2">
              <div className="p-3 bg-slate-50 rounded-xl border border-slate-200 text-xs space-y-1.5">
                <div className="flex items-center gap-2 text-emerald-700 font-bold">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span>Activo al instante para las familias</span>
                </div>
                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Cualquier familia que ingrese al portal desde este dispositivo verá y enviará mensajes al número{' '}
                  <strong className="text-slate-800 font-mono">
                    {formatearNumeroVisual(config.whatsappSolicitudCodigo)}
                  </strong>
                  .
                </p>
                {config.guardadoEnSupabase ? (
                  <div className="flex items-center gap-1.5 text-sky-700 text-[11px] font-semibold pt-1">
                    <Database className="w-3.5 h-3.5 text-sky-600" />
                    <span>Sincronizado también en la nube de Supabase (tabla configuracion).</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-1.5 text-slate-500 text-[11px] pt-1">
                    <Database className="w-3.5 h-3.5 text-slate-400" />
                    <span>Almacenado localmente. Para sincronizarlo entre múltiples dispositivos en la nube, revisá la sección de Supabase abajo.</span>
                  </div>
                )}
              </div>
            </div>
          </form>
        </div>

        {/* Right Column: Live Simulator of what Parents see */}
        <div className="lg:col-span-5 space-y-6">
          {/* Card: Exact Parents Portal Simulation */}
          <div className="bg-amber-50/70 border border-amber-300/80 rounded-3xl p-6 shadow-xs text-left space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-amber-800 bg-amber-200/80 px-2 py-0.5 rounded-full">
                Vista previa en vivo para familias
              </span>
              <Sparkles className="w-4 h-4 text-amber-600" />
            </div>

            <div className="p-4 bg-white/90 backdrop-blur-xs rounded-2xl border border-amber-200 shadow-xs space-y-3">
              <div className="space-y-0.5">
                <p className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                  <MessageCircle className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>¿Aún no tenés tu Código de Curso?</span>
                </p>
                <p className="text-[11px] text-slate-600 leading-relaxed">
                  Al momento de inscribirte, contactate por WhatsApp con la institución educativa para solicitar el código con el que podrás acceder a ver las fotos.
                </p>
              </div>

              <a
                href={enlacePrueba}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full px-4 py-2.5 bg-[#25D366] hover:bg-[#20ba5a] text-white font-extrabold text-xs rounded-xl shadow-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <MessageCircle className="w-4 h-4 fill-white" />
                <span>Solicitar Código por WhatsApp</span>
              </a>
            </div>

            <div className="text-[11px] text-amber-900/80 space-y-1">
              <p className="font-semibold">Cuando el padre hace clic:</p>
              <ul className="list-disc pl-4 space-y-0.5 text-[10px]">
                <li>Abre el chat de WhatsApp con: <span className="font-mono font-bold text-slate-900">+{numeroSanitizado || '...'}</span></li>
                <li>Escribe automáticamente un mensaje educado solicitando el código con el nombre y sala de su hijo.</li>
              </ul>
            </div>
          </div>

          {/* Card: Specific WhatsApp per School */}
          <div className="bg-white rounded-3xl p-6 border border-slate-200 shadow-xs space-y-4 text-left">
            <div className="flex items-center gap-2">
              <School className="w-4 h-4 text-amber-600" />
              <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider">
                WhatsApp específico por Colegio (Opcional)
              </h4>
            </div>
            <p className="text-[11px] text-slate-500 leading-relaxed">
              Si trabajás con varias escuelas y cada una tiene su propio teléfono de secretaría o preceptora, podés asignárselo individualmente:
            </p>

            <form onSubmit={handleGuardarColegioWhatsapp} className="space-y-3">
              <select
                value={colegioSeleccionadoId}
                onChange={(e) => handleColegioChange(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50 font-medium"
              >
                {colegios.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.nombre} {c.whatsappContacto ? `(WhatsApp: ${c.whatsappContacto})` : '(Usa número general)'}
                  </option>
                ))}
              </select>

              <div className="space-y-1">
                <input
                  type="text"
                  value={colegioWhatsappInput}
                  onChange={(e) => setColegioWhatsappInput(e.target.value)}
                  placeholder="Ej: 54911xxxxxxxx (vacío para usar el general)"
                  className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 font-mono"
                />
                <p className="text-[10px] text-slate-400">Dejalo vacío si querés que use el número principal.</p>
              </div>

              <button
                type="submit"
                className="w-full py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs rounded-xl transition-colors cursor-pointer"
              >
                Guardar para este Colegio
              </button>
            </form>
          </div>
        </div>
      </div>

      {/* Supabase Technical Details & FAQ Section */}
      <div className="bg-slate-50 rounded-3xl p-6 sm:p-8 border border-slate-200 text-left space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 text-emerald-800 flex items-center justify-center font-bold">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900">
                Persistencia en Supabase & Limitaciones Técnicas
              </h3>
              <p className="text-xs text-slate-500">
                Cómo se almacena este dato y qué opciones tenés para guardarlo en la nube.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMostrarSql(!mostrarSql)}
            className="px-3 py-1.5 bg-white hover:bg-slate-100 text-slate-700 text-xs font-bold rounded-xl border border-slate-300 flex items-center gap-1.5 cursor-pointer self-start sm:self-auto"
          >
            <span>{mostrarSql ? 'Ocultar SQL' : 'Ver Script SQL para Supabase'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs">
          <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              ¿Cuáles son las limitaciones con Supabase?
            </h4>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              En Supabase, almacenar datos públicos (como un teléfono de contacto al que los padres deben acceder sin iniciar sesión) requiere que la tabla en PostgreSQL tenga habilitadas las políticas de seguridad <strong>Row-Level Security (RLS)</strong> para lectura anónima (<code className="bg-slate-100 px-1 rounded">select using (true)</code>).
            </p>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              Si la tabla aún no existe o RLS está bloqueado, el sistema automáticamente usa el <strong>almacenamiento local seguro</strong> para que nunca te quedes sin servicio ni te bloquee el trabajo.
            </p>
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-sky-600" />
              ¿Cuántas veces puedo cambiar el número?
            </h4>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              <strong>Las veces que quieras, sin ningún límite ni restricción.</strong> Cada vez que ingresás a este panel y guardás un nuevo número, se actualiza en el momento tanto en tu navegador como en Supabase si tenés la tabla configurada.
            </p>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              Podés poner el de la secretaría de un colegio hoy, el de otra escuela mañana, o tu número de soporte personal cuando estés de guardia.
            </p>
          </div>
        </div>

        {mostrarSql && (
          <div className="p-5 bg-slate-900 text-slate-100 rounded-2xl space-y-3 animate-in fade-in duration-200">
            <div className="flex items-center justify-between">
              <span className="text-xs font-mono font-bold text-emerald-400">
                SQL Editor de Supabase (Opcional para persistencia multi-dispositivo)
              </span>
              <button
                type="button"
                onClick={handleCopiarSql}
                className="px-3 py-1 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold rounded-lg flex items-center gap-1.5 cursor-pointer"
              >
                {copiadoSql ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{copiadoSql ? '¡Copiado!' : 'Copiar SQL'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-300">
              Si querés que el número se sincronice automáticamente en cualquier computadora o celular que abras en Supabase, pegá estas 10 líneas en el <em>SQL Editor</em> de tu proyecto en Supabase:
            </p>
            <pre className="p-3 bg-slate-950 rounded-xl text-[11px] font-mono text-emerald-300 overflow-x-auto border border-slate-800 leading-relaxed">
              {getScriptSqlSupabase()}
            </pre>
          </div>
        )}
      </div>
    </div>
  );
}
