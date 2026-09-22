import { useState } from 'react';
import Header from './components/Header';
import Hero from './components/Hero';
import ProcesoSection from './components/ProcesoSection';
import MuestrarioSection from './components/MuestrarioSection';
import FaqSection from './components/FaqSection';
import ContactoSection from './components/ContactoSection';
import Footer from './components/Footer';
import PortalFamiliasModal from './components/PortalFamiliasModal';
import ModalInscripcionFamilia from './components/ModalInscripcionFamilia';
import AdminModal from './components/AdminModal';
import EscaneoPedidoModal from './components/EscaneoPedidoModal';
import { InscripcionFamilia } from './services/inscripcionesService';

export default function App() {
  const [familiasModalOpen, setFamiliasModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      return Boolean(search.get('mp_status') && search.get('pedido_id'));
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
  const [inscripcionModalOpen, setInscripcionModalOpen] = useState(false);
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

  const handleOpenInscripcion = () => {
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
      <PortalFamiliasModal
        isOpen={familiasModalOpen}
        onClose={() => setFamiliasModalOpen(false)}
        preselectedColegioId={selectedColegioId}
        preselectedKitId={selectedKitId}
        preselectedCodigo={selectedCodigo}
        onOpenInscripcion={handleOpenInscripcion}
      />

      {/* Registration Modal for Families */}
      <ModalInscripcionFamilia
        isOpen={inscripcionModalOpen}
        onClose={() => setInscripcionModalOpen(false)}
        onInscripcionExitosa={handleInscripcionExitosa}
      />

      {/* Photographer Admin Panel Modal */}
      <AdminModal
        isOpen={adminModalOpen}
        onClose={() => setAdminModalOpen(false)}
        onProbarCodigo={(cod) => {
          setAdminModalOpen(false);
          handleOpenFamilias('col-inicial-2026', cod);
        }}
        tabInicial={typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('zoho') ? 'zoho' : undefined}
      />

      {/* Pantalla de un solo pedido para cuando se escanea el QR pegado en el sobre físico del
          laboratorio (ver AdminLaboratorioTab.tsx, botón QR) — no reemplaza al panel completo. */}
      {escaneoModalOpen && escaneoPedidoId && (
        <EscaneoPedidoModal pedidoId={escaneoPedidoId} onClose={() => setEscaneoModalOpen(false)} />
      )}
    </div>
  );
}
