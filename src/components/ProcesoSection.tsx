import {
  UserPlus,
  KeyRound,
  Smartphone,
  Sparkles,
  CheckCircle2,
  Download,
  ArrowRight,
  Users,
  Camera,
  Heart,
  MessageCircle,
  FolderHeart,
  XCircle
} from 'lucide-react';

interface ProcesoSectionProps {
  onOpenFamilias: (colegioId?: string) => void;
  onOpenInscripcion?: () => void;
}

export default function ProcesoSection({ onOpenFamilias, onOpenInscripcion }: ProcesoSectionProps) {
  const pasos = [
    {
      numero: '1',
      icono: UserPlus,
      titulo: 'Te anotás en 1 minuto',
      bajada: 'Un solo registro para toda la familia',
      descripcion:
        'Cargás tus datos de contacto y el nombre de tus hijos. Si tenés varios hijos en el colegio, los agregás a todos juntos en el mismo formulario.',
      miniGrafico: (
        <div className="mt-3 p-2.5 bg-white rounded-xl border border-amber-200/80 text-left space-y-1.5 shadow-2xs">
          <div className="flex items-center justify-between text-[10px] font-bold text-slate-500 uppercase">
            <span>Tus Hijos:</span>
            <span className="text-emerald-700 bg-emerald-50 px-1.5 py-0.2 rounded font-semibold">1 Registro</span>
          </div>
          <div className="space-y-1 text-xs text-slate-800 font-semibold">
            <div className="flex items-center gap-1.5 bg-amber-50/80 px-2 py-1 rounded-lg border border-amber-200/60">
              <span>👦</span>
              <span className="truncate">Mateo (Sala 5 Turno Mañana)</span>
            </div>
            <div className="flex items-center gap-1.5 bg-amber-50/80 px-2 py-1 rounded-lg border border-amber-200/60">
              <span>👧</span>
              <span className="truncate">Sofía (2° B Turno Tarde)</span>
            </div>
          </div>
          <div className="pt-0.5 flex items-center gap-1 text-[10px] text-emerald-700 font-bold">
            <CheckCircle2 className="w-3 h-3 shrink-0" />
            <span>Opción foto de hermanos juntos</span>
          </div>
        </div>
      ),
    },
    {
      numero: '2',
      icono: KeyRound,
      titulo: 'Recibís 1 Código Familiar',
      bajada: 'Directo a tu WhatsApp y Email',
      descripcion:
        'El sistema te genera una clave única y fácil de recordar (ej: FAM-4821). Con ese solo código accedés a las fotos de todos tus hijos.',
      miniGrafico: (
        <div className="mt-3 p-2.5 bg-[#E8F8F0] rounded-xl border border-emerald-300/80 text-left space-y-1.5 shadow-2xs">
          <div className="flex items-center gap-1 text-[10px] font-bold text-emerald-800">
            <MessageCircle className="w-3 h-3 text-[#25D366] shrink-0" />
            <span>Mensaje de WhatsApp:</span>
          </div>
          <div className="bg-white p-2 rounded-lg border border-emerald-200 shadow-2xs">
            <p className="text-[11px] text-slate-700 leading-tight">
              ¡Hola! Tu <strong>Código Familiar</strong> es:
            </p>
            <p className="text-sm font-black font-mono text-emerald-800 tracking-wider my-0.5">
              FAM-4821
            </p>
            <p className="text-[10px] text-slate-500">
              Válido para Mateo y Sofía
            </p>
          </div>
        </div>
      ),
    },
    {
      numero: '3',
      icono: Smartphone,
      titulo: 'Mirás las fotos en tu celu',
      bajada: 'Muestras protegidas con marca de agua',
      descripcion:
        'Entrás a la web con tu código y ves la galería privada. Si tenés varios hijos, podés alternar entre ellos con un solo clic.',
      miniGrafico: (
        <div className="mt-3 p-2.5 bg-white rounded-xl border border-slate-200 text-left space-y-1.5 shadow-2xs">
          <div className="text-[10px] font-bold text-slate-400 uppercase">
            Elegí a quién querés ver:
          </div>
          <div className="grid grid-cols-2 gap-1 text-[10px] font-bold">
            <span className="bg-amber-400 text-slate-950 px-2 py-1 rounded-md text-center shadow-2xs">
              👦 Mateo (Sala 5)
            </span>
            <span className="bg-slate-100 text-slate-600 px-2 py-1 rounded-md text-center">
              👧 Sofía (2° B)
            </span>
          </div>
          <div className="text-[10px] text-slate-500 flex items-center gap-1 pt-0.5">
            <Camera className="w-3 h-3 text-amber-500" />
            <span>Fotos en alta resolución</span>
          </div>
        </div>
      ),
    },
    {
      numero: '4',
      icono: Heart,
      titulo: 'Elegís tus 3 fotos favoritas',
      bajada: 'Incluidas en tu paquete escolar',
      descripcion:
        'Elegís la foto grupal del curso, el retrato individual más lindo de tu hijo/a y la foto de recuerdo con la seño o maestro.',
      miniGrafico: (
        <div className="mt-3 p-2.5 bg-white rounded-xl border border-slate-200 text-left space-y-1 shadow-2xs">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800">
            <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold flex items-center justify-center">1</span>
            <span>Foto Grupal del curso</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800">
            <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold flex items-center justify-center">2</span>
            <span>Retrato Individual</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-800">
            <span className="w-4 h-4 rounded-full bg-amber-100 text-amber-900 text-[10px] font-bold flex items-center justify-center">3</span>
            <span>Con su docente / seño</span>
          </div>
        </div>
      ),
    },
    {
      numero: '5',
      icono: Download,
      titulo: 'Recibís en el celu y en papel',
      bajada: 'Descarga al instante + carpeta',
      descripcion:
        'Abonás seguro con Mercado Pago o Transferencia. Descargás las fotos digitales en tu celular y recibís las copias impresas en la escuela.',
      miniGrafico: (
        <div className="mt-3 p-2.5 bg-linear-to-br from-amber-50 to-amber-100/60 rounded-xl border border-amber-300 text-left space-y-1 shadow-2xs">
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-amber-950">
            <Download className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>Digital HD directo al celular</span>
          </div>
          <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-800">
            <FolderHeart className="w-3.5 h-3.5 text-amber-700 shrink-0" />
            <span>Carpeta impresa en el colegio</span>
          </div>
        </div>
      ),
    },
  ];

  return (
    <section id="proceso" className="py-16 lg:py-24 bg-white border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 space-y-14">
        {/* Header principal */}
        <div className="text-center max-w-3xl mx-auto space-y-3">
          <span className="text-xs font-extrabold text-amber-800 uppercase tracking-widest px-3.5 py-1.5 bg-amber-100/80 rounded-full border border-amber-300/80 inline-flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-amber-600" />
            <span>Guía Fácil para Familias</span>
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-['Outfit']">
            Mirá qué fácil es ver y pedir las fotos de tus hijos
          </h2>
          <p className="text-base sm:text-lg text-slate-600">
            Sin sobres de papel en la mochila, sin trámites complicados y desde la comodidad de tu celular.
          </p>
        </div>

        {/* Los 5 pasos sencillos con mini gráficos */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-5">
          {pasos.map((p) => {
            const Icon = p.icono;
            return (
              <div
                key={p.numero}
                className="bg-slate-50/90 rounded-2xl p-5 border-2 border-slate-200 hover:border-amber-400 transition-all hover:shadow-md flex flex-col justify-between text-left group"
              >
                <div>
                  {/* Número y Cabecera del paso */}
                  <div className="flex items-center justify-between mb-3">
                    <span className="w-8 h-8 rounded-full bg-amber-400 text-slate-950 font-black text-sm flex items-center justify-center font-['Outfit'] shadow-xs">
                      {p.numero}
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-2xs flex items-center justify-center text-slate-700 group-hover:bg-amber-400 group-hover:text-slate-950 transition-colors">
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>

                  <h3 className="text-base font-extrabold text-slate-900 leading-snug">
                    {p.titulo}
                  </h3>
                  <p className="text-xs font-semibold text-amber-700 mt-0.5 mb-2">
                    {p.bajada}
                  </p>
                  <p className="text-xs text-slate-600 leading-relaxed">
                    {p.descripcion}
                  </p>
                </div>

                {/* Mini Gráfico Visual Explicativo */}
                {p.miniGrafico}
              </div>
            );
          })}
        </div>

        {/* DESTACADO ESPECIAL: FAMILIAS CON VARIOS HIJOS (Visual Infographic Card) */}
        <div className="bg-linear-to-br from-amber-500/10 via-amber-50 to-white rounded-3xl p-6 sm:p-8 border-2 border-amber-300 shadow-lg shadow-amber-500/5">
          <div className="max-w-4xl mx-auto space-y-6">
            <div className="text-center space-y-2">
              <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-amber-400 text-slate-950 text-xs font-extrabold uppercase tracking-wider">
                <Users className="w-4 h-4" />
                ¡Gran Novedad para Padres con Varios Hijos!
              </span>
              <h3 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit']">
                ¿Tenés 2 o más hijos en el colegio? Ahora tenés 1 solo Código Familiar
              </h3>
              <p className="text-sm sm:text-base text-slate-600 max-w-2xl mx-auto">
                No tenés que andar con claves distintas para cada curso. Con un único código ves a todos tus hijos juntos en la misma pantalla.
              </p>
            </div>

            {/* Comparativa Visual Súper Clara (Antes vs. Ahora) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-left">
              {/* Cómo era antes */}
              <div className="bg-white/80 p-5 rounded-2xl border border-rose-200 shadow-2xs space-y-3">
                <div className="flex items-center gap-2 text-rose-700 font-bold text-sm">
                  <XCircle className="w-5 h-5 text-rose-500 shrink-0" />
                  <span>¿Cómo era el método tradicional?</span>
                </div>
                <ul className="space-y-2 text-xs text-slate-600">
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold">•</span>
                    <span>Varios sobres de papel dando vueltas en la mochila de cada chico.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold">•</span>
                    <span>Un código o papel distinto para cada sala, grado o turno.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-rose-500 font-bold">•</span>
                    <span>Hacer trámites por duplicado o enviar dinero en efectivo a la escuela.</span>
                  </li>
                </ul>
              </div>

              {/* Cómo es ahora */}
              <div className="bg-white p-5 rounded-2xl border-2 border-emerald-400 shadow-xs space-y-3">
                <div className="flex items-center gap-2 text-emerald-800 font-extrabold text-sm">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <span>¿Cómo funciona ahora con Retrato Escolar?</span>
                </div>
                <ul className="space-y-2 text-xs text-slate-700 font-medium">
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold">✔</span>
                    <span><strong>1 solo Código Familiar (ej: FAM-4821)</strong> que te llega directo a tu WhatsApp.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold">✔</span>
                    <span>Entrás y ves a todos tus hijos juntos. Podés pasar de uno al otro tocando su nombre.</span>
                  </li>
                  <li className="flex items-start gap-2">
                    <span className="text-emerald-600 font-bold">✔</span>
                    <span>Podés solicitar la <strong>Foto de Hermanos juntos</strong> directamente al anotarte.</span>
                  </li>
                </ul>
              </div>
            </div>

            {/* Botones de acción rápida */}
            <div className="pt-2 flex flex-col sm:flex-row items-center justify-center gap-3">
              {onOpenInscripcion && (
                <button
                  type="button"
                  onClick={onOpenInscripcion}
                  className="w-full sm:w-auto px-6 py-3.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-xs sm:text-sm rounded-xl transition-all shadow-md shadow-amber-400/30 flex items-center justify-center gap-2 cursor-pointer active:scale-98"
                >
                  <UserPlus className="w-4 h-4" />
                  <span>Anotarme con mis hijos ahora</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => onOpenFamilias()}
                className="w-full sm:w-auto px-6 py-3.5 bg-slate-900 hover:bg-slate-800 text-white font-bold text-xs sm:text-sm rounded-xl transition-all flex items-center justify-center gap-2 cursor-pointer"
              >
                <span>Ya tengo mi código: Ingresar al Portal</span>
                <ArrowRight className="w-4 h-4 text-amber-400" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
