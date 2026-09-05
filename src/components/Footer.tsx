import { Camera, Heart, ShieldCheck, PhoneCall, Mail, MapPin, Lock } from 'lucide-react';
import { useWhatsAppConfig, formatearNumeroVisual } from '../services/configuracionService';

interface FooterProps {
  onOpenFamilias: () => void;
  onScrollTo: (id: string) => void;
  onOpenAdmin?: () => void;
}

export default function Footer({ onOpenFamilias, onScrollTo, onOpenAdmin }: FooterProps) {
  const { config } = useWhatsAppConfig();
  const whatsappNum = config.whatsappFlotante || config.whatsappSolicitudCodigo || '5491128625916';
  const displayNum = formatearNumeroVisual(whatsappNum);

  return (
    <footer className="bg-slate-900 text-slate-400 text-xs border-t border-slate-800 pt-16 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-slate-800 text-left">
          {/* Brand Info */}
          <div className="space-y-4">
            <div className="flex items-center gap-2.5 text-white">
              <div className="w-9 h-9 rounded-xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold">
                <Camera className="w-5 h-5 stroke-[2.2]" />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-xl font-extrabold tracking-tight font-['Outfit']">
                  Retrato<span className="text-amber-400">Escolar</span>
                </span>
                <span className="text-[9px] uppercase font-bold px-1.5 py-0.5 rounded bg-slate-800 text-amber-300 border border-slate-700">
                  .com.ar
                </span>
              </div>
            </div>

            <p className="text-slate-400 leading-relaxed">
              Portal fotográfico escolar exclusivo para familias en <strong>retratoescolar.com.ar</strong>. Selección de tomas online, pago digital seguro y descarga inmediata de fotos en alta definición.
            </p>

            <div className="flex items-center gap-2 text-slate-300 font-medium">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Transacciones seguras con Mercado Pago y Transferencia</span>
            </div>
          </div>

          {/* Families Links */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              Acceso Familias
            </p>
            <ul className="space-y-2">
              <li>
                <button
                  onClick={() => onOpenFamilias()}
                  className="hover:text-amber-400 transition-colors cursor-pointer font-bold text-amber-400"
                >
                  Ver Fotos de mi Hijo/a
                </button>
              </li>
              <li>
                <button
                  onClick={() => onScrollTo('proceso')}
                  className="hover:text-amber-400 transition-colors cursor-pointer"
                >
                  Cómo Funciona el Acceso
                </button>
              </li>
              <li>
                <button
                  onClick={() => onScrollTo('muestrario')}
                  className="hover:text-amber-400 transition-colors cursor-pointer"
                >
                  Kits y Formatos Disponibles
                </button>
              </li>
              <li>
                <button
                  onClick={() => onScrollTo('faq')}
                  className="hover:text-amber-400 transition-colors cursor-pointer"
                >
                  Preguntas Frecuentes
                </button>
              </li>
            </ul>
          </div>

          {/* Kits & Quality */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              Formatos y Productos
            </p>
            <ul className="space-y-2 text-slate-400">
              <li>
                <span className="text-slate-300 font-medium">Kit Impreso + Digital ($30.000)</span>
                <p className="text-[11px] text-slate-500">20x30 + 15x21 + carpeta + HD de regalo</p>
              </li>
              <li>
                <span className="text-slate-300 font-medium">Solo Digital HD ($15.000)</span>
                <p className="text-[11px] text-slate-500">3 fotos en máxima resolución sin marcas</p>
              </li>
              <li>
                <span className="text-slate-300 font-medium">Fotos Sueltas de Actos ($5.000)</span>
                <p className="text-[11px] text-slate-500">Galería opcional por evento del año</p>
              </li>
            </ul>
          </div>

          {/* Zones & Contact */}
          <div className="space-y-3">
            <p className="text-xs font-bold text-white uppercase tracking-wider">
              Atención y Contacto
            </p>
            <div className="space-y-2 text-slate-400">
              <p className="flex items-center gap-2">
                <MapPin className="w-3.5 h-3.5 text-amber-400 shrink-0" />
                <span>Buenos Aires, Argentina</span>
              </p>
              <a
                href={`https://wa.me/${whatsappNum}?text=Hola%20Retrato%20Escolar,%20tengo%20una%20consulta%20sobre%20las%20fotos%20de%20mi%20hijo/a`}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 hover:text-emerald-400 transition-colors"
              >
                <PhoneCall className="w-3.5 h-3.5 text-emerald-400 shrink-0" />
                <span>WhatsApp: {displayNum}</span>
              </a>
              <a
                href="mailto:infocusfotografiayvideo@gmail.com"
                className="flex items-center gap-2 hover:text-sky-400 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">infocusfotografiayvideo@gmail.com</span>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500">
          <p>© {new Date().getFullYear()} Retrato Escolar · retratoescolar.com.ar. Portal de Familias.</p>
          <div className="flex items-center gap-4 text-[11px]">
            <span>Defensa del Consumidor</span>
            <span>·</span>
            <span>Privacidad y Protección de Menores</span>
            {onOpenAdmin && (
              <>
                <span>·</span>
                <button
                  onClick={onOpenAdmin}
                  className="text-slate-400 hover:text-amber-400 flex items-center gap-1 cursor-pointer transition-colors"
                >
                  <Lock className="w-3 h-3" />
                  <span>Panel Fotógrafo</span>
                </button>
              </>
            )}
            <span>·</span>
            <span className="flex items-center gap-1 text-slate-400">
              Hecho con <Heart className="w-3 h-3 text-red-500 fill-red-500" /> en Argentina
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
