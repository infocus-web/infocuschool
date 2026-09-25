import { useState, useEffect, type FormEvent } from 'react';
import { Search, ShieldCheck, CheckCircle, ArrowRight, Sparkles, School, UserPlus, CheckCircle2, User, LogOut, Images, CalendarCheck } from 'lucide-react';
import { KITS_DISPONIBLES } from '../data/colegiosData';
import { useColegiosLista } from '../services/colegiosService';
import { obtenerFamiliaActiva, cerrarSesionFamilia, InscripcionFamilia } from '../services/inscripcionesService';

interface HeroProps {
  onOpenFamilias: (colegioId?: string, codigo?: string) => void;
  onOpenInscripcion?: (tab?: 'registro' | 'login') => void;
}

export default function Hero({ onOpenFamilias, onOpenInscripcion }: HeroProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [searchError, setSearchError] = useState('');
  const [familiaActiva, setFamiliaActiva] = useState<InscripcionFamilia | null>(null);
  const { colegios } = useColegiosLista();

  useEffect(() => {
    setFamiliaActiva(obtenerFamiliaActiva());
    const handleSync = () => {
      setFamiliaActiva(obtenerFamiliaActiva());
    };
    window.addEventListener('infocus_familia_activa_actualizada', handleSync);
    return () => {
      window.removeEventListener('infocus_familia_activa_actualizada', handleSync);
    };
  }, []);

  const handleCerrarSesion = () => {
    cerrarSesionFamilia();
    setFamiliaActiva(null);
  };

  const filteredColegios = colegios.filter(
    (c) =>
      c.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.localidad.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.codigoAcceso.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const term = searchTerm.trim();
    if (!term) {
      setSearchError('Ingresá el código de acceso que te llegó por email para ver las fotos.');
      return;
    }
    setSearchError('');
    if (filteredColegios.length > 0) {
      onOpenFamilias(filteredColegios[0].id, term || undefined);
    } else {
      onOpenFamilias(undefined, term || undefined);
    }
  };

  return (
    <section className="relative overflow-hidden bg-gradient-to-b from-amber-50/50 via-white to-slate-50 pt-10 pb-16 lg:pt-16 lg:pb-24 border-b border-slate-200/60">
      {/* Decorative subtle background elements */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full max-w-7xl h-96 pointer-events-none opacity-40">
        <div className="absolute -top-12 left-10 w-72 h-72 rounded-full bg-amber-200/40 blur-3xl" />
        <div className="absolute top-20 right-10 w-80 h-80 rounded-full bg-sky-200/40 blur-3xl" />
      </div>

      <div className="relative max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 items-center">
          {/* Left Column: Copy & Search */}
          <div className="lg:col-span-7 space-y-6 text-left">
            <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-amber-100/80 border border-amber-200/80 text-amber-900 text-xs font-semibold tracking-wide">
              <Sparkles className="w-3.5 h-3.5 text-amber-600" />
              <span>Portal exclusivo para padres y familiares</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12] font-['Outfit']">
              Las fotos de tus hijos,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700">
                directo a tu pantalla
              </span>{' '}
              y en alta calidad
            </h1>

            <p className="text-lg sm:text-xl text-slate-600 leading-relaxed max-w-2xl font-normal">
              Retratos escolares con iluminación profesional de estudio y máxima calidez. Inscribite con tus datos de contacto y los de tu hijo/a para acceder a la galería fotográfica de su curso.
            </p>

            {/* Inscription First Card */}
            {familiaActiva ? (
              <div className="bg-gradient-to-r from-amber-500/10 via-amber-400/15 to-emerald-500/10 border-2 border-amber-400/60 rounded-2xl p-4 sm:p-5 max-w-2xl shadow-lg shadow-amber-400/10 text-left">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-emerald-800 bg-emerald-100/90 px-2.5 py-0.5 rounded-full">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        Inscripción Activa
                      </span>
                      <span className="text-xs text-slate-500">Ciclo 2026</span>
                    </div>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900">
                      ¡Hola, {familiaActiva.padreNombre}!
                    </h3>
                    <p className="text-xs text-slate-600">
                      Alumno/a: <strong className="text-slate-900">{familiaActiva.alumnoNombre} {familiaActiva.alumnoApellido}</strong> · {familiaActiva.grado} {familiaActiva.division} ({familiaActiva.turno})
                      {familiaActiva.hermanos && familiaActiva.hermanos.length > 0 && (
                        <span className="block mt-0.5 text-amber-900 font-semibold text-[11px]">
                          + {familiaActiva.hermanos.length} hermano/s: {familiaActiva.hermanos.map((h) => `${h.alumnoNombre} (${h.grado} ${h.division})`).join(', ')}
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                    <button
                      id="btn-ver-fotos-alumno-activo"
                      onClick={() => onOpenFamilias(familiaActiva.colegioId)}
                      className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-xs shadow-amber-400/30 flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
                    >
                      <span>Ver fotos de la familia</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    {onOpenInscripcion && (
                      <button
                        id="btn-cambiar-familia-activa"
                        onClick={() => onOpenInscripcion('login')}
                        className="px-3 py-2 bg-white hover:bg-slate-100 text-slate-700 font-semibold text-xs rounded-xl border border-slate-200 transition-colors cursor-pointer"
                        title="Cambiar datos de alumno o seleccionar otro"
                      >
                        Cambiar
                      </button>
                    )}
                    <button
                      id="btn-cerrar-sesion-familia"
                      type="button"
                      onClick={handleCerrarSesion}
                      className="px-3 py-2 bg-white hover:bg-rose-50 text-slate-500 hover:text-rose-700 font-semibold text-xs rounded-xl border border-slate-200 hover:border-rose-200 transition-colors flex items-center gap-1.5 cursor-pointer"
                      title="Cerrar sesión en este dispositivo"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>Cerrar sesión</span>
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="bg-amber-50/80 border-2 border-amber-300/80 rounded-2xl p-4 sm:p-5 max-w-2xl shadow-lg shadow-amber-400/10 text-left">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
                  <div className="space-y-1">
                    <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-amber-900 bg-amber-200/80 px-2.5 py-0.5 rounded-md">
                      <UserPlus className="w-3.5 h-3.5 text-amber-800" />
                      Primer Paso para Familias
                    </span>
                    <h3 className="text-base sm:text-lg font-bold text-slate-900">
                      ¿Tenés hijos en la institución?
                    </h3>
                    <p className="text-xs text-slate-600">
                      ¡Un solo registro para toda tu familia, sin costo! Inscribite con tu WhatsApp y sumá a tus hijos para recibir tu <strong>código de acceso</strong>. Inscribirte no tiene ningún cargo: después elegís si pagás cuando elegís las fotos o si preferís dejar el kit pago por adelantado.
                    </p>
                  </div>
                  {onOpenInscripcion && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        id="btn-inscribirme-hero"
                        onClick={() => onOpenInscripcion('registro')}
                        className="px-6 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-sm rounded-xl transition-all shadow-md shadow-amber-400/40 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Anotarme con mis hijos</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={() => onOpenInscripcion?.('login')}
                        className="text-[11px] text-center text-amber-800 hover:text-amber-900 underline font-medium cursor-pointer"
                      >
                        ¿Ya te inscribiste? Consultar código
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* School Search Box — solo para visitantes sin sesión de familia activa;
                si ya hay una familia logueada, "Ver fotos de la familia" ya cubre esto */}
            {!familiaActiva && (
              <div className="bg-white p-2.5 sm:p-3 rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-200/90 max-w-2xl">
                <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1 flex items-center">
                    <Search className="absolute left-3.5 w-5 h-5 text-slate-400" />
                    <input
                      id="input-buscar-colegio-hero"
                      type="text"
                      value={searchTerm}
                      onChange={(e) => {
                        setSearchTerm(e.target.value);
                        if (searchError) setSearchError('');
                      }}
                      placeholder="Ingresá el código de acceso (ej: 88BU-M8TF)"
                      className="w-full pl-11 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent border-0 focus:outline-hidden focus:ring-0"
                    />
                    {searchTerm && (
                      <button
                        type="button"
                        onClick={() => setSearchTerm('')}
                        className="text-xs text-slate-400 hover:text-slate-600 px-3 py-2.5 sm:py-1"
                      >
                        Borrar
                      </button>
                    )}
                  </div>
                  <button
                    id="btn-buscar-colegio-hero"
                    type="submit"
                    className="px-6 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-sm rounded-xl transition-all shadow-sm shadow-amber-400/40 flex items-center justify-center gap-2 cursor-pointer active:scale-98 shrink-0"
                  >
                    <span>Ver mis fotos</span>
                    <ArrowRight className="w-4 h-4" />
                  </button>
                </form>
                {searchError && (
                  <p role="alert" className="px-3 pt-2 text-sm font-semibold text-rose-700">
                    {searchError}
                  </p>
                )}
              </div>
            )}

            {/* Pedido de Pablo (25/9): las dos formas de pago tienen que quedar claras de entrada —
                pagar al elegir las fotos, o dejar el kit pago por adelantado cuando las fotos del
                curso todavía no están (ver ReservaKitAnticipada en el portal). */}
            <div id="como-se-paga" className="max-w-2xl rounded-2xl border border-slate-200 bg-white/90 p-4 sm:p-5 shadow-xs">
              <p className="text-sm font-extrabold text-slate-900 font-['Outfit']">¿Cómo se paga? Elegí lo que te quede más cómodo</p>
              <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="rounded-xl border border-sky-200 bg-sky-50/70 p-3.5">
                  <p className="flex items-center gap-2 text-xs font-bold text-sky-950">
                    <Images className="w-4 h-4 text-sky-600 shrink-0" />
                    Pagás al elegir las fotos
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    Cuando las fotos de tu curso están online, entrás, elegís tus 3 favoritas y pagás en ese momento. La descarga en alta resolución te llega al instante.
                  </p>
                </div>
                <div className="rounded-xl border border-amber-300 bg-amber-50/80 p-3.5">
                  <p className="flex items-center gap-2 text-xs font-bold text-amber-950">
                    <CalendarCheck className="w-4 h-4 text-amber-600 shrink-0" />
                    Pagás por adelantado
                    <span className="rounded-full bg-amber-400 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide text-slate-950">Nuevo</span>
                  </p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-600">
                    ¿Las fotos de tu curso todavía no están? Entrá con tu código, reservá el kit y dejalo pago. Cuando se suban, elegís tus fotos <strong>sin volver a pagar</strong>.
                  </p>
                  <button
                    type="button"
                    onClick={() => (familiaActiva ? onOpenFamilias(familiaActiva.colegioId) : onOpenFamilias())}
                    className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-amber-800 hover:text-amber-950 underline cursor-pointer"
                  >
                    Reservar mi kit
                    <ArrowRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
              <p className="mt-3 text-[11px] text-slate-500">
                En los dos casos la inscripción es gratis y el precio es el mismo. Podés pagar con Mercado Pago, Nave o transferencia bancaria.
              </p>
            </div>

            {/* Micro value props */}
            <div className="pt-2 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-600">
              {/* Pedido de Pablo: tiene que quedar muy claro que inscribirse no cuesta nada — se
                  paga recién al elegir las fotos, no en este paso. Se agrega como su propio chip
                  (no sólo en el texto chico de arriba) para que se vea de entrada. */}
              <div className="flex items-center gap-2 font-bold text-emerald-700">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Inscribirte es gratis — pagás al elegir las fotos o por adelantado</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Múltiples tomas por alumno</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Mercado Pago, Nave y Transferencia</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Papel fotográfico satinado de máxima durabilidad</span>
              </div>
            </div>
          </div>

          {/* Right Column: Visual Product & Watermark Interactive Showcase */}
          <div className="lg:col-span-5">
            <div className="relative mx-auto max-w-md bg-white rounded-3xl p-4 sm:p-5 shadow-2xl shadow-slate-200/80 border border-slate-200/80">
              {/* Photo Card with Studio Quality Showcase */}
              <div 
                className="relative aspect-4/5 rounded-2xl overflow-hidden bg-slate-100 border border-slate-200/80 shadow-inner group select-none"
                onContextMenu={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                }}
              >
                <img
                  src="/alumna_instituto.jpg"
                  alt="Muestra de fotografía escolar oficial - Retrato Escolar"
                  referrerPolicy="no-referrer"
                  draggable={false}
                  className="w-full h-full object-cover object-center transform group-hover:scale-102 transition-transform duration-500 pointer-events-none select-none"
                />

                {/* Top Badge */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                  <span className="px-3 py-1.5 rounded-full bg-slate-900/85 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1.5 shadow-md">
                    <School className="w-3.5 h-3.5 text-amber-400" />
                    <span>Retrato de tu Hijo/a</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-md bg-amber-400 text-slate-950 text-[10px] font-bold tracking-wider uppercase shadow-xs">
                    Ciclo 2026
                  </span>
                </div>

                {/* Bottom Studio Quality Tag */}
                <div className="absolute bottom-3 left-3 right-3">
                  <div className="bg-slate-950/80 backdrop-blur-md rounded-xl px-3.5 py-2.5 text-white flex items-center justify-between shadow-lg border border-white/10">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                      <span className="text-xs font-medium text-slate-100">Iluminación profesional</span>
                    </div>
                    <span className="text-[11px] text-amber-300 font-semibold">Un Recuerdo para Siempre</span>
                  </div>
                </div>
              </div>

              {/* Auditoría 2026-09-22 (pregunta de Pablo viendo la landing real: "tiene sentido
                  estos dos botones ahí?"): este botón y el buscador "Ver mis fotos" de la columna
                  de la izquierda hacían exactamente lo mismo (abrir el Portal de Familias), pero
                  ESTE quedaba pegado a un colegio de muestra fijo ('col-modelo-2026', hardcodeado)
                  sin ninguna relación con lo que la visita haya buscado — alguien podía terminar
                  en el portal de un colegio de ejemplo en vez del suyo. Con el mandato de esta
                  sesión de que la entrada sea mínima y sin acciones duplicadas, se saca el botón y
                  la tarjeta queda como lo que en el fondo es: una muestra visual del producto, no
                  un segundo punto de entrada. El único botón real para entrar sigue siendo "Ver mis
                  fotos" del buscador de arriba. */}
              <div className="mt-4 pt-3 border-t border-slate-100">
                <p className="text-xs text-slate-500 font-medium">Kits y fotos escolares</p>
                <p className="text-sm sm:text-base font-bold text-slate-900 font-['Outfit']">
                  Impresos con carpeta y Digitales HD
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
