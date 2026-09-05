import { useState } from 'react';
import { Camera, Search, Menu, X, PhoneCall, Lock, Sparkles, UserPlus } from 'lucide-react';
import { useWhatsAppConfig } from '../services/configuracionService';
import RetratoEscolarLogo from './RetratoEscolarLogo';

interface HeaderProps {
  onOpenFamilias: (colegioId?: string) => void;
  onScrollTo: (id: string) => void;
  onOpenAdmin?: () => void;
  onOpenInscripcion?: () => void;
}

export default function Header({
  onOpenFamilias,
  onScrollTo,
  onOpenAdmin,
  onOpenInscripcion,
}: HeaderProps) {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const { config } = useWhatsAppConfig();
  const whatsappNum = config.whatsappFlotante || config.whatsappSolicitudCodigo || '5491128625916';

  const handleNavClick = (id: string) => {
    onScrollTo(id);
    setMobileMenuOpen(false);
  };

  return (
    <header className="sticky top-0 z-40 bg-white/95 backdrop-blur-md border-b border-slate-200/80 shadow-xs">
      {/* Top micro-bar */}
      <div className="bg-slate-900 text-slate-300 text-xs py-1.5 px-4 hidden sm:block">
        <div className="max-w-7xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="inline-block w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            <span>Portal de Familias · Ciclo Escolar 2026 activo</span>
          </div>
          <div className="flex items-center gap-4 text-slate-300">
            {onOpenAdmin && (
              <>
                <button
                  onClick={onOpenAdmin}
                  className="flex items-center gap-1 text-slate-300 hover:text-amber-400 transition-colors cursor-pointer"
                >
                  <Lock className="w-3 h-3" />
                  <span>Panel Fotógrafo</span>
                </button>
                <span className="text-slate-600">|</span>
              </>
            )}
            <a
              href={`https://wa.me/${whatsappNum}?text=Hola%20Retrato%20Escolar,%20quisiera%20hacer%20una%20consulta%20sobre%20las%20fotos%20de%20mi%20hijo/a`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1 text-emerald-400 hover:text-emerald-300 transition-colors"
            >
              <PhoneCall className="w-3.5 h-3.5" />
              <span>Atención Familias por WhatsApp</span>
            </a>
          </div>
        </div>
      </div>

      {/* Main Navbar */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-18">
          {/* Brand Logo - Official Retrato Escolar Branding */}
          <div
            id="brand-logo"
            onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
            className="flex items-center cursor-pointer group py-1"
            title="Retrato Escolar - retratoescolar.com.ar"
          >
            <RetratoEscolarLogo variant="full" size="md" />
          </div>

          {/* Desktop Nav Links */}
          <nav className="hidden md:flex items-center gap-7 text-sm font-medium text-slate-600">
            <button
              id="nav-proceso"
              onClick={() => handleNavClick('proceso')}
              className="hover:text-slate-900 transition-colors cursor-pointer py-1"
            >
              Cómo Funciona
            </button>
            <button
              id="nav-muestrario"
              onClick={() => handleNavClick('muestrario')}
              className="hover:text-slate-900 transition-colors cursor-pointer py-1"
            >
              Kits y Formatos
            </button>
            <button
              id="nav-faq"
              onClick={() => handleNavClick('faq')}
              className="hover:text-slate-900 transition-colors cursor-pointer py-1"
            >
              Preguntas Frecuentes
            </button>
            <button
              id="nav-contacto"
              onClick={() => handleNavClick('contacto')}
              className="hover:text-slate-900 transition-colors cursor-pointer py-1"
            >
              Ayuda y Contacto
            </button>
          </nav>

          {/* Desktop Actions */}
          <div className="hidden sm:flex items-center gap-2.5">
            {onOpenInscripcion && (
              <button
                id="btn-inscribirme-header"
                onClick={onOpenInscripcion}
                className="px-4 py-2.5 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-xl shadow-xs shadow-amber-400/30 transition-all flex items-center gap-1.5 cursor-pointer active:scale-98"
              >
                <UserPlus className="w-4 h-4" />
                <span>Inscribirme</span>
              </button>
            )}
            <button
              id="btn-acceso-familias-header"
              onClick={() => onOpenFamilias()}
              className="px-4 py-2.5 text-xs font-bold text-slate-700 hover:text-slate-950 bg-slate-100 hover:bg-slate-200 border border-slate-200/80 rounded-xl transition-all flex items-center gap-1.5 cursor-pointer active:scale-98"
            >
              <Search className="w-4 h-4 text-slate-500" />
              <span>Acceder a las Fotos</span>
            </button>
          </div>

          {/* Mobile hamburger & quick actions */}
          <div className="flex md:hidden items-center gap-1.5">
            {onOpenInscripcion && (
              <button
                id="btn-inscribirme-mobile"
                onClick={onOpenInscripcion}
                className="px-2.5 py-1.5 text-xs font-extrabold text-slate-950 bg-amber-400 hover:bg-amber-300 rounded-lg shadow-xs flex items-center gap-1 cursor-pointer"
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>Inscribirme</span>
              </button>
            )}
            <button
              id="btn-acceso-familias-mobile"
              onClick={() => onOpenFamilias()}
              className="px-2.5 py-1.5 text-xs font-semibold text-slate-700 bg-slate-100 hover:bg-slate-200 border border-slate-200 rounded-lg shadow-xs flex items-center gap-1"
            >
              <Search className="w-3.5 h-3.5 text-slate-500" />
              <span>Fotos</span>
            </button>
            <button
              id="btn-toggle-menu"
              onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
              className="p-1.5 text-slate-600 hover:text-slate-900 rounded-lg hover:bg-slate-100 transition-colors"
              aria-label="Abrir menú"
            >
              {mobileMenuOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-slate-200 bg-white px-4 pt-3 pb-6 space-y-3 animate-in slide-in-from-top-2 duration-200">
          <nav className="flex flex-col space-y-2">
            <button
              onClick={() => handleNavClick('proceso')}
              className="text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-md"
            >
              Cómo Funciona
            </button>
            <button
              onClick={() => handleNavClick('muestrario')}
              className="text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-md"
            >
              Kits y Formatos
            </button>
            <button
              onClick={() => handleNavClick('faq')}
              className="text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-md"
            >
              Preguntas Frecuentes
            </button>
            <button
              onClick={() => handleNavClick('contacto')}
              className="text-left px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 rounded-md"
            >
              Ayuda y Contacto
            </button>
          </nav>
          <div className="pt-2 border-t border-slate-100 flex flex-col gap-2">
            {onOpenInscripcion && (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenInscripcion();
                }}
                className="w-full py-2.5 px-4 bg-amber-400 hover:bg-amber-300 text-slate-950 font-extrabold text-sm rounded-lg text-center flex items-center justify-center gap-2 cursor-pointer shadow-xs"
              >
                <UserPlus className="w-4 h-4" />
                <span>Inscribirme (Crear usuario)</span>
              </button>
            )}
            <button
              onClick={() => {
                setMobileMenuOpen(false);
                onOpenFamilias();
              }}
              className="w-full py-2 px-4 bg-slate-100 hover:bg-slate-200 text-slate-800 font-bold text-sm rounded-lg text-center flex items-center justify-center gap-2"
            >
              <Search className="w-4 h-4 text-slate-500" />
              <span>Acceder a las Fotos</span>
            </button>
            {onOpenAdmin && (
              <button
                onClick={() => {
                  setMobileMenuOpen(false);
                  onOpenAdmin();
                }}
                className="w-full py-2 px-4 bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold text-xs rounded-lg text-center flex items-center justify-center gap-2"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                <span>Acceso Fotógrafo (Admin)</span>
              </button>
            )}
          </div>
        </div>
      )}
    </header>
  );
}
