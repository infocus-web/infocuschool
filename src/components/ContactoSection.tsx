import { useState, type FormEvent } from 'react';
import { MapPin, Phone, Mail, Clock, Send, CheckCircle2, MessageCircle } from 'lucide-react';
import { useWhatsAppConfig, formatearNumeroVisual } from '../services/configuracionService';

export default function ContactoSection() {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [asunto, setAsunto] = useState('Consulta general');
  const [mensaje, setMensaje] = useState('');
  const [enviado, setEnviado] = useState(false);
  const { config } = useWhatsAppConfig();
  const whatsappNum = config.whatsappFlotante || config.whatsappSolicitudCodigo || '5491128625916';
  const displayNum = formatearNumeroVisual(whatsappNum);

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    setEnviado(true);
  };

  return (
    <section id="contacto" className="py-16 lg:py-24 bg-slate-50 border-b border-slate-200/80">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-12 text-left">
          {/* Contact Info Column */}
          <div className="lg:col-span-5 space-y-6">
            <div>
              <span className="text-xs font-bold text-amber-700 uppercase tracking-widest px-3 py-1 bg-amber-100 rounded-full border border-amber-200 inline-block mb-3">
                Atención y Cobertura
              </span>
              <h2 className="text-3xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-['Outfit']">
                Estamos para ayudarte
              </h2>
              <p className="text-sm text-slate-600 mt-2">
                Asistencia y soporte directo para las familias. Si tenés dudas sobre el código de acceso a tu curso, la selección de tomas o la descarga de tus fotos HD, escribinos.
              </p>
            </div>

            <div className="space-y-4 pt-2">
              <div className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <div className="w-9 h-9 rounded-xl bg-emerald-100 text-emerald-800 flex items-center justify-center shrink-0">
                  <MessageCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">WhatsApp Oficial</p>
                  <p className="text-xs text-slate-600 mt-0.5">{displayNum}</p>
                  <a
                    href={`https://wa.me/${whatsappNum}?text=Hola%20Retrato%20Escolar,%20quisiera%20hacer%20una%20consulta%20desde%20retratoescolar.com.ar`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] font-bold text-emerald-700 hover:underline block mt-1"
                  >
                    Chatear ahora por WhatsApp ›
                  </a>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Correo Electrónico</p>
                  <p className="text-xs text-slate-600 mt-0.5 font-medium">infocusfotografiayvideo@gmail.com</p>
                  <p className="text-[11px] text-slate-400">Respuesta promedio en menos de 2 hs</p>
                </div>
              </div>

              <div id="cobertura" className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <div className="w-9 h-9 rounded-xl bg-sky-100 text-sky-800 flex items-center justify-center shrink-0">
                  <MapPin className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Zonas de Cobertura Activa</p>
                  <p className="text-xs text-slate-600 mt-0.5">
                    CABA (todos los barrios), Zona Norte (Vicente López, San Isidro, San Fernando, Tigre), Zona Sur (Lomas, Adrogué, Quilmes) y Zona Oeste.
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs">
                <div className="w-9 h-9 rounded-xl bg-indigo-100 text-indigo-800 flex items-center justify-center shrink-0">
                  <Clock className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Horarios de Atención</p>
                  <p className="text-xs text-slate-600 mt-0.5">Lunes a Viernes de 8:00 a 19:00 hs</p>
                  <p className="text-[11px] text-slate-400">Guardia activa los fines de semana de entrega</p>
                </div>
              </div>
            </div>
          </div>

          {/* Form Column */}
          <div className="lg:col-span-7 bg-white p-6 sm:p-8 rounded-3xl border border-slate-200 shadow-lg">
            <h3 className="text-xl font-bold text-slate-900 font-['Outfit'] mb-1">
              Envianos tu mensaje
            </h3>
            <p className="text-xs text-slate-500 mb-6">
              Completá tus datos y te responderemos a la brevedad.
            </p>

            {enviado ? (
              <div className="py-12 text-center space-y-3">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-700 rounded-full flex items-center justify-center mx-auto">
                  <CheckCircle2 className="w-7 h-7" />
                </div>
                <h4 className="text-lg font-bold text-slate-900">¡Mensaje enviado con éxito!</h4>
                <p className="text-xs text-slate-600">
                  Muchas gracias por comunicarte con Retrato Escolar. Te escribiremos pronto a tu email o WhatsApp.
                </p>
                <button
                  onClick={() => setEnviado(false)}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl"
                >
                  Enviar otro mensaje
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Nombre y Apellido
                    </label>
                    <input
                      required
                      type="text"
                      value={nombre}
                      onChange={(e) => setNombre(e.target.value)}
                      placeholder="Tu nombre..."
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Teléfono / WhatsApp
                    </label>
                    <input
                      required
                      type="tel"
                      value={telefono}
                      onChange={(e) => setTelefono(e.target.value)}
                      placeholder="11 2345-6789"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      Email
                    </label>
                    <input
                      required
                      type="email"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="contacto@institucion.edu.ar"
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    />
                  </div>

                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">
                      ¿Sobre qué querés consultar?
                    </label>
                    <select
                      value={asunto}
                      onChange={(e) => setAsunto(e.target.value)}
                      className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400"
                    >
                      <option>Duda con el código de acceso a mi curso</option>
                      <option>Consulta sobre las fotos de mi hijo/a</option>
                      <option>Consulta sobre pagos o transferencias</option>
                      <option>Ayuda para descargar mis fotos en HD</option>
                      <option>Consulta sobre entrega de kit impreso</option>
                      <option>Otro motivo</option>
                    </select>
                  </div>
                </div>

                <div>
                  <label className="text-xs font-semibold text-slate-700 block mb-1">
                    Tu Mensaje
                  </label>
                  <textarea
                    required
                    rows={4}
                    value={mensaje}
                    onChange={(e) => setMensaje(e.target.value)}
                    placeholder="Escribí aquí los detalles de tu consulta..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 resize-none"
                  />
                </div>

                <div className="pt-2">
                  <button
                    type="submit"
                    className="w-full sm:w-auto px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>Enviar Mensaje</span>
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
