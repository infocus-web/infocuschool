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
import WhatsAppFloating from './components/WhatsAppFloating';
import AdminModal from './components/AdminModal';
import { InscripcionFamilia } from './services/inscripcionesService';

export default function App() {
  const [familiasModalOpen, setFamiliasModalOpen] = useState(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      return Boolean(search.get('mp_status') && search.get('pedido_id'));
    }
    return false;
  });
  const [inscripcionModalOpen, setInscripcionModalOpen] = useState(false);
  const [selectedColegioId, setSelectedColegioId] = useState<string | undefined>(undefined);
  const [selectedKitId, setSelectedKitId] = useState<string | undefined>(undefined);
  const [selectedCodigo, setSelectedCodigo] = useState<string | undefined>(undefined);
  const [adminModalOpen, setAdminModalOpen] = useState(false);

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

      {/* Floating Interactive WhatsApp Widget */}
      <WhatsAppFloating />

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
      />
    </div>
  );
}
