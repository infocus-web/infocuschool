import React, { useState, useEffect, useTransition } from 'react';
import {
  Package, Users, RefreshCw, Database, CheckCircle2, ChevronDown, ChevronUp,
  Camera, Sparkles, Bookmark, ExternalLink, Phone, Calendar, ArrowUpRight, DollarSign
} from 'lucide-react';
import {
  extraerResumenKitsDesdeSupabase,
  KitResumenData,
  FamiliaKitInfo
} from '../services/resumenKitsService';
import { formatearNumeroVisual } from '../services/configuracionService';

interface Props {
  className?: string;
}

export default function AdminResumenKitsSection({ className = '' }: Props) {
  const [kits, setKits] = useState<KitResumenData[]>([]);
  const [totalFamilias, setTotalFamilias] = useState(0);
  const [totalPedidos, setTotalPedidos] = useState(0);
  const [totalRecaudado, setTotalRecaudado] = useState(0);
  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [ultimaActualizacion, setUltimaActualizacion] = useState<string>('');
  const [kitExpandido, setKitExpandido] = useState<string | null>(null);
  // Arranca plegada: el detalle por kit ocupa mucho espacio y no hace falta verlo
  // apenas se abre el panel; las 3 métricas clave siguen visibles igual.
  const [seccionPlegada, setSeccionPlegada] = useState(true);
  const [isPending, startTransition] = useTransition();

  const cargarDatos = async () => {
    setCargando(true);
    setError(null);
    try {
      const res = await extraerResumenKitsDesdeSupabase();
      startTransition(() => {
        setKits(res.kits);
        setTotalFamilias(res.totalFamilias);
        setTotalPedidos(res.totalPedidos);
        setTotalRecaudado(res.totalRecaudado);
        setError(res.error);
        setUltimaActualizacion(
          new Date().toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
        );
      });
    } catch (err: any) {
      setError(err?.message || 'Error al obtener datos de Supabase');
    } finally {
      setCargando(false);
    }
  };

  useEffect(() => {
    cargarDatos();
  }, []);

  const getKitIcon = (icono: string) => {
    switch (icono) {
      case 'Camera':
        return <Camera className="w-5 h-5 text-amber-500" />;
      case 'Sparkles':
        return <Sparkles className="w-5 h-5 text-sky-500" />;
      case 'Bookmark':
        return <Bookmark className="w-5 h-5 text-emerald-500" />;
      default:
        return <Package className="w-5 h-5 text-slate-500" />;
    }
  };

  const formatearFecha = (fechaIso: string) => {
    try {
      const d = new Date(fechaIso);
      return d.toLocaleDateString('es-AR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });
    } catch {
      return fechaIso;
    }
  };

  return (
    <div className={`bg-white rounded-3xl p-5 sm:p-6 border border-slate-200 shadow-xs space-y-5 ${className}`}>
      {/* Header de la sección */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-600 flex items-center justify-center shrink-0">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-base sm:text-lg font-black text-slate-900 font-['Outfit']">
                Resumen de Familias por Kit de Fotos
              </h3>
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[10px] font-mono font-bold bg-emerald-50 text-emerald-700 border border-emerald-200">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <Database className="w-3 h-3 text-emerald-600" />
                <span>Supabase DB (pedidos)</span>
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-0.5">
              Conteo consolidado de familias que han seleccionado cada kit disponible directamente desde la base de datos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          {ultimaActualizacion && (
            <span className="text-[11px] text-slate-400">
              Act: {ultimaActualizacion}
            </span>
          )}
          <button
            type="button"
            onClick={cargarDatos}
            disabled={cargando || isPending}
            className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 active:scale-95 text-slate-700 font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer disabled:opacity-50"
            title="Refrescar datos desde la base de datos de Supabase"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${cargando ? 'animate-spin text-amber-600' : ''}`} />
            <span>{cargando ? 'Actualizando...' : 'Actualizar'}</span>
          </button>
          <button
            type="button"
            onClick={() => setSeccionPlegada(!seccionPlegada)}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors"
            title={seccionPlegada ? 'Expandir resumen' : 'Minimizar resumen'}
          >
            {seccionPlegada ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Métricas destacadas generales */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="p-3.5 rounded-2xl bg-amber-50/50 border border-amber-200/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-amber-800 uppercase tracking-wider">Total Familias</span>
            <div className="text-2xl font-black text-slate-900 font-['Outfit'] mt-0.5">
              {cargando ? '...' : `${totalFamilias}`} <span className="text-xs font-normal text-slate-500 font-sans">familias</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-amber-500/15 text-amber-700 flex items-center justify-center">
            <Users className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-sky-50/50 border border-sky-200/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-sky-800 uppercase tracking-wider">Pedidos Registrados</span>
            <div className="text-2xl font-black text-slate-900 font-['Outfit'] mt-0.5">
              {cargando ? '...' : `${totalPedidos}`} <span className="text-xs font-normal text-slate-500 font-sans">pedidos</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-sky-500/15 text-sky-700 flex items-center justify-center">
            <Package className="w-4 h-4" />
          </div>
        </div>

        <div className="p-3.5 rounded-2xl bg-emerald-50/50 border border-emerald-200/80 flex items-center justify-between">
          <div>
            <span className="text-[11px] font-bold text-emerald-800 uppercase tracking-wider">Recaudación Supabase</span>
            <div className="text-2xl font-black text-slate-900 font-['Outfit'] mt-0.5">
              ${cargando ? '...' : totalRecaudado.toLocaleString('es-AR')} <span className="text-xs font-normal text-slate-500 font-sans">ARS</span>
            </div>
          </div>
          <div className="w-9 h-9 rounded-xl bg-emerald-500/15 text-emerald-700 flex items-center justify-center">
            <DollarSign className="w-4 h-4" />
          </div>
        </div>
      </div>

      {!seccionPlegada && (
        <>
          {/* Grid con cada uno de los kits disponibles */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {kits.map((kit) => {
          const isExpanded = kitExpandido === kit.kitId;
          const tieneFamilias = kit.familiasCount > 0;

          return (
            <div
              key={kit.kitId}
              className={`rounded-2xl border transition-all overflow-hidden flex flex-col ${
                kit.popular
                  ? 'border-amber-400/70 bg-gradient-to-b from-amber-50/30 to-white shadow-xs'
                  : 'border-slate-200 bg-white'
              }`}
            >
              {/* Cabecera del Kit */}
              <div className="p-4 border-b border-slate-100 flex-1 space-y-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-slate-100 flex items-center justify-center shrink-0">
                      {getKitIcon(kit.icono)}
                    </div>
                    <div>
                      <h4 className="text-sm font-black text-slate-900 leading-tight">
                        {kit.nombre}
                      </h4>
                      <p className="text-[11px] text-slate-500 line-clamp-1 mt-0.5">
                        {kit.subtitulo}
                      </p>
                    </div>
                  </div>
                  {kit.popular && (
                    <span className="px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wider bg-amber-500 text-slate-950 shrink-0">
                      Más elegido
                    </span>
                  )}
                </div>

                {/* Métricas clave del kit */}
                <div className="pt-2">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Familias que lo eligieron
                  </span>
                  <div className="flex items-baseline gap-2 mt-0.5">
                    <span className="text-3xl font-black text-slate-900 font-['Outfit']">
                      {kit.familiasCount}
                    </span>
                    <span className="text-xs font-semibold text-slate-500">
                      {kit.familiasCount === 1 ? 'familia' : 'familias'}
                    </span>
                    {totalFamilias > 0 && (
                      <span className="text-xs font-mono font-bold text-amber-600 ml-auto bg-amber-50 px-2 py-0.5 rounded-md border border-amber-200">
                        {kit.porcentajeFamilias}%
                      </span>
                    )}
                  </div>
                </div>

                {/* Barra de progreso de distribución */}
                <div className="space-y-1">
                  <div className="w-full h-2 rounded-full bg-slate-100 overflow-hidden">
                    <div
                      className={`h-full transition-all duration-500 rounded-full ${
                        kit.popular ? 'bg-amber-500' : 'bg-slate-700'
                      }`}
                      style={{ width: `${Math.max(kit.porcentajeFamilias, kit.familiasCount > 0 ? 6 : 0)}%` }}
                    />
                  </div>
                  <div className="flex justify-between items-center text-[10px] text-slate-400 font-mono">
                    <span>{kit.pedidosCount} {kit.pedidosCount === 1 ? 'pedido' : 'pedidos'}</span>
                    <span>Precio: ${kit.precio.toLocaleString('es-AR')}</span>
                  </div>
                </div>
              </div>

              {/* Botón de expansión / Listado de familias */}
              <div className="p-3 bg-slate-50/60 border-t border-slate-100">
                <button
                  type="button"
                  disabled={!tieneFamilias}
                  onClick={() => setKitExpandido(isExpanded ? null : kit.kitId)}
                  className={`w-full py-2 px-3 rounded-xl text-xs font-bold flex items-center justify-between transition-all ${
                    tieneFamilias
                      ? 'text-slate-700 hover:bg-white hover:text-slate-900 cursor-pointer shadow-xs border border-slate-200'
                      : 'text-slate-400 cursor-not-allowed border border-transparent'
                  }`}
                >
                  <span className="flex items-center gap-1.5">
                    <Users className="w-3.5 h-3.5" />
                    <span>{tieneFamilias ? `Ver ${kit.familiasCount} familias` : 'Sin familias aún'}</span>
                  </span>
                  {tieneFamilias && (
                    isExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />
                  )}
                </button>

                {/* Lista desplegable de familias para este kit */}
                {isExpanded && tieneFamilias && (
                  <div className="mt-2.5 pt-2.5 border-t border-slate-200 space-y-2 max-h-56 overflow-y-auto pr-1">
                    {kit.familias.map((fam, idx) => {
                      const telLimpio = fam.whatsapp ? fam.whatsapp.replace(/\D/g, '') : '';
                      const waLink = telLimpio ? `https://wa.me/${telLimpio}` : null;

                      return (
                        <div
                          key={`${fam.id}-${idx}`}
                          className="p-2.5 rounded-xl bg-white border border-slate-200/90 text-xs space-y-1 shadow-xs"
                        >
                          <div className="flex items-center justify-between gap-1">
                            <strong className="font-bold text-slate-800 text-[11px] truncate">
                              {fam.nombre}
                            </strong>
                            <span
                              className={`px-1.5 py-0.2 rounded text-[9px] font-black uppercase tracking-wider ${
                                fam.estado === 'pagado' || fam.estado === 'aprobado'
                                  ? 'bg-emerald-100 text-emerald-800'
                                  : 'bg-amber-100 text-amber-800'
                              }`}
                            >
                              {fam.estado === 'pagado' ? 'Pagado' : 'Pendiente'}
                            </span>
                          </div>

                          <div className="flex items-center justify-between text-[10px] text-slate-500 font-mono">
                            <span className="flex items-center gap-1">
                              <Calendar className="w-3 h-3 text-slate-400" />
                              {formatearFecha(fam.fecha)}
                            </span>
                            {fam.total > 0 && (
                              <span className="font-bold text-slate-700">
                                ${fam.total.toLocaleString('es-AR')}
                              </span>
                            )}
                          </div>

                          {waLink && (
                            <div className="pt-0.5">
                              <a
                                href={waLink}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex items-center gap-1 text-[10px] text-emerald-600 hover:text-emerald-800 font-bold hover:underline"
                              >
                                <Phone className="w-3 h-3" />
                                <span>{formatearNumeroVisual(fam.whatsapp || '')}</span>
                                <ExternalLink className="w-2.5 h-2.5" />
                              </a>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mensaje de estado informativo si hay error o advertencia */}
      {error && (
        <div className="p-3 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-xs flex items-center gap-2">
          <Database className="w-4 h-4 text-amber-600 shrink-0" />
          <span>Nota sobre la sincronización con Supabase: {error}. Mostrando datos disponibles del sistema.</span>
        </div>
      )}
        </>
      )}
    </div>
  );
}
