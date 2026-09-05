import { KeyRound, ShieldCheck, CheckSquare, CreditCard, Download, ArrowRight } from 'lucide-react';

interface ProcesoSectionProps {
  onOpenFamilias: (colegioId?: string) => void;
}

export default function ProcesoSection({ onOpenFamilias }: ProcesoSectionProps) {
  const pasos = [
    {
      paso: '01',
      icono: KeyRound,
      titulo: 'Recibís el código',
      subtitulo: 'Acceso directo a tu curso',
      descripcion:
        'Con el código provisto por tu colegio o docente (ej: SALA3TM) ingresás directo al grado, división y turno exacto de tu hijo/a.',
      destacado: 'Código único por curso',
    },
    {
      paso: '02',
      icono: ShieldCheck,
      titulo: 'Galería con marca de agua',
      subtitulo: 'Segura y protegida',
      descripcion:
        'Visualizás todas las tomas tomadas en la jornada escolar con marca de agua de protección y en alta definición.',
      destacado: '100% privado y seguro',
    },
    {
      paso: '03',
      icono: CheckSquare,
      titulo: 'Elegís las 3 fotos',
      subtitulo: 'Tus favoritas de la nómina',
      descripcion:
        'Elegís la foto grupal del grado, la mejor toma individual de tu hijo/a y el entrañable retrato con su maestra.',
      destacado: '3 fotos incluidas por kit',
    },
    {
      paso: '04',
      icono: CreditCard,
      titulo: 'Elegís tu formato',
      subtitulo: 'Impreso + HD o Solo Digital',
      descripcion:
        'Optás por el Kit Impreso con carpeta exclusiva y HD de regalo, o Solo Digital HD. Abonás seguro con Mercado Pago o Transferencia.',
      destacado: 'Sin sobres ni efectivo',
    },
    {
      paso: '05',
      icono: Download,
      titulo: 'Descarga HD y copias',
      subtitulo: 'Al instante en tu celular',
      descripcion:
        'Descargás los archivos en máxima resolución al instante en tu teléfono. Si compraste impresas, se entregan en sobre cerrado rotulado.',
      destacado: 'Respaldo por email y WhatsApp',
    },
  ];

  return (
    <section id="proceso" className="py-16 lg:py-24 bg-white border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center max-w-3xl mx-auto mb-16">
          <span className="text-xs font-bold text-amber-700 uppercase tracking-widest px-3 py-1 bg-amber-50 rounded-full border border-amber-200/60 inline-block mb-3">
            Guía para Familias
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-['Outfit']">
            Cómo acceder, elegir y recibir las fotos de tus hijos
          </h2>
          <p className="text-base sm:text-lg text-slate-600 mt-3">
            Un proceso 100% digital, pensado para que elijas desde la comodidad de tu celular sin trámites ni complicaciones.
          </p>
        </div>

        {/* Steps Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-6 relative">
          {pasos.map((p) => {
            const Icon = p.icono;
            return (
              <div
                key={p.paso}
                className="relative bg-slate-50/80 rounded-2xl p-5 border border-slate-200/80 hover:border-amber-300 transition-all hover:shadow-md flex flex-col justify-between group"
              >
                {/* Step badge */}
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <span className="text-2xl font-black text-slate-300 font-['Outfit'] group-hover:text-amber-500 transition-colors">
                      {p.paso}
                    </span>
                    <div className="w-10 h-10 rounded-xl bg-white border border-slate-200 shadow-xs flex items-center justify-center text-slate-800 group-hover:bg-amber-400 group-hover:text-slate-950 group-hover:border-amber-400 transition-all">
                      <Icon className="w-5 h-5" />
                    </div>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900">{p.titulo}</h3>
                  <p className="text-[11px] font-semibold text-amber-700 mb-2">{p.subtitulo}</p>
                  <p className="text-xs text-slate-600 leading-relaxed">{p.descripcion}</p>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-200/60">
                  <span className="text-[10px] font-bold text-slate-700 bg-white px-2 py-1 rounded-md border border-slate-200 inline-block">
                    {p.destacado}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* Action bar */}
        <div className="mt-12 p-6 rounded-2xl bg-gradient-to-r from-slate-900 to-slate-800 text-white flex flex-col sm:flex-row items-center justify-between gap-4 shadow-xl">
          <div className="text-left">
            <h4 className="text-lg font-bold font-['Outfit'] text-white">
              ¿Listo para ver y encargar las fotos escolares?
            </h4>
            <p className="text-xs text-slate-300 mt-0.5">
              Ingresá con tu código de acceso para explorar las tomas individuales, grupales y encargar tus copias.
            </p>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <button
              onClick={() => onOpenFamilias('col-modelo-2026')}
              className="px-6 py-3 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl transition-all shadow-md shadow-amber-400/20 flex items-center gap-2 cursor-pointer"
            >
              <span>Ingresar al Portal de Familias</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
