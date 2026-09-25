import { Award, Users, ShieldCheck, Zap, HeartHandshake, Smile } from 'lucide-react';

export default function TrustStats() {
  const stats = [
    {
      icon: Award,
      valor: '+25 Años',
      etiqueta: 'Trayectoria Escolar',
      descripcion: 'Acompañando a las mismas instituciones ciclo tras ciclo.',
    },
    {
      icon: Users,
      valor: '+140 Colegios',
      etiqueta: 'En CABA y Gran Bs. As.',
      descripcion: 'Jardines, primarias y secundarias confían en nuestro equipo.',
    },
    {
      icon: ShieldCheck,
      valor: '100% Digital',
      etiqueta: 'Pago Seguro Online',
      descripcion: 'Aboná con Mercado Pago, Nave o Transferencia desde tu celular, al elegir las fotos o por adelantado. Sin efectivo ni sobres.',
    },
    {
      icon: Zap,
      valor: '72 Horas',
      etiqueta: 'Publicación de Galería',
      descripcion: 'Fotos online listas para que cada familia elija con calma.',
    },
  ];

  return (
    <section className="bg-white border-b border-slate-200/80 py-12 lg:py-14">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
          {stats.map((st, idx) => {
            const Icon = st.icon;
            return (
              <div
                key={idx}
                className="p-5 rounded-2xl bg-slate-50/70 border border-slate-200/70 hover:border-amber-200 transition-colors text-left"
              >
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center mb-3">
                  <Icon className="w-5 h-5" />
                </div>
                <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-['Outfit'] tracking-tight">
                  {st.valor}
                </div>
                <div className="text-sm font-bold text-slate-800 mt-0.5">{st.etiqueta}</div>
                <div className="text-xs text-slate-500 mt-1 leading-relaxed">{st.descripcion}</div>
              </div>
            );
          })}
        </div>

        {/* Institutional banner */}
        <div className="mt-8 pt-6 border-t border-slate-100 flex flex-col sm:flex-row items-center justify-between gap-4 bg-gradient-to-r from-amber-500/10 via-amber-500/5 to-transparent p-4 rounded-2xl border border-amber-200/60">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center shrink-0">
              <Smile className="w-6 h-6" />
            </div>
            <div>
              <p className="text-sm font-bold text-slate-900">
                Fotografía empática, paciente y con respeto por cada niño
              </p>
              <p className="text-xs text-slate-600">
                Nos tomamos el tiempo para que cada alumno sonría naturalmente, sin presiones ni poses rígidas.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs font-semibold text-slate-700 shrink-0">
            <HeartHandshake className="w-4 h-4 text-amber-600" />
            <span>Equipo con seguro de ART y antecedentes al día</span>
          </div>
        </div>
      </div>
    </section>
  );
}
