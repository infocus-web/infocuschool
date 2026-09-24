import { useState, useEffect, type FormEvent } from 'react';
import { MapPin, Mail, Clock, Send, CheckCircle2, Loader2, AlertCircle, Copy, Check } from 'lucide-react';
import { enviarConsultaFamilia } from '../services/consultasFamiliasService';
import { leerYLimpiarConsultaPrefill } from '../utils/consultaPrefill';
import { copiarAlPortapapeles } from '../utils/portapapeles';

const EMAIL_CONTACTO = 'contacto@retratoescolar.com.ar';

export default function ContactoSection() {
  const [nombre, setNombre] = useState('');
  const [telefono, setTelefono] = useState('');
  const [email, setEmail] = useState('');
  const [asunto, setAsunto] = useState('Consulta general');
  const [mensaje, setMensaje] = useState('');
  const [colegio, setColegio] = useState('');
  const [numeroPedido, setNumeroPedido] = useState('');
  const [sitioWeb, setSitioWeb] = useState('');
  const [enviado, setEnviado] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState('');
  const [emailCopiado, setEmailCopiado] = useState(false);

  // El enlace mailto: no hace nada en computadoras sin un programa de correo configurado (el
  // caso de quien usa Gmail en el navegador), así que también se ofrece copiar la dirección.
  const copiarEmail = async () => {
    if (await copiarAlPortapapeles(EMAIL_CONTACTO)) {
      setEmailCopiado(true);
      setTimeout(() => setEmailCopiado(false), 2500);
    }
  };

  // Auditoría 2026-09-18: cuando la familia llega acá desde uno de los botones "Escribinos"
  // del Portal (en vez de un mailto: roto), se precargan los datos que ya conocíamos (pedido,
  // alumno, colegio) para que no tenga que volver a tipearlos.
  useEffect(() => {
    const prefill = leerYLimpiarConsultaPrefill();
    if (!prefill) return;
    if (prefill.nombre) setNombre(prefill.nombre);
    if (prefill.telefono) setTelefono(prefill.telefono);
    if (prefill.colegio) setColegio(prefill.colegio);
    if (prefill.numeroPedido) setNumeroPedido(prefill.numeroPedido);
    if (prefill.asunto) setAsunto(prefill.asunto);
    if (prefill.mensaje) setMensaje(prefill.mensaje);
  }, []);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError('');
    const resultado = await enviarConsultaFamilia({ nombre, telefono, email, colegio, numeroPedido, asunto, mensaje, sitioWeb });
    setEnviando(false);
    if (!resultado.success) {
      setError(resultado.error || 'No se pudo enviar la consulta.');
      return;
    }
    setEnviado(true);
  };

  return (
    <section id="contacto" className="scroll-mt-24 py-16 lg:py-24 bg-slate-50 border-b border-slate-200/80">
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
                <div className="w-9 h-9 rounded-xl bg-amber-100 text-amber-800 flex items-center justify-center shrink-0">
                  <Mail className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-xs font-bold text-slate-900">Correo Electrónico</p>
                  <div className="flex flex-wrap items-center gap-2 mt-0.5">
                    <a
                      href={`mailto:${EMAIL_CONTACTO}`}
                      className="text-xs text-slate-600 font-medium hover:text-amber-700 hover:underline"
                    >
                      {EMAIL_CONTACTO}
                    </a>
                    <button
                      type="button"
                      onClick={() => void copiarEmail()}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg border border-slate-200 bg-slate-50 hover:bg-amber-50 hover:border-amber-300 text-[11px] font-semibold text-slate-600 cursor-pointer"
                    >
                      {emailCopiado ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                      {emailCopiado ? '¡Copiado!' : 'Copiar'}
                    </button>
                  </div>
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
                  Muchas gracias por comunicarte con Retrato Escolar. Te responderemos pronto a tu email.
                </p>
                <button
                  onClick={() => {
                    setNombre('');
                    setTelefono('');
                    setEmail('');
                    setColegio('');
                    setNumeroPedido('');
                    setMensaje('');
                    setEnviado(false);
                  }}
                  className="px-4 py-2 bg-slate-900 text-white text-xs font-semibold rounded-xl"
                >
                  Enviar otro mensaje
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <div className="hidden" aria-hidden="true">
                  <label>Tu sitio web</label>
                  <input type="text" value={sitioWeb} onChange={(e) => setSitioWeb(e.target.value)} tabIndex={-1} autoComplete="off" />
                </div>
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
                      Teléfono (opcional)
                    </label>
                    <input
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
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Colegio (opcional)</label>
                    <input type="text" value={colegio} onChange={(e) => setColegio(e.target.value)} placeholder="Nombre de la institución" maxLength={160} className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400" />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-700 block mb-1">Número de pedido (opcional)</label>
                    <input type="text" value={numeroPedido} onChange={(e) => setNumeroPedido(e.target.value)} placeholder="Ej.: IFS-2026-7699" maxLength={80} className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400" />
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
                    minLength={5}
                    maxLength={3000}
                    placeholder="Escribí aquí los detalles de tu consulta..."
                    className="w-full px-3 py-2 text-xs bg-slate-50 border border-slate-300 rounded-xl focus:outline-hidden focus:ring-2 focus:ring-amber-400 resize-none"
                  />
                </div>

                {error && (
                  <p className="p-3 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700 flex items-start gap-2">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {error}
                  </p>
                )}

                <div className="pt-2">
                  <button
                    type="submit"
                    disabled={enviando}
                    className="w-full sm:w-auto px-6 py-2.5 bg-amber-400 hover:bg-amber-300 text-slate-950 font-bold text-xs rounded-xl shadow-md shadow-amber-400/20 flex items-center justify-center gap-2 cursor-pointer transition-all active:scale-98 disabled:opacity-60 disabled:cursor-wait"
                  >
                    {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                    <span>{enviando ? 'Enviando...' : 'Enviar Mensaje'}</span>
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
