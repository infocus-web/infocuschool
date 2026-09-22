import { Camera, Heart, ShieldCheck, Mail, MapPin, Lock } from 'lucide-react';
import RetratoEscolarLogo from './RetratoEscolarLogo';

interface FooterProps {
  onOpenFamilias: () => void;
  onScrollTo: (id: string) => void;
  onOpenAdmin?: () => void;
}

export default function Footer({ onOpenFamilias, onScrollTo, onOpenAdmin }: FooterProps) {
  return (
    <footer className="bg-slate-900 text-slate-400 text-xs border-t border-slate-800 pt-16 pb-12">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-10 pb-12 border-b border-slate-800 text-left">
          {/* Brand Info */}
          <div className="space-y-4">
            <div className="text-white">
              <RetratoEscolarLogo variant="full" theme="dark" size="md" />
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
                href="mailto:colegios@contacto.retratoescolar.com.ar"
                className="flex items-center gap-2 hover:text-sky-400 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-sky-400 shrink-0" />
                <span className="truncate">colegios@contacto.retratoescolar.com.ar</span>
              </a>
            </div>
          </div>
        </div>

        {/* Bottom bar */}
        <div className="pt-8 flex flex-col sm:flex-row items-center justify-between gap-4 text-slate-500">
          <p>© {new Date().getFullYear()} Retrato Escolar · retratoescolar.com.ar. Portal de Familias.</p>
          <div className="flex flex-wrap items-center justify-center sm:justify-start gap-x-4 gap-y-2 text-[11px]">
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
