import { useEffect, useState } from 'react';
import { Search, Loader2, CheckCircle2, AlertCircle, KeyRound, School, Phone, Mail, X } from 'lucide-react';
import { buscarAlumnosAdmin, AlumnoBusqueda, PedidoPorTelefonoBusqueda } from '../services/buscadorAlumnosService';

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
            <span>Pedidos encontrados por ese teléfono ({pedidosPorTelefono.length})</span>
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
