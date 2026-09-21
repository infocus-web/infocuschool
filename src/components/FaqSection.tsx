import { useState } from 'react';
import { HelpCircle, ChevronDown, Users } from 'lucide-react';
import { PREGUNTAS_FRECUENTES } from '../data/colegiosData';

export default function FaqSection() {
  const [openIdx, setOpenIdx] = useState<number | null>(0);

  const toggle = (i: number) => {
    setOpenIdx(openIdx === i ? null : i);
  };

  return (
    <section id="faq" className="scroll-mt-24 py-16 lg:py-24 bg-white border-b border-slate-200/80">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="text-center mb-12">
          <span className="text-xs font-bold text-slate-700 uppercase tracking-widest px-3 py-1 bg-slate-100 rounded-full border border-slate-200 inline-block mb-3">
            Dudas y Consultas de Familias
          </span>
          <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-['Outfit']">
            Preguntas Frecuentes
          </h2>
          <p className="text-sm sm:text-base text-slate-600 mt-2">
            Respuestas claras y directas para acceder, elegir y disfrutar las fotos escolares de tus hijos.
          </p>
        </div>

        {/* Accordion list */}
        <div className="space-y-3 text-left">
          {PREGUNTAS_FRECUENTES.map((item, idx) => {
            const isOpen = openIdx === idx;
            return (
              <div
                key={idx}
                className={`rounded-2xl border transition-all ${
                  isOpen
                    ? 'border-amber-400/80 bg-amber-50/20 shadow-xs'
                    : 'border-slate-200 bg-slate-50/50 hover:bg-slate-50'
                }`}
              >
                <button
                  type="button"
                  onClick={() => toggle(idx)}
                  className="w-full p-4 sm:p-5 flex items-center justify-between text-left cursor-pointer"
                >
                  <span className="text-sm sm:text-base font-bold text-slate-900 pr-4">
                    {item.pregunta}
                  </span>
                  <ChevronDown
                    className={`w-5 h-5 text-slate-500 shrink-0 transition-transform duration-200 ${
                      isOpen ? 'rotate-180 text-amber-600' : ''
                    }`}
                  />
                </button>
                {isOpen && (
                  <div className="px-4 pb-5 sm:px-5 text-xs sm:text-sm text-slate-600 leading-relaxed border-t border-slate-100/80 pt-3">
                    {item.respuesta}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
