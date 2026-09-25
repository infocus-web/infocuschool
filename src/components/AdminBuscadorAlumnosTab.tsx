import { useEffect, useState } from 'react';
import { Search, Loader2, CheckCircle2, AlertCircle, KeyRound, School, Phone, Mail, X, Send, Sparkles } from 'lucide-react';
import { buscarAlumnosAdmin, AlumnoBusqueda, PedidoPorTelefonoBusqueda } from '../services/buscadorAlumnosService';
import { iniciarConversacionFamiliaAdmin, sugerirMensajeFamiliaAdmin } from '../services/consultasFamiliasService';

interface DestinatarioFamilia {
  nombre: string;
  email: string;
  telefono?: string;
  colegio?: string;
  numeroPedido?: string;
  alumno: string;
}

/**
 * "Escribir a esta familia" (pedido de Pablo, 25/9): manda un email desde el dominio de Retrato
 * Escolar y lo deja como conversación en la pestaña Consultas, donde también llega la respuesta.
 */
function ModalEscribirFamilia({ destino, onCerrar }: { destino: DestinatarioFamilia; onCerrar: (enviado: boolean) => void }) {
  const [asunto, setAsunto] = useState('');
  const [mensaje, setMensaje] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [redactando, setRedactando] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pedirBorrador = async () => {
    setError(null);
    if (asunto.trim().length < 3) return setError('Escribí primero el asunto: la IA arma el borrador a partir de él.');
    setRedactando(true);
    try {
      const texto = await sugerirMensajeFamiliaAdmin({ nombre: destino.nombre, email: destino.email, alumno: destino.alumno, numeroPedido: destino.numeroPedido, motivo: asunto.trim() });
      if (texto) setMensaje(texto);
    } catch (e: any) {
      setError(e?.message || 'No se pudo generar el borrador.');
    } finally {
      setRedactando(false);
    }
  };

  const enviar = async () => {
    setError(null);
    if (asunto.trim().length < 2) return setError('Escribí un asunto.');
    if (mensaje.trim().length < 5) return setError('Escribí el mensaje.');
    setEnviando(true);
    try {
      await iniciarConversacionFamiliaAdmin({
        nombre: destino.nombre,
        email: destino.email,
        telefono: destino.telefono,
        colegio: destino.colegio,
        numeroPedido: destino.numeroPedido,
        asunto: asunto.trim(),
        mensaje: mensaje.trim(),
      });
      onCerrar(true);
    } catch (e: any) {
      setError(e?.message || 'No se pudo enviar el email.');
      setEnviando(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={() => !enviando && onCerrar(false)}>
      <div role="dialog" aria-label="Escribir a la familia" className="bg-white rounded-2xl p-5 w-full max-w-lg shadow-xl space-y-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="font-bold text-slate-900 text-sm">Escribir a {destino.nombre}</p>
            <p className="text-[11px] text-slate-500 truncate">{destino.email} · {destino.alumno}</p>
          </div>
          <button type="button" onClick={() => onCerrar(false)} disabled={enviando} className="p-1 text-slate-400 hover:text-slate-700 cursor-pointer" aria-label="Cerrar">
            <X className="w-5 h-5" />
          </button>
        </div>
        <label className="block text-[11px] font-semibold text-slate-700">
          Asunto
          <input value={asunto} onChange={(e) => setAsunto(e.target.value)} maxLength={160} placeholder="Ej: Tu kit ya está pago" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-normal" />
        </label>
        <div className="text-[11px] font-semibold text-slate-700">
          <div className="flex items-center justify-between gap-2">
            <label htmlFor="mensaje-familia">Mensaje</label>
            <button type="button" onClick={() => void pedirBorrador()} disabled={redactando || enviando} className="inline-flex items-center gap-1 text-[11px] font-bold text-violet-700 hover:text-violet-900 disabled:opacity-50 cursor-pointer">
              {redactando ? <Loader2 className="w-3 h-3 animate-spin" /> : <Sparkles className="w-3 h-3" />}
              Borrador con IA
            </button>
          </div>
          <textarea id="mensaje-familia" value={mensaje} onChange={(e) => setMensaje(e.target.value)} maxLength={3000} rows={8} className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 text-xs font-normal" placeholder="Sólo el cuerpo: el email ya empieza con “Hola {nombre},” y termina con la firma de Retrato Escolar." />
        </div>
        <p className="text-[10px] text-slate-500">Sale desde el email de Retrato Escolar. Si la familia responde, la respuesta te llega a la pestaña Consultas, en esta misma conversación.</p>
        {error && <p className="text-[11px] font-semibold text-rose-700">{error}</p>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={() => onCerrar(false)} disabled={enviando} className="px-3 py-2 rounded-xl border border-slate-300 text-xs font-bold text-slate-700 hover:bg-slate-50 cursor-pointer">Cancelar</button>
          <button type="button" onClick={() => void enviar()} disabled={enviando} className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-sky-600 hover:bg-sky-500 disabled:opacity-50 text-white text-xs font-bold cursor-pointer">
            {enviando ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            Enviar email
          </button>
        </div>
      </div>
    </div>
  );
}

function formatearMonto(valor: number): string {
  return `$${Math.round(valor).toLocaleString('es-AR')}`;
}

/**
 * Auditoría 2026-09-16 (pedido de Pablo: "necesito un buscador de alumnos, por nombre y
 * apellido, dni, codigo, telefono, para saber si pagó"): un cuadro de búsqueda único que cruza
 * los cuatro datos contra la nómina real, los códigos de sección reales y los pedidos, para
 * responder rápido si una familia puntual ya pagó — sin tener que elegir de antemano colegio o
 * curso (a diferencia de "Estado de pagos", pensado para el total de un curso completo). Ver
 * `services/buscadorAlumnosService.ts` y el endpoint `/api/admin/alumnos/buscar`.
 */
export default function AdminBuscadorAlumnosTab() {
  const [query, setQuery] = useState('');
  const [buscando, setBuscando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [escribiendoA, setEscribiendoA] = useState<DestinatarioFamilia | null>(null);
  const [avisoEnvio, setAvisoEnvio] = useState<string | null>(null);
  const [alumnos, setAlumnos] = useState<AlumnoBusqueda[]>([]);
  const [pedidosPorTelefono, setPedidosPorTelefono] = useState<PedidoPorTelefonoBusqueda[]>([]);
  const [buscoAlgunaVez, setBuscoAlgunaVez] = useState(false);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setAlumnos([]);
      setPedidosPorTelefono([]);
      setError(null);
      setBuscando(false);
      return;
    }
    setBuscando(true);
    const timeoutId = setTimeout(async () => {
      const resultado = await buscarAlumnosAdmin(q);
      setBuscoAlgunaVez(true);
      if (resultado.success) {
        setAlumnos(resultado.alumnos);
        setPedidosPorTelefono(resultado.pedidosPorTelefono);
        setError(null);
      } else {
        setAlumnos([]);
        setPedidosPorTelefono([]);
        setError(resultado.error || 'No se pudo buscar.');
      }
      setBuscando(false);
    }, 350);
    return () => clearTimeout(timeoutId);
  }, [query]);

  const sinResultados =
    buscoAlgunaVez && !buscando && !error && query.trim().length >= 2 && alumnos.length === 0 && pedidosPorTelefono.length === 0;

  return (
    <div className="space-y-4 text-slate-900 text-left animate-in fade-in duration-200">
      <div className="p-4 bg-sky-50/70 border border-sky-200 rounded-2xl flex items-start gap-3">
        <Search className="w-5 h-5 text-sky-600 shrink-0 mt-0.5" />
        <div className="text-xs text-sky-950 leading-relaxed">
          <p className="font-bold">Buscar Alumno</p>
          <p className="mt-1 text-sky-900/90">
            Escribí nombre y apellido, DNI, Código de Acceso o teléfono de la familia — busca en
            todos los colegios a la vez y te muestra si ese alumno ya pagó, con qué pedido y los
            datos de contacto del tutor.
          </p>
        </div>
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Nombre, apellido, DNI, código de acceso o teléfono..."
          autoFocus
          className="w-full pl-10 pr-10 py-3 text-sm bg-white border-2 border-slate-200 rounded-2xl focus:outline-hidden focus:ring-2 focus:ring-sky-400 focus:border-sky-400 shadow-2xs"
        />
        {query && (
          <button
            type="button"
            onClick={() => setQuery('')}
            className="absolute right-3 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600 rounded-full cursor-pointer"
            title="Limpiar búsqueda"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        {buscando && (
          <Loader2 className="absolute right-10 top-1/2 -translate-y-1/2 w-4 h-4 text-sky-500 animate-spin" />
        )}
      </div>

      {avisoEnvio && (
        <div className="p-2.5 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-[11px] font-semibold flex items-center gap-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
          <span>{avisoEnvio}</span>
        </div>
      )}

      {escribiendoA && (
        <ModalEscribirFamilia
          destino={escribiendoA}
          onCerrar={(enviado) => {
            if (enviado) setAvisoEnvio(`Email enviado a ${escribiendoA.email}. La conversación quedó en la pestaña Consultas.`);
            setEscribiendoA(null);
          }}
        />
      )}

      {error && (
        <div className="p-2.5 rounded-xl bg-rose-50 border border-rose-200 text-rose-800 text-[11px] font-semibold flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {query.trim().length > 0 && query.trim().length < 2 && (
        <p className="text-[11px] text-slate-400 px-1">Escribí al menos 2 caracteres...</p>
      )}

      {sinResultados && (
        <div className="py-10 text-center text-slate-400 text-xs">
          No encontramos ningún alumno ni pedido que coincida con "{query.trim()}".
        </div>
      )}

      {alumnos.length > 0 && (
        <div className="space-y-2.5">
          {alumnos.map((a) => (
            <div key={a.id} className="p-4 rounded-2xl border border-slate-200 bg-white shadow-2xs">
              <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-extrabold text-slate-900">{a.nombre}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500">
                    {a.colegioNombre && (
                      <span className="flex items-center gap-1">
                        <School className="w-3 h-3 text-slate-400" /> {a.colegioNombre}
                      </span>
                    )}
                    <span>
                      {a.grado} {a.turno ? `· ${a.turno}` : ''} "{a.division}"
                    </span>
                    {a.dni && <span className="font-mono">DNI {a.dni}</span>}
                  </div>
                  {a.codigoSeccion && (
                    <div className="mt-2 inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-50 border border-amber-200">
                      <KeyRound className="w-3 h-3 text-amber-600" />
                      <span className="text-[10px] font-bold text-amber-900 uppercase tracking-wide">Código:</span>
                      <span className="text-xs font-mono font-extrabold text-slate-900 tracking-wider">{a.codigoSeccion}</span>
                    </div>
                  )}
                </div>

                <div className="shrink-0 flex flex-col items-start sm:items-end gap-1.5">
                  {a.pagado ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 bg-emerald-100 px-2.5 py-1 rounded-full">
                      <CheckCircle2 className="w-3 h-3" /> Pagado
                    </span>
                  ) : a.pedido ? (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 bg-amber-100 px-2.5 py-1 rounded-full">
                      {a.pedido.estado}
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-500 bg-slate-100 px-2.5 py-1 rounded-full">
                      Sin pedido registrado
                    </span>
                  )}
                  {a.pedido && (
                    <div className="text-right text-[11px] text-slate-500">
                      <p className="font-bold text-slate-800">{formatearMonto(a.pedido.total)}{a.pedido.kitNombre ? ` · ${a.pedido.kitNombre}` : ''}</p>
                      {a.pedido.fecha && <p>{new Date(a.pedido.fecha).toLocaleDateString('es-AR')}</p>}
                    </div>
                  )}
                </div>
              </div>

              {a.pedido && (a.pedido.tutorNombre || a.pedido.tutorTelefono || a.pedido.tutorEmail) && (
                <div className="mt-3 pt-3 border-t border-slate-100 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-slate-600">
                  {a.pedido.tutorNombre && <span className="font-semibold">{a.pedido.tutorNombre}</span>}
                  {a.pedido.tutorTelefono && (
                    <span className="flex items-center gap-1 font-mono">
                      <Phone className="w-3 h-3 text-emerald-500" /> {a.pedido.tutorTelefono}
                    </span>
                  )}
                  {a.pedido.tutorEmail && (
                    <span className="flex items-center gap-1">
                      <Mail className="w-3 h-3 text-sky-500" /> {a.pedido.tutorEmail}
                    </span>
                  )}
                  {a.pedido.tutorEmail && (
                    <button
                      type="button"
                      onClick={() => {
                        setAvisoEnvio(null);
                        setEscribiendoA({
                          nombre: a.pedido?.tutorNombre || 'Familia',
                          email: a.pedido?.tutorEmail || '',
                          telefono: a.pedido?.tutorTelefono || undefined,
                          colegio: a.colegioNombre || undefined,
                          numeroPedido: a.pedido?.numero || undefined,
                          alumno: a.nombre,
                        });
                      }}
                      className="ml-auto inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-500 text-white font-bold text-[11px] cursor-pointer"
                    >
                      <Send className="w-3 h-3" /> Escribir a esta familia
                    </button>
                  )}
                </div>
              )}
              {a.otrosPedidos > 0 && (
                <p className="mt-2 text-[10px] text-slate-400">
                  + {a.otrosPedidos} pedido{a.otrosPedidos > 1 ? 's' : ''} más de este alumno (revisalo en "Pedidos").
                </p>
              )}
            </div>
          ))}
        </div>
      )}

      {pedidosPorTelefono.length > 0 && (
        <div className="p-4 rounded-2xl bg-indigo-50 border border-indigo-200 space-y-2">
          <h4 className="text-xs font-bold text-indigo-900 flex items-center gap-1.5">
            <Phone className="w-4 h-4" />
            <span>Otros pedidos encontrados ({pedidosPorTelefono.length})</span>
          </h4>
          <p className="text-[11px] text-indigo-800">
            Puede que el nombre de estos pedidos no coincida con ningún alumno de la nómina cargada
            (error de tipeo, o colegio sin nómina real todavía) — por eso se muestran aparte.
          </p>
          <div className="space-y-1.5">
            {pedidosPorTelefono.map((p) => (
              <div key={p.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-1 text-[11px] bg-white rounded-lg px-3 py-2 border border-indigo-100">
                <div>
                  <span className="font-bold text-slate-800">{p.alumnoNombre || '(sin nombre)'}</span>
                  {p.colegioNombre && <span className="text-slate-500"> · {p.colegioNombre}</span>}
                  {(p.grado || p.division) && <span className="text-slate-400"> · {p.grado} "{p.division}"</span>}
                </div>
                <div className="text-slate-500 flex items-center gap-2">
                  <span>{p.estado} · {formatearMonto(p.total)}</span>
                  {p.tutorTelefono && <span className="font-mono">{p.tutorTelefono}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
