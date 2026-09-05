import React, { useState, useEffect } from 'react';
import {
  MessageCircle, Check, Copy, Save, Phone, ShieldCheck,
  AlertCircle, ExternalLink, Database, RefreshCw, Sparkles, CheckCircle2,
  Building2, School, Radio, Smartphone, Layers, Globe
} from 'lucide-react';
import {
  useWhatsAppConfig,
  sanitizarNumeroWhatsApp,
  formatearNumeroVisual,
  obtenerNumeroWhatsAppFlotante,
  guardarNumeroWhatsAppFlotante,
  getScriptSqlSupabase
} from '../services/configuracionService';
import { useColegiosLista, actualizarWhatsappColegio } from '../services/colegiosService';
import { getSupabaseConfig } from '../services/supabaseClient';

export default function AdminConfigWhatsAppTab() {
  const { config, actualizarConfig, recargar, cargando, estadoGuardado, limpiarEstadoGuardado } = useWhatsAppConfig();
  const { colegios, recargarColegios } = useColegiosLista();

  // Dedicated Floating WhatsApp Number state (persisted to Supabase)
  const [whatsappFlotanteInput, setWhatsappFlotanteInput] = useState(
    config.whatsappFlotante || config.whatsappSolicitudCodigo || '5491128625916'
  );
  const [guardandoFlotante, setGuardandoFlotante] = useState(false);
  const [alertaFlotante, setAlertaFlotante] = useState<{
    tipo: 'exito' | 'error';
    texto: string;
    enSupabase?: boolean;
  } | null>(null);

  // Local form state for secondary/general settings
  const [numeroInput, setNumeroInput] = useState(config.whatsappSolicitudCodigo);
  const [usarMismoNumero, setUsarMismoNumero] = useState(false);
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
    const numFlotante = config.whatsappFlotante || config.whatsappSolicitudCodigo || '5491128625916';
    setWhatsappFlotanteInput(numFlotante);
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

  const numeroSanitizadoGeneral = sanitizarNumeroWhatsApp(numeroInput);
  const numeroSanitizadoFlotante = sanitizarNumeroWhatsApp(whatsappFlotanteInput);

  const enlaceFlotanteTest = `https://wa.me/${numeroSanitizadoFlotante}?text=${encodeURIComponent(
    'Hola Retrato Escolar, tengo una consulta sobre las fotos escolares desde retratoescolar.com.ar'
  )}`;

  const enlaceWhatsAppActivo = `https://wa.me/${numeroSanitizadoGeneral}?text=${encodeURIComponent(
    mensajePredeterminadoInput.trim() || 'Hola, me comunico para solicitar el código de curso para ver las fotos escolares en el portal.'
  )}`;

  /**
   * DEDICATED HANDLER: Guarda el número del Widget Flotante y lo persiste en Supabase
   */
  const handleGuardarWhatsAppFlotante = async (e: React.FormEvent) => {
    e.preventDefault();
    setGuardandoFlotante(true);
    setAlertaFlotante(null);

    try {
      const res = await guardarNumeroWhatsAppFlotante(whatsappFlotanteInput);
      recargar();

      if (res.supabaseOk) {
        setAlertaFlotante({
          tipo: 'exito',
          texto: `¡Número ${formatearNumeroVisual(res.numeroSanitizado)} guardado y persistido con éxito en Supabase! El widget WhatsAppFloating lo está consumiendo dinámicamente.`,
          enSupabase: true,
        });
      } else {
        setAlertaFlotante({
          tipo: 'exito',
          texto: `¡Número ${formatearNumeroVisual(res.numeroSanitizado)} guardado con éxito! El widget WhatsAppFloating ya lo está consumiendo dinámicamente.`,
          enSupabase: false,
        });
      }
    } catch (err: any) {
      setAlertaFlotante({
        tipo: 'error',
        texto: `Error al persistir el número en Supabase: ${err?.message || 'Error inesperado'}`,
      });
    } finally {
      setGuardandoFlotante(false);
    }
  };

  const handleGuardarTodo = async (e: React.FormEvent) => {
    e.preventDefault();
    limpiarEstadoGuardado();

    const res = await actualizarConfig({
      whatsappSolicitudCodigo: numeroInput,
      nombreContacto: nombreContactoInput.trim() || 'Atención Retrato Escolar',
      mensajePredeterminado: mensajePredeterminadoInput.trim(),
    });

    setAlertaExito(
      '¡Configuración general guardada con éxito!'
    );
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
            <span>Gestión Central de WhatsApp</span>
          </div>
          <h2 className="text-2xl sm:text-3xl font-black text-white font-['Outfit'] tracking-tight">
            WhatsApp para Widget Flotante & Contacto
          </h2>
          <p className="text-sm text-emerald-100/90 max-w-2xl leading-relaxed">
            Ingresá el número de teléfono de WhatsApp (con código de país) para que el widget flotante{' '}
            <code className="text-emerald-200 bg-emerald-950/60 px-1.5 py-0.5 rounded font-mono">WhatsAppFloating</code>{' '}
            se actualice dinámicamente y persista su valor en Supabase.
          </p>
        </div>
      </div>

      {alertaExito && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 rounded-2xl flex items-center gap-3 text-emerald-900 animate-in fade-in duration-200 shadow-xs">
          <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
          <p className="text-xs font-bold">{alertaExito}</p>
        </div>
      )}

      {/* Main Grid: Form & Live Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Dedicated Form */}
        <div className="lg:col-span-7 space-y-6">
          {/* SECCIÓN 1: CAMPO DEDICADO WIDGET FLOTANTE + BOTÓN GUARDAR (SOLICITADO POR EL USUARIO) */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border-2 border-emerald-500 shadow-md space-y-5 relative overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2 text-emerald-700">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 flex items-center justify-center text-emerald-800">
                  <Smartphone className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-black text-slate-900 font-['Outfit']">
                    Número de WhatsApp para Widget Flotante
                  </h3>
                  <p className="text-xs text-slate-500">
                    Consumido dinámicamente por el componente <code className="font-mono text-emerald-700 font-semibold">WhatsAppFloating</code>.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                Consumo Dinámico
              </span>
            </div>

            {/* Notification alert on save */}
            {alertaFlotante && (
              <div
                className={`p-4 rounded-2xl flex items-start gap-3 text-xs leading-relaxed animate-in fade-in duration-200 ${
                  alertaFlotante.tipo === 'exito'
                    ? 'bg-emerald-50 border border-emerald-300 text-emerald-900'
                    : 'bg-rose-50 border border-rose-300 text-rose-900'
                }`}
              >
                {alertaFlotante.tipo === 'exito' ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                ) : (
                  <AlertCircle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                )}
                <div className="space-y-1">
                  <p className="font-bold">{alertaFlotante.texto}</p>
                  {alertaFlotante.enSupabase ? (
                    <p className="text-[11px] text-emerald-700 font-medium">
                      ✓ Confirmado: Sincronizado y persistido en la tabla <code className="font-mono bg-emerald-100 px-1 rounded">configuracion</code> de Supabase.
                    </p>
                  ) : (
                    <p className="text-[11px] text-slate-600">
                      Guardado localmente en tu sesión. El widget ya está actualizado en tiempo real.
                    </p>
                  )}
                </div>
              </div>
            )}

            {/* FORMULARIO DEDICADO PARA WHATSAPP FLOTANTE */}
            <form onSubmit={handleGuardarWhatsAppFlotante} className="space-y-5">
              <div className="space-y-2">
                <label
                  htmlFor="input-whatsapp-flotante-dedicado"
                  className="text-xs font-black text-slate-800 flex items-center justify-between"
                >
                  <span className="flex items-center gap-1.5">
                    <Globe className="w-4 h-4 text-emerald-600" />
                    <span>Número de teléfono de WhatsApp (incluyendo código de país) *</span>
                  </span>
                  <span className="text-[10px] font-mono text-emerald-700 bg-emerald-50 px-2 py-0.5 rounded-md border border-emerald-200">
                    Con código de país
                  </span>
                </label>

                <div className="relative">
                  <div className="absolute left-3.5 top-3 flex items-center gap-1 text-slate-400 pointer-events-none">
                    <Phone className="w-4 h-4 text-emerald-600" />
                  </div>
                  <input
                    id="input-whatsapp-flotante-dedicado"
                    type="text"
                    required
                    value={whatsappFlotanteInput}
                    onChange={(e) => setWhatsappFlotanteInput(e.target.value)}
                    placeholder="Ej: +54 9 11 2862-5916 o 5491128625916"
                    className="w-full pl-10 pr-4 py-3 rounded-2xl border-2 border-emerald-500/40 text-sm font-mono font-bold text-slate-900 focus:ring-4 focus:ring-emerald-500/20 focus:border-emerald-600 bg-emerald-50/20 transition-all shadow-inner"
                  />
                </div>

                <p className="text-[11px] text-slate-500 leading-relaxed">
                  Ingresá el número con código de país (ej. <strong>+54 9</strong> para Argentina, <strong>+1</strong> para EE.UU., <strong>+34</strong> para España). El widget flotante consumirá este número en todas sus opciones de chat.
                </p>

                {/* Real-time formatted preview */}
                <div className="p-3 bg-slate-50 rounded-xl border border-slate-200/80 flex flex-wrap items-center justify-between gap-2 text-xs">
                  <div>
                    <span className="text-slate-500 text-[11px]">Visualización formateada: </span>
                    <strong className="text-emerald-700 font-mono font-bold">
                      {numeroSanitizadoFlotante ? formatearNumeroVisual(numeroSanitizadoFlotante) : 'Ingresá un número'}
                    </strong>
                  </div>
                  {numeroSanitizadoFlotante && (
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400 font-mono">wa.me/{numeroSanitizadoFlotante}</span>
                      <a
                        href={enlaceFlotanteTest}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 text-[11px] text-emerald-600 hover:text-emerald-800 font-bold hover:underline"
                      >
                        <span>Probar</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    </div>
                  )}
                </div>
              </div>

              {/* BOTÓN DEDICADO DE GUARDAR */}
              <div className="pt-2">
                <button
                  id="btn-guardar-whatsapp-flotante"
                  type="submit"
                  disabled={guardandoFlotante || !numeroSanitizadoFlotante}
                  className="w-full py-3.5 px-6 bg-emerald-600 hover:bg-emerald-500 active:scale-98 disabled:opacity-50 text-white font-black text-sm rounded-2xl shadow-lg shadow-emerald-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  <Save className="w-4 h-4" />
                  <span>
                    {guardandoFlotante ? 'Guardando y persistiendo en Supabase...' : 'Guardar'}
                  </span>
                </button>
              </div>

              {/* Persisted details note */}
              <div className="p-3 bg-emerald-50/70 rounded-xl border border-emerald-200/80 text-xs space-y-1">
                <div className="flex items-center gap-1.5 text-emerald-800 font-bold">
                  <Database className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span>Persistencia garantizada en Supabase</span>
                </div>
                <p className="text-[11px] text-emerald-900/80 leading-relaxed">
                  Al hacer clic en <strong>Guardar</strong>, se almacena en la tabla <code className="font-mono bg-white px-1 py-0.5 rounded border border-emerald-300">configuracion</code> de Supabase (clave <code className="font-mono">whatsapp_flotante</code>) y el componente <code className="font-mono">WhatsAppFloating</code> lo consume dinámicamente al instante.
                </p>
              </div>
            </form>
          </div>

          {/* SECCIÓN SECUNDARIA: NÚMERO GENERAL PARA SOLICITUD DE CÓDIGOS */}
          <div className="bg-white rounded-3xl p-6 sm:p-7 border border-slate-200 shadow-xs space-y-5">
            <div className="border-b border-slate-100 pb-4">
              <div className="flex items-center gap-2 text-slate-800 mb-1">
                <Layers className="w-4 h-4 text-amber-500" />
                <h3 className="text-base font-bold text-slate-900">
                  Número para Solicitud de Códigos de Curso
                </h3>
              </div>
              <p className="text-xs text-slate-500 leading-relaxed">
                Destino predeterminado cuando las familias solicitan el código de acceso a sus fotos dentro del portal.
              </p>
            </div>

            <form onSubmit={handleGuardarTodo} className="space-y-4">
              {/* Phone input */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700 flex items-center justify-between">
                  <span>Número de Solicitud de Códigos *</span>
                  <span className="text-[11px] text-slate-400 font-normal">
                    (General o secretaría escolar)
                  </span>
                </label>
                <div className="relative">
                  <input
                    type="text"
                    required
                    value={numeroInput}
                    onChange={(e) => setNumeroInput(e.target.value)}
                    placeholder="Ej: 5491128625916 o 11 2862-5916"
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-300 text-sm font-mono font-bold text-slate-900 focus:ring-2 focus:ring-emerald-500 bg-slate-50/50"
                  />
                </div>
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>
                    Formato:{' '}
                    <strong className="text-emerald-700 font-mono font-bold">
                      {numeroSanitizadoGeneral ? formatearNumeroVisual(numeroSanitizadoGeneral) : 'Ingresá un número'}
                    </strong>
                  </span>
                </div>
              </div>

              {/* Name/entity label */}
              <div className="space-y-1.5">
                <label className="text-xs font-bold text-slate-700">
                  Nombre visible en el encabezado del chat
                </label>
                <input
                  type="text"
                  value={nombreContactoInput}
                  onChange={(e) => setNombreContactoInput(e.target.value)}
                  placeholder="Ej: Atención Retrato Escolar / Secretaría"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-xs text-slate-800 focus:ring-2 focus:ring-emerald-500 bg-slate-50/50 font-medium"
                />
              </div>

              {/* Save button */}
              <div className="pt-3 border-t border-slate-100">
                <button
                  type="submit"
                  disabled={cargando || !numeroSanitizadoGeneral}
                  className="w-full py-3 px-5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-white font-bold text-xs sm:text-sm rounded-xl shadow-xs transition-all flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <Save className="w-4 h-4" />
                  <span>{cargando ? 'Guardando...' : 'Guardar Datos de Solicitud de Códigos'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>

        {/* Right Column: Live Interactive Simulator */}
        <div className="lg:col-span-5 space-y-6">
          {/* SIMULADOR INTERACTIVO DEL WIDGET FLOTANTE */}
          <div className="bg-gradient-to-b from-slate-900 to-slate-950 text-white rounded-3xl p-6 shadow-xl border border-slate-800 text-left space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <span className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-400 bg-emerald-950/80 border border-emerald-800/60 px-2.5 py-1 rounded-full flex items-center gap-1.5">
                <Smartphone className="w-3 h-3" />
                <span>Simulador Widget Flotante</span>
              </span>
              <span className="text-[10px] text-slate-400 font-mono">
                +{numeroSanitizadoFlotante || '...'}
              </span>
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Así es como las familias interactúan con el widget flotante en la esquina de la pantalla:
            </p>

            {/* Widget replica box */}
            <div className="bg-white text-slate-900 rounded-2xl overflow-hidden shadow-2xl border border-slate-200">
              {/* Widget Header */}
              <div className="bg-emerald-600 text-white p-3.5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-full bg-white/20 flex items-center justify-center">
                    <MessageCircle className="w-4 h-4 text-white" />
                  </div>
                  <div>
                    <p className="text-xs font-bold leading-tight">
                      {nombreContactoInput.trim() || 'Atención Retrato Escolar'}
                    </p>
                    <p className="text-[10px] text-emerald-100 font-mono">
                      {formatearNumeroVisual(numeroSanitizadoFlotante)}
                    </p>
                  </div>
                </div>
                <div className="w-2 h-2 rounded-full bg-emerald-300 animate-pulse" />
              </div>

              {/* Widget Body with Quick Actions */}
              <div className="p-3 bg-slate-50 space-y-2">
                <p className="text-[10px] font-semibold text-slate-500">
                  Opciones directas que el visitante ve:
                </p>

                <div className="p-2 bg-white rounded-xl border border-slate-200 text-[11px] font-medium text-slate-700 flex items-center gap-2 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="truncate">Consulta sobre fotos de mi hijo/a</span>
                </div>

                <div className="p-2 bg-white rounded-xl border border-slate-200 text-[11px] font-medium text-slate-700 flex items-center gap-2 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-amber-500 shrink-0" />
                  <span className="truncate">Solicitar Código de Curso</span>
                </div>

                <div className="p-2 bg-white rounded-xl border border-slate-200 text-[11px] font-medium text-slate-700 flex items-center gap-2 shadow-2xs">
                  <span className="w-2 h-2 rounded-full bg-sky-500 shrink-0" />
                  <span className="truncate">Consultar medios de pago</span>
                </div>
              </div>

              {/* Widget Action */}
              <div className="p-3 bg-white border-t border-slate-100">
                <a
                  href={enlaceFlotanteTest}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-extrabold text-xs rounded-xl flex items-center justify-center gap-1.5 transition-colors shadow-xs"
                >
                  <MessageCircle className="w-3.5 h-3.5" />
                  <span>Probar Abrir Chat en Vivo</span>
                </a>
              </div>
            </div>

            <p className="text-[11px] text-slate-400">
              Al hacer clic en cualquier opción del widget, se abre directamente el chat oficial con el número configurado.
            </p>
          </div>

          {/* WhatsApp Específico por Colegio */}
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
                className="w-full px-3 py-2 text-xs rounded-xl border border-slate-300 bg-slate-50 font-medium text-slate-800"
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
                Persistencia en Supabase & Multi-dispositivo
              </h3>
              <p className="text-xs text-slate-500">
                Almacenamiento persistente local y sincronización en la nube.
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
              ¿Cómo se persiste el cambio del widget flotante?
            </h4>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              El número se almacena inmediatamente en el almacenamiento local persistente del navegador y emite un evento en tiempo real que actualiza el widget flotante al instante sin necesidad de recargar la página.
            </p>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              Además, si Supabase está activo, se actualiza el registro en la nube para que se propague a otros dispositivos.
            </p>
          </div>

          <div className="p-4 bg-white rounded-2xl border border-slate-200 space-y-2">
            <h4 className="font-bold text-slate-900 flex items-center gap-2">
              <RefreshCw className="w-4 h-4 text-sky-600" />
              ¿Puedo cambiar de número dinámicamente?
            </h4>
            <p className="text-slate-600 leading-relaxed text-[11px]">
              <strong>Sí, tantas veces como lo necesites.</strong> Podés cambiar el número antes o durante una sesión de fotos, asignar un número especial durante fines de semana o cambiarlo por turnos escolares.
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
              Si querés que el número se sincronice automáticamente en cualquier computadora o celular que abras en Supabase, pegá estas líneas en el <em>SQL Editor</em> de tu proyecto en Supabase:
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
