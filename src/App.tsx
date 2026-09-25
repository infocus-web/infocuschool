import { lazy, Suspense, useState } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import ProcesoSection from './components/ProcesoSection';
import MuestrarioSection from './components/MuestrarioSection';
import FaqSection from './components/FaqSection';
import ContactoSection from './components/ContactoSection';
import Footer from './components/Footer';
import PortalFamiliasModal from './components/PortalFamiliasModal';
import ModalInscripcionFamilia from './components/ModalInscripcionFamilia';
// Preparación temporada (25/9): el panel de administración (planillas Excel, laboratorio, etc.) y
// la pantalla de escaneo de QR se cargan sólo cuando se abren. Antes viajaban dentro del mismo
// archivo que descarga cada familia (~1,5 MB), lo que demoraba la carga en celulares con poca señal.
const AdminModal = lazy(() => import('./components/AdminModal'));
const EscaneoPedidoModal = lazy(() => import('./components/EscaneoPedidoModal'));
import ErrorBoundary from './components/ErrorBoundary';
import ReporteErrorPopup from './components/ReporteErrorPopup';
import ReservaRetorno from './components/ReservaRetorno';
import { InscripcionFamilia } from './services/inscripcionesService';

export default function App() {
  const [familiasModalOpen, setFamiliasModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      // Auditoría 2026-09-23 (bug real): sólo se abría el portal al volver de Mercado Pago con UN
      // pedido (`pedido_id`). Al volver de Nave (`nave_status`) o de un carrito de varios hijos
      // (`grupo_pago_id`), el portal procesaba la vuelta pero quedaba cerrado: la familia volvía a
      // la home sin ver ninguna confirmación de su pago.
      const search = new URLSearchParams(window.location.search);
      if (search.get('reserva') === '1') return false; // pago anticipado: ver ReservaRetorno
      return Boolean((search.get('mp_status') || search.get('nave_status')) && (search.get('pedido_id') || search.get('grupo_pago_id')));
    }
    return false;
  });
  // Auditoría 2026-09-21 (pedido de Pablo: escanear con el celular el QR pegado en el sobre del
  // laboratorio). El QR apunta a "/?escaneo=<uuid del pedido>" — se detecta ese parámetro al
  // cargar la página y se abre directo esta pantalla chica de un solo pedido, en vez del panel
  // completo (pensado para pantallas de escritorio, no para un vistazo rápido desde el celular).
  const [escaneoPedidoId] = useState<string | null>(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).get('escaneo');
    }
    return null;
  });
  const [escaneoModalOpen, setEscaneoModalOpen] = useState(Boolean(escaneoPedidoId));
  // Vuelta de Mercado Pago / Nave después de pagar un kit por adelantado ("?reserva=1").
  const [reservaRetornoId, setReservaRetornoId] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    const search = new URLSearchParams(window.location.search);
    return search.get('reserva') === '1' ? search.get('grupo_pago_id') : null;
  });
  const [inscripcionModalOpen, setInscripcionModalOpen] = useState(false);
  const [portalEnGaleria, setPortalEnGaleria] = useState(false);
  // Auditoría 2026-09-22 (pedido de Pablo: el link "¿Ya te inscribiste? Consultar código" de
  // Hero.tsx abría el modal siempre en la pestaña "Inscribirme", igual que el botón de alta
  // "Anotarme con mis hijos" — quien ya se había inscripto terminaba en el formulario equivocado).
  const [inscripcionModalTab, setInscripcionModalTab] = useState<'registro' | 'login'>('registro');
  const [selectedColegioId, setSelectedColegioId] = useState<string | undefined>(undefined);
  const [selectedKitId, setSelectedKitId] = useState<string | undefined>(undefined);
  const [selectedCodigo, setSelectedCodigo] = useState<string | undefined>(undefined);
  // Auditoría 2026-09-22 (integración Zoho Mail para la campaña de prospección a colegios): el
  // servidor redirige acá con "?zoho=conectado" o "?zoho=error" después del OAuth con Zoho — se
  // detecta al cargar para reabrir el panel directo en la pestaña de la campaña, en vez de que
  // Pablo tenga que loguearse y navegar de nuevo hasta ahí a mano.
  const [adminModalOpen, setAdminModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      return new URLSearchParams(window.location.search).has('zoho');
    }
    return false;
  });

  const handleOpenFamilias = (colegioId?: string, codigo?: string) => {
    setSelectedColegioId(colegioId);
    setSelectedCodigo(codigo);
    setFamiliasModalOpen(true);
  };

  // Auditoría 2026-09-23 (bug real, ALTO): varios botones hacían `onClick={onOpenInscripcion}`, así
  // que React pasaba el evento del clic como `tab`. `tab || 'registro'` quedaba con ese objeto, y
  // el modal (que no lo reconocía) caía al formulario de "Ya me inscribí": el botón principal
  // "Inscribirme" nunca mostraba el formulario de inscripción. Sólo se acepta 'login' explícito.
  const handleOpenInscripcion = (tab?: unknown) => {
    setInscripcionModalTab(tab === 'login' ? 'login' : 'registro');
    setInscripcionModalOpen(true);
  };

  const handleInscripcionExitosa = (familia: InscripcionFamilia, codigoCurso?: string) => {
    setInscripcionModalOpen(false);
    if (familia.colegioId) {
      setSelectedColegioId(familia.colegioId);
    }
    if (codigoCurso) {
      setSelectedCodigo(codigoCurso);
    }
    setFamiliasModalOpen(true);
  };

  const handleSelectKit = (kitId: string) => {
    setSelectedKitId(kitId);
    setFamiliasModalOpen(true);
  };

  const handleScrollTo = (id: string) => {
    const el = document.getElementById(id);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900 flex flex-col font-['Plus_Jakarta_Sans',sans-serif]">
      {/* Navigation Header */}
      <Header
        onOpenFamilias={handleOpenFamilias}
        onOpenInscripcion={handleOpenInscripcion}
        onScrollTo={handleScrollTo}
        onOpenAdmin={() => setAdminModalOpen(true)}
      />

      {reservaRetornoId && (
        <ReservaRetorno
          grupoPagoId={reservaRetornoId}
          onCerrar={() => {
            setReservaRetornoId(null);
            window.history.replaceState({}, '', window.location.pathname);
          }}
          onElegirOtroMedio={() => {
            setReservaRetornoId(null);
            window.history.replaceState({}, '', window.location.pathname);
            setPortalEnGaleria(true);
            setFamiliasModalOpen(true);
          }}
        />
      )}

      {/* Main Sections */}
      <main className="flex-1">
        {/* Hero with inscription CTA, school search & sample watermark viewer */}
        <Hero
          onOpenFamilias={handleOpenFamilias}
          onOpenInscripcion={handleOpenInscripcion}
        />

        {/* How it Works / 5-Step Process */}
        <ProcesoSection
          onOpenFamilias={() => handleOpenFamilias()}
          onOpenInscripcion={handleOpenInscripcion}
        />

        {/* Physical Products, Prints, Watermark Showcase & Pricing Kits */}
        <MuestrarioSection onSelectKit={handleSelectKit} />

        {/* FAQ with Familias questions */}
        <FaqSection />

        {/* Contact Form & Coverage Zones */}
        <ContactoSection />
      </main>

      {/* Footer */}
      <Footer
        onOpenFamilias={() => handleOpenFamilias()}
        onScrollTo={handleScrollTo}
        onOpenAdmin={() => setAdminModalOpen(true)}
      />


      {/* Interactive Family Portal Modal ("InFocus Schools") */}
      {/* Cada modal va dentro de su propio ErrorBoundary: si uno falla, se muestra un aviso con
          salida en vez de dejar toda la página en blanco. */}
      <ErrorBoundary variante="modal" onCerrar={() => setFamiliasModalOpen(false)}>
        <PortalFamiliasModal
          isOpen={familiasModalOpen}
          onClose={() => {
            setFamiliasModalOpen(false);
            setPortalEnGaleria(false);
          }}
          abrirEnGaleria={portalEnGaleria}
          preselectedColegioId={selectedColegioId}
          preselectedKitId={selectedKitId}
          preselectedCodigo={selectedCodigo}
          onOpenInscripcion={handleOpenInscripcion}
        />
      </ErrorBoundary>

      {/* Registration Modal for Families */}
      <ErrorBoundary variante="modal" onCerrar={() => setInscripcionModalOpen(false)}>
        <ModalInscripcionFamilia
          isOpen={inscripcionModalOpen}
          onClose={() => setInscripcionModalOpen(false)}
          onInscripcionExitosa={handleInscripcionExitosa}
          initialTab={inscripcionModalTab}
        />
      </ErrorBoundary>

      {/* Photographer Admin Panel Modal */}
      {adminModalOpen && (
      <ErrorBoundary variante="modal" onCerrar={() => setAdminModalOpen(false)}>
        <Suspense fallback={<div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 text-sm font-bold text-white">Cargando panel…</div>}>
        <AdminModal
          isOpen={adminModalOpen}
          onClose={() => setAdminModalOpen(false)}
          onProbarCodigo={(cod) => {
            setAdminModalOpen(false);
            handleOpenFamilias('col-inicial-2026', cod);
          }}
          tabInicial={typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('zoho') ? 'zoho' : undefined}
        />
        </Suspense>
      </ErrorBoundary>
      )}

      {/* Pantalla de un solo pedido para cuando se escanea el QR pegado en el sobre físico del
          laboratorio (ver AdminLaboratorioTab.tsx, botón QR) — no reemplaza al panel completo. */}
      {escaneoModalOpen && escaneoPedidoId && (
        <ErrorBoundary variante="modal" onCerrar={() => setEscaneoModalOpen(false)}>
          <Suspense fallback={null}>
            <EscaneoPedidoModal pedidoId={escaneoPedidoId} onClose={() => setEscaneoModalOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}

      {/* Aviso "Avisar al equipo técnico" cuando el servidor falla (ver services/reporteErrores.ts). */}
      <ReporteErrorPopup />
    </div>
  );
}
