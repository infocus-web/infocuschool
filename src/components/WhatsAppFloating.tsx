import { useState } from 'react';
import { MessageCircle, X, Send, KeyRound, User, HelpCircle } from 'lucide-react';
import { useWhatsAppConfig, formatearNumeroVisual } from '../services/configuracionService';

export default function WhatsAppFloating() {
  const [isOpen, setIsOpen] = useState(false);
  const { config } = useWhatsAppConfig();
  const whatsappNum = config.whatsappSolicitudCodigo || '5491128625916';
  const displayNum = formatearNumeroVisual(whatsappNum);

  const predefined = [
    {
      icon: User,
      text: 'Soy familia y tengo una consulta sobre las fotos de mi hijo/a',
      encoded: 'Hola%20Retrato%20Escolar,%20soy%20familia%20y%20tengo%20una%20consulta%20sobre%20las%20fotos%20de%20mi%20hijo/a%20(retratoescolar.com.ar)',
    },
    {
      icon: KeyRound,
      text: 'Me inscribí y solicito el Código de Curso para ver las fotos',
      encoded: 'Hola%20Retrato%20Escolar,%20me%20acabo%20de%20inscribir%20en%20el%20portal%20retratoescolar.com.ar%20y%20quisiera%20solicitar%20el%20código%20de%20curso%20con%20el%20que%20podré%20acceder%20a%20ver%20las%20fotos',
    },
    {
      icon: HelpCircle,
      text: 'Quiero consultar medios de pago y transferencias',
      encoded: 'Hola%20Retrato%20Escolar,%20quisiera%20consultar%20sobre%20medios%20de%20pago%20en%20retratoescolar.com.ar',
    },
  ];

  return (
    <div className="fixed bottom-5 right-5 z-40 flex flex-col items-end">
      {/* Popover */}
      {isOpen && (
        <div className="mb-3 w-80 bg-white rounded-2xl shadow-2xl border border-slate-200 overflow-hidden text-left animate-in slide-in-from-bottom-4 duration-200">
          <div className="bg-emerald-600 text-white p-4 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center">
                <MessageCircle className="w-4 h-4 text-white" />
              </div>
              <div>
                <p className="text-xs font-bold font-['Outfit'] leading-tight">
                  {config.nombreContacto || 'Atención Retrato Escolar'}
                </p>
                <p className="text-[10px] text-emerald-100">retratoescolar.com.ar · {displayNum}</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-1 hover:bg-white/10 rounded-lg transition-colors text-emerald-100 hover:text-white"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="p-3 bg-slate-50 space-y-2">
            <p className="text-[11px] font-semibold text-slate-600 px-1">
              ¿En qué podemos orientarte hoy?
            </p>
            {predefined.map((item, idx) => {
              const Icon = item.icon;
              return (
                <a
                  key={idx}
                  href={`https://wa.me/${whatsappNum}?text=${item.encoded}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-2.5 bg-white hover:bg-emerald-50 rounded-xl border border-slate-200 hover:border-emerald-300 text-xs text-slate-800 transition-all flex items-center gap-2.5 group shadow-2xs block"
                >
                  <Icon className="w-4 h-4 text-emerald-600 shrink-0 group-hover:scale-110 transition-transform" />
                  <span className="text-[11px] font-medium leading-tight">{item.text}</span>
                </a>
              );
            })}
          </div>

          <div className="p-3 border-t border-slate-100 text-center bg-white">
            <a
              href={`https://wa.me/${whatsappNum}?text=Hola,%20quisiera%20hacer%20una%20consulta`}
              target="_blank"
              rel="noopener noreferrer"
              className="w-full py-2 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center justify-center gap-2 transition-colors"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Abrir chat directo</span>
            </a>
          </div>
        </div>
      )}

      {/* Trigger Button */}
      <button
        id="btn-whatsapp-flotante"
        onClick={() => setIsOpen(!isOpen)}
        className="w-14 h-14 rounded-full bg-emerald-500 hover:bg-emerald-400 text-white shadow-xl shadow-emerald-500/30 flex items-center justify-center transition-all hover:scale-105 active:scale-95 cursor-pointer relative"
        aria-label="Abrir WhatsApp"
      >
        <MessageCircle className="w-7 h-7" />
        <span className="absolute top-0 right-0 w-4 h-4 rounded-full bg-amber-400 border-2 border-white flex items-center justify-center text-[9px] font-bold text-slate-950">
          1
        </span>
      </button>
    </div>
  );
}
