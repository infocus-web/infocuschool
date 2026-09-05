import React, { useState } from 'react';
import { X, Printer, Copy, Check, Send, Download, FileText, School, Scissors } from 'lucide-react';
import { SeccionEscolar } from '../data/alumnosData';
import { generarMensajeWhatsApp } from '../services/difusionEscolarService';

interface CircularImprimibleModalProps {
  isOpen: boolean;
  onClose: () => void;
  secciones: SeccionEscolar[];
  codigosMap: Record<string, string>;
  colegioNombre?: string;
  seccionSeleccionadaInicial?: string;
}

export function CircularImprimibleModal({
  isOpen,
  onClose,
  secciones,
  codigosMap,
  colegioNombre = 'Instituto Superior Buenos Aires',
  seccionSeleccionadaInicial,
}: CircularImprimibleModalProps) {
  const [seccionFiltro, setSeccionFiltro] = useState<string>(seccionSeleccionadaInicial || 'todas');
  const [formato, setFormato] = useState<'talones' | 'circular' | 'whatsapp'>('talones');
  const [copiadoIdx, setCopiadoIdx] = useState<string | null>(null);

  if (!isOpen) return null;

  const seccionesFiltradas = seccionFiltro === 'todas'
    ? secciones
    : secciones.filter(s => s.id === seccionFiltro);

  const handlePrint = () => {
    window.print();
  };

  const handleCopiar = (texto: string, id: string) => {
    navigator.clipboard.writeText(texto);
    setCopiadoIdx(id);
    setTimeout(() => setCopiadoIdx(null), 2500);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 bg-slate-950/80 backdrop-blur-xs overflow-y-auto">
      {/* Print stylesheet to isolate print output */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          #zona-impresion-circular, #zona-impresion-circular * {
            visibility: visible;
          }
          #zona-impresion-circular {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white !important;
            padding: 0 !important;
            margin: 0 !important;
          }
          .no-imprimir {
            display: none !important;
          }
          .talon-cuaderno {
            page-break-inside: avoid;
            border: 1.5px dashed #64748b !important;
            margin-bottom: 16px !important;
          }
        }
      `}</style>

      <div className="relative w-full max-w-4xl bg-white rounded-3xl shadow-2xl border border-slate-200 overflow-hidden my-auto max-h-[95vh] flex flex-col">
        {/* Header (No print) */}
        <div className="no-imprimir p-5 sm:p-6 bg-slate-900 text-white flex items-center justify-between gap-4 border-b border-slate-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-amber-400 text-slate-950 flex items-center justify-center font-bold shadow-md shrink-0">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-black text-white font-['Outfit'] flex items-center gap-2">
                <span>Comunicaciones Escolares Listas para Familias</span>
                <span className="text-[10px] bg-amber-400 text-slate-950 px-2 py-0.5 rounded-full font-bold">
                  WhatsApp & Notas
                </span>
              </h3>
              <p className="text-xs text-slate-300">
                {colegioNombre} · Textos claros, sin códigos raros ni planillas técnicas
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Toolbar Controls (No print) */}
        <div className="no-imprimir p-4 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3 text-xs">
          <div className="flex items-center gap-2">
            <label className="font-bold text-slate-700">Ver formato:</label>
            <div className="flex bg-slate-200 p-1 rounded-xl">
              <button
                type="button"
                onClick={() => setFormato('talones')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  formato === 'talones' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Scissors className="w-3.5 h-3.5 text-amber-600" />
                <span>Talones Cuaderno (4 por hoja)</span>
              </button>
              <button
                type="button"
                onClick={() => setFormato('whatsapp')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  formato === 'whatsapp' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Send className="w-3.5 h-3.5 text-emerald-600" />
                <span>Textos para WhatsApp</span>
              </button>
              <button
                type="button"
                onClick={() => setFormato('circular')}
                className={`px-3 py-1.5 rounded-lg font-bold transition-all cursor-pointer flex items-center gap-1.5 ${
                  formato === 'circular' ? 'bg-white text-slate-950 shadow-xs' : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <School className="w-3.5 h-3.5 text-blue-600" />
                <span>Circular A4 Cartelera</span>
              </button>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <select
              value={seccionFiltro}
              onChange={(e) => setSeccionFiltro(e.target.value)}
              className="px-3 py-1.5 rounded-xl border border-slate-300 font-bold bg-white text-slate-800"
            >
              <option value="todas">Todos los Cursos ({secciones.length})</option>
              {secciones.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.nombreCompleto} ({codigosMap[s.id] || s.id})
                </option>
              ))}
            </select>

            <button
              type="button"
              onClick={handlePrint}
              className="px-4 py-1.5 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl flex items-center gap-1.5 shadow-xs transition-colors cursor-pointer"
            >
              <Printer className="w-4 h-4 text-amber-400" />
              <span>Imprimir / Guardar en PDF</span>
            </button>
          </div>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-4 sm:p-6 bg-slate-100">
          <div id="zona-impresion-circular" className="space-y-6">

            {/* FORMATO 1: TALONES RECORTABLES PARA CUADERNO DE COMUNICACIONES */}
            {formato === 'talones' && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {seccionesFiltradas.map((sec) => {
                  const code = codigosMap[sec.id] || sec.id;
                  return (
                    <div
                      key={sec.id}
                      className="talon-cuaderno bg-white p-5 rounded-2xl border-2 border-dashed border-slate-300 relative text-left shadow-xs space-y-3"
                    >
                      {/* Cut line helper (no print badge) */}
                      <div className="flex items-center justify-between text-[10px] text-slate-400 font-bold uppercase tracking-wider pb-1 border-b border-slate-100">
                        <span className="flex items-center gap-1">
                          <Scissors className="w-3 h-3 text-slate-400" />
                          <span>Cortar por la línea de puntos</span>
                        </span>
                        <span>{sec.nombreCompleto}</span>
                      </div>

                      {/* Card Content */}
                      <div className="space-y-1">
                        <div className="text-[11px] font-bold uppercase tracking-wider text-amber-600">
                          {colegioNombre}
                        </div>
                        <h4 className="text-sm font-black text-slate-900 font-['Outfit']">
                          FOTOGRAFÍAS ESCOLARES 2026
                        </h4>
                        <p className="text-xs text-slate-600 font-medium">
                          <strong>Sala / Curso:</strong> {sec.nombreCompleto} (Turno {sec.turno} · Div. {sec.division})
                        </p>
                      </div>

                      {/* Big Code Highlight */}
                      <div className="p-3 bg-amber-50 border-2 border-amber-300 rounded-xl text-center space-y-0.5">
                        <span className="text-[10px] uppercase font-extrabold text-amber-800 tracking-wider block">
                          CÓDIGO DE ACCESO EXCLUSIVO:
                        </span>
                        <span className="text-xl sm:text-2xl font-black font-mono tracking-widest text-slate-950 block">
                          {code}
                        </span>
                        <span className="text-[10px] text-amber-900 font-semibold block">
                          Ingresar en: <strong>retratoescolar.com.ar</strong>
                        </span>
                      </div>

                      {/* Instructions */}
                      <div className="text-[11px] text-slate-600 space-y-1 bg-slate-50 p-2.5 rounded-xl border border-slate-200">
                        <p className="font-bold text-slate-800">Pasos para la familia:</p>
                        <ol className="list-decimal list-inside space-y-0.5">
                          <li>Ingresar a la web y colocar el código <strong>{code}</strong>.</li>
                          <li>Buscar el nombre del alumno/a en la nómina de la sala.</li>
                          <li>Elegir las <strong>3 fotos incluidas</strong> (Individual, Grupal, Docente).</li>
                          <li>Confirmar pedido (impreso en laboratorio o digital HD).</li>
                        </ol>
                      </div>

                      <div className="text-[10px] text-slate-400 text-center font-medium pt-1">
                        Fotos protegidas con marca de agua · Entrega oficial a través de la institución
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* FORMATO 2: MENSAJES DE WHATSAPP DIRECTOS */}
            {formato === 'whatsapp' && (
              <div className="space-y-4">
                {seccionesFiltradas.map((sec) => {
                  const code = codigosMap[sec.id] || sec.id;
                  const mensaje = generarMensajeWhatsApp(sec, code, colegioNombre);
                  const isCopiado = copiadoIdx === sec.id;

                  return (
                    <div
                      key={sec.id}
                      className="bg-white rounded-2xl border border-slate-200 shadow-xs p-5 space-y-3 text-left"
                    >
                      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-100 pb-3">
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500"></span>
                            <h4 className="text-sm font-bold text-slate-900 font-['Outfit']">
                              {sec.nombreCompleto}
                            </h4>
                          </div>
                          <p className="text-xs text-slate-500 mt-0.5">
                            {sec.sala} · Turno {sec.turno} · {sec.totalAlumnos} alumnos
                          </p>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <span className="px-3 py-1 bg-amber-100 text-amber-900 font-mono font-black text-xs rounded-xl border border-amber-300">
                            CÓDIGO: {code}
                          </span>

                          <button
                            type="button"
                            onClick={() => handleCopiar(mensaje, sec.id)}
                            className={`px-3 py-1.5 rounded-xl font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer ${
                              isCopiado
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-100 hover:bg-slate-200 text-slate-700'
                            }`}
                          >
                            {isCopiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                            <span>{isCopiado ? '¡Copiado!' : 'Copiar Texto'}</span>
                          </button>

                          <a
                            href={`https://wa.me/?text=${encodeURIComponent(mensaje)}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs rounded-xl flex items-center gap-1.5 shadow-xs transition-colors"
                          >
                            <Send className="w-3.5 h-3.5" />
                            <span>Abrir en WhatsApp</span>
                          </a>
                        </div>
                      </div>

                      {/* WhatsApp styled bubble preview */}
                      <div className="bg-emerald-50/70 border border-emerald-200/80 rounded-2xl p-4 font-sans text-xs text-slate-800 whitespace-pre-wrap leading-relaxed">
                        {mensaje}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* FORMATO 3: CIRCULAR A4 CARTELERA */}
            {formato === 'circular' && (
              <div className="space-y-6">
                {seccionesFiltradas.map((sec) => {
                  const code = codigosMap[sec.id] || sec.id;
                  return (
                    <div
                      key={sec.id}
                      className="bg-white p-8 rounded-3xl border border-slate-300 shadow-md text-left space-y-6 max-w-2xl mx-auto"
                    >
                      <div className="text-center space-y-2 border-b border-slate-200 pb-5">
                        <span className="text-xs font-bold uppercase tracking-widest text-amber-600">
                          COMUNICADO OFICIAL DE FOTOGRAFÍA ESCOLAR
                        </span>
                        <h3 className="text-2xl font-black text-slate-900 font-['Outfit']">
                          {colegioNombre}
                        </h3>
                        <p className="text-sm font-semibold text-slate-600">
                          {sec.nombreCompleto} · Ciclo Lectivo 2026
                        </p>
                      </div>

                      <div className="space-y-3 text-xs text-slate-700 leading-relaxed">
                        <p>
                          <strong>Estimadas Familias:</strong>
                        </p>
                        <p>
                          Les comunicamos que ya se encuentra habilitada la plataforma virtual de selección fotográfica. Cada familia podrá acceder de forma privada y segura al catálogo de muestras protegidas de la sala para elegir las fotografías de recuerdo de su hijo/a.
                        </p>
                      </div>

                      <div className="p-5 bg-gradient-to-br from-amber-50 to-amber-100/60 border-2 border-amber-300 rounded-2xl text-center space-y-1">
                        <span className="text-xs font-bold text-amber-900 uppercase tracking-wider block">
                          CÓDIGO DE ACCESO ASIGNADO AL CURSO
                        </span>
                        <span className="text-3xl font-black font-mono tracking-widest text-slate-950 block py-1">
                          {code}
                        </span>
                        <span className="text-xs font-medium text-amber-950 block">
                          Acceso online en: <strong>https://retratoescolar.com.ar</strong>
                        </span>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-center text-xs">
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="font-bold text-slate-900 block mb-1">1. Ingreso Seguro</span>
                          <span className="text-slate-500 text-[11px]">Colocar el código del curso y elegir al alumno</span>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="font-bold text-slate-900 block mb-1">2. Selección de Fotos</span>
                          <span className="text-slate-500 text-[11px]">Elegir las 3 tomas incluidas en el paquete</span>
                        </div>
                        <div className="p-3 bg-slate-50 rounded-xl border border-slate-200">
                          <span className="font-bold text-slate-900 block mb-1">3. Entrega Garantizada</span>
                          <span className="text-slate-500 text-[11px]">Impresiones en sobre o descarga digital HD</span>
                        </div>
                      </div>

                      <div className="pt-4 border-t border-slate-200 text-center text-xs text-slate-400">
                        Equipo de Fotografía Escolar · InFocus Escuelas
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

          </div>
        </div>

        {/* Footer (No print) */}
        <div className="no-imprimir p-4 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 text-xs">
          <span className="text-slate-500 font-medium">
            💡 <strong>Consejo:</strong> Usá el botón "Imprimir / Guardar en PDF" del navegador para imprimir en papel o guardar como PDF y enviar a las familias.
          </span>
          <button
            type="button"
            onClick={onClose}
            className="px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white font-bold rounded-xl transition-colors cursor-pointer"
          >
            Cerrar Ventana
          </button>
        </div>
      </div>
    </div>
  );
}
