import { useState, useEffect, type FormEvent } from 'react';
import { Search, ShieldCheck, CheckCircle, ArrowRight, Sparkles, School, UserPlus, CheckCircle2, User, LogOut } from 'lucide-react';
import { COLEGIOS_EJEMPLO, KITS_DISPONIBLES } from '../data/colegiosData';
import { obtenerFamiliaActiva, cerrarSesionFamilia, InscripcionFamilia } from '../services/inscripcionesService';

interface HeroProps {
  onOpenFamilias: (colegioId?: string, codigo?: string) => void;
  onOpenInscripcion?: () => void;
}

export default function Hero({ onOpenFamilias, onOpenInscripcion }: HeroProps) {
  const [searchTerm, setSearchTerm] = useState('');
  const [familiaActiva, setFamiliaActiva] = useState<InscripcionFamilia | null>(null);

  useEffect(() => {
    setFamiliaActiva(obtenerFamiliaActiva());
    const handleSync = () => {
      setFamiliaActiva(obtenerFamiliaActiva());
    };
    window.addEventListener('infocus_inscripciones_updated', handleSync);
    return () => {
      window.removeEventListener('infocus_inscripciones_updated', handleSync);
    };
  }, []);

  const handleCerrarSesion = () => {
    cerrarSesionFamilia();
    setFamiliaActiva(null);
  };

  const filteredColegios = COLEGIOS_EJEMPLO.filter(
    (c) =>
      c.nombre.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.localidad.toLowerCase().includes(searchTerm.toLowerCase()) ||
      c.codigoAcceso.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleSearchSubmit = (e: FormEvent) => {
    e.preventDefault();
    const term = searchTerm.trim();
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
              <span>Portal exclusivo para familias y padres</span>
            </div>

            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-extrabold tracking-tight text-slate-900 leading-[1.12] font-['Outfit']">
              Las fotos de tus hijos,{' '}
              <span className="text-transparent bg-clip-text bg-gradient-to-r from-amber-600 via-amber-500 to-amber-700">
                directo al celular
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
                    </p>
                  </div>
                  <div className="flex flex-wrap sm:flex-nowrap items-center gap-2 shrink-0">
                    <button
                      id="btn-ver-fotos-alumno-activo"
                      onClick={() => onOpenFamilias(familiaActiva.colegioId)}
                      className="px-5 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-xs shadow-amber-400/30 flex items-center justify-center gap-1.5 cursor-pointer active:scale-98"
                    >
                      <span>Ver fotos de {familiaActiva.alumnoNombre}</span>
                      <ArrowRight className="w-4 h-4" />
                    </button>
                    {onOpenInscripcion && (
                      <button
                        id="btn-cambiar-familia-activa"
                        onClick={onOpenInscripcion}
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
                      ¿Sos padre o madre de un alumno?
                    </h3>
                    <p className="text-xs text-slate-600">
                      Inscribite con tu número de WhatsApp y los datos de tu hijo/a (grado, turno y división) para acceder a las fotos.
                    </p>
                  </div>
                  {onOpenInscripcion && (
                    <div className="flex flex-col gap-1.5 shrink-0">
                      <button
                        id="btn-inscribirme-hero"
                        onClick={onOpenInscripcion}
                        className="px-6 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-sm rounded-xl transition-all shadow-md shadow-amber-400/40 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                      >
                        <UserPlus className="w-4 h-4" />
                        <span>Inscribirme / Crear usuario</span>
                        <ArrowRight className="w-4 h-4" />
                      </button>
                      <button
                        onClick={onOpenInscripcion}
                        className="text-[11px] text-center text-amber-800 hover:text-amber-900 underline font-medium cursor-pointer"
                      >
                        ¿Ya te inscribiste? Ingresar aquí
                      </button>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* School Search Box */}
            <div className="bg-white p-2.5 sm:p-3 rounded-2xl shadow-xl shadow-slate-200/60 border border-slate-200/90 max-w-2xl">
              <form onSubmit={handleSearchSubmit} className="flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1 flex items-center">
                  <Search className="absolute left-3.5 w-5 h-5 text-slate-400" />
                  <input
                    id="input-buscar-colegio-hero"
                    type="text"
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Ingresá tu código de acceso escolar (ej: PASTOR26)..."
                    className="w-full pl-11 pr-4 py-3 text-sm text-slate-900 placeholder:text-slate-400 bg-transparent border-0 focus:outline-hidden focus:ring-0"
                  />
                  {searchTerm && (
                    <button
                      type="button"
                      onClick={() => setSearchTerm('')}
                      className="text-xs text-slate-400 hover:text-slate-600 px-2 py-1"
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
            </div>

            {/* Micro value props */}
            <div className="pt-2 flex flex-wrap items-center gap-y-2 gap-x-6 text-xs text-slate-600">
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Múltiples tomas por alumno</span>
              </div>
              <div className="flex items-center gap-2">
                <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>Mercado Pago y Transferencia</span>
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
                  src="https://images.unsplash.com/photo-1544717305-2782549b5136?auto=format&fit=crop&w=1000&q=85"
                  alt="Muestra de fotografía escolar oficial"
                  draggable={false}
                  className="w-full h-full object-cover object-center transform group-hover:scale-102 transition-transform duration-500 pointer-events-none select-none"
                />

                {/* Top Badge */}
                <div className="absolute top-3 left-3 right-3 flex items-center justify-between">
                  <span className="px-3 py-1.5 rounded-full bg-slate-900/85 backdrop-blur-md text-white text-xs font-semibold flex items-center gap-1.5 shadow-md">
                    <School className="w-3.5 h-3.5 text-amber-400" />
                    <span>Instituto Divino Pastor</span>
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
                      <span className="text-xs font-medium text-slate-100">Iluminación de estudio</span>
                    </div>
                    <span className="text-[11px] text-amber-300 font-semibold">Toma oficial nítida</span>
                  </div>
                </div>
              </div>

              {/* Bottom Card Summary */}
              <div className="mt-4 pt-3 border-t border-slate-100 flex items-center justify-between">
                <div>
                  <p className="text-xs text-slate-500 font-medium">Kits y fotos escolares</p>
                  <p className="text-sm sm:text-base font-bold text-slate-900 font-['Outfit']">
                    Impresos con carpeta y Digitales HD
                  </p>
                </div>
                <button
                  id="btn-ver-galeria-card"
                  onClick={() => onOpenFamilias('col-divino-pastor')}
                  className="px-4 py-2.5 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded-xl transition-colors cursor-pointer flex items-center gap-1.5 shadow-md shadow-slate-900/10"
                >
                  <span>Ingresar a Galería</span>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
