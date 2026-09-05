import { getSupabase } from './supabaseClient';
import { KITS_DISPONIBLES } from '../data/colegiosData';
import { obtenerPedidosGuardados } from './pedidosLabService';

export interface FamiliaKitInfo {
  id: string;
  pedidoId: string;
  nombre: string;
  whatsapp?: string;
  colegioId?: string;
  fecha: string;
  estado: string;
  total: number;
  carpetasImpresas?: number;
}

export interface KitResumenData {
  kitId: string;
  nombre: string;
  subtitulo: string;
  precio: number;
  popular?: boolean;
  icono: string;
  familiasCount: number; // Cantidad de familias únicas que seleccionaron este kit
  pedidosCount: number;  // Cantidad total de pedidos asociados a este kit
  totalRecaudado: number;
  porcentajeFamilias: number; // Porcentaje sobre el total de familias
  familias: FamiliaKitInfo[];
}

export interface ResumenKitsGlobal {
  kits: KitResumenData[];
  totalFamilias: number;
  totalPedidos: number;
  totalRecaudado: number;
  fuente: 'supabase' | 'local' | 'mixto';
  cargando: boolean;
  error: string | null;
  ultimaActualizacion: string;
}

/**
 * Normaliza el tipo_kit guardado en Supabase o en pedidos locales
 * para asociarlo con uno de los KITS_DISPONIBLES oficiales.
 */
export function normalizarTipoKit(tipoKitRaw?: string | null): string {
  if (!tipoKitRaw) return 'kit-clasico';
  const clean = tipoKitRaw.trim().toLowerCase();

  // Mapeo para Kit Impreso + Digital (kit-clasico)
  if (
    clean === 'impreso_digital' ||
    clean === 'kit-clasico' ||
    clean === 'impreso' ||
    clean === 'clasico' ||
    clean.includes('impreso')
  ) {
    return 'kit-clasico';
  }

  // Mapeo para Solo Digital HD (kit-digital)
  if (
    clean === 'solo_digital' ||
    clean === 'digital' ||
    clean === 'kit-digital' ||
    clean.includes('digital')
  ) {
    return 'kit-digital';
  }

  // Mapeo para Fotos Sueltas de Eventos (kit-evento-suelto)
  if (
    clean === 'evento_suelto' ||
    clean === 'kit-evento-suelto' ||
    clean === 'sueltas' ||
    clean === 'evento' ||
    clean.includes('evento') ||
    clean.includes('suelta')
  ) {
    return 'kit-evento-suelto';
  }

  return clean;
}

/**
 * Extrae y calcula el resumen de cuántas familias han seleccionado cada kit
 * directamente desde la base de datos de Supabase (tabla 'pedidos' y 'familias').
 */
export async function extraerResumenKitsDesdeSupabase(): Promise<{
  kits: KitResumenData[];
  totalFamilias: number;
  totalPedidos: number;
  totalRecaudado: number;
  error: string | null;
}> {
  const supabase = getSupabase();
  let pedidosSupabase: any[] = [];
  let errorMsg: string | null = null;

  if (supabase) {
    try {
      const { data, error } = await supabase
        .from('pedidos')
        .select(`
          id,
          tipo_kit,
          estado,
          total,
          carpetas_impresas,
          created_at,
          familia_id,
          familias (
            id,
            nombre,
            whatsapp,
            colegio_id
          )
        `)
        .order('created_at', { ascending: false });

      if (error) {
        console.warn('Error al consultar tabla pedidos en Supabase:', error.message);
        errorMsg = error.message;
      } else if (data && data.length > 0) {
        pedidosSupabase = data;
      }
    } catch (err: any) {
      console.warn('Excepción al conectar con Supabase pedidos:', err);
      errorMsg = err?.message || 'Error de conexión con Supabase';
    }
  } else {
    errorMsg = 'Supabase no inicializado';
  }

  // Si Supabase no tiene pedidos o hubo error, complementamos con pedidos locales
  const pedidosLocales = obtenerPedidosGuardados();

  // Estructura base para cada kit disponible
  const kitMap: Record<string, {
    kitInfo: (typeof KITS_DISPONIBLES)[0];
    familiasMap: Map<string, FamiliaKitInfo>;
    pedidosList: any[];
    totalRecaudado: number;
  }> = {};

  KITS_DISPONIBLES.forEach((k) => {
    kitMap[k.id] = {
      kitInfo: k,
      familiasMap: new Map<string, FamiliaKitInfo>(),
      pedidosList: [],
      totalRecaudado: 0,
    };
  });

  // Procesar pedidos de Supabase (fuente primaria de la base de datos)
  pedidosSupabase.forEach((p) => {
    const kitNormalizado = normalizarTipoKit(p.tipo_kit);
    const targetKit = kitMap[kitNormalizado] || kitMap['kit-clasico'];

    if (targetKit) {
      targetKit.pedidosList.push(p);
      const monto = Number(p.total) || 0;
      if (p.estado === 'pagado' || p.estado === 'aprobado') {
        targetKit.totalRecaudado += monto;
      }

      // Identificador único de la familia
      const familiaId = p.familia_id || p.familias?.id || p.familias?.whatsapp || p.familias?.nombre || p.id;
      const nombreFamilia = p.familias?.nombre || (p.familia_id ? `Familia (${p.familia_id.substring(0, 8)})` : 'Familia Escolar');

      if (!targetKit.familiasMap.has(familiaId)) {
        targetKit.familiasMap.set(familiaId, {
          id: familiaId,
          pedidoId: p.id,
          nombre: nombreFamilia,
          whatsapp: p.familias?.whatsapp || '',
          colegioId: p.familias?.colegio_id,
          fecha: p.created_at || new Date().toISOString(),
          estado: p.estado || 'pendiente_pago',
          total: monto,
          carpetasImpresas: p.carpetas_impresas || 1,
        });
      }
    }
  });

  // Si no hay pedidos en Supabase, procesar los pedidos de almacenamiento local para no dejar la vista vacía
  if (pedidosSupabase.length === 0 && pedidosLocales.length > 0) {
    pedidosLocales.forEach((p) => {
      const kitNormalizado = normalizarTipoKit(p.kitId);
      const targetKit = kitMap[kitNormalizado] || kitMap['kit-clasico'];

      if (targetKit) {
        targetKit.pedidosList.push(p);
        targetKit.totalRecaudado += p.total || 0;

        const famKey = p.tutorTelefono || p.tutorEmail || p.tutorNombre || p.id;
        if (!targetKit.familiasMap.has(famKey)) {
          targetKit.familiasMap.set(famKey, {
            id: famKey,
            pedidoId: p.id,
            nombre: p.tutorNombre || `Familia de ${p.alumnoNombre}`,
            whatsapp: p.tutorTelefono || '',
            colegioId: p.colegioId,
            fecha: p.fecha || new Date().toISOString(),
            estado: p.estadoPago || 'aprobado',
            total: p.total || 0,
            carpetasImpresas: 1,
          });
        }
      }
    });
  }

  // Calcular totales globales
  const todasLasFamiliasUnicas = new Set<string>();
  let totalPedidosGlobal = 0;
  let totalRecaudadoGlobal = 0;

  Object.values(kitMap).forEach((km) => {
    totalPedidosGlobal += km.pedidosList.length;
    totalRecaudadoGlobal += km.totalRecaudado;
    km.familiasMap.forEach((_, fKey) => todasLasFamiliasUnicas.add(fKey));
  });

  const totalFamiliasGlobal = todasLasFamiliasUnicas.size;

  // Generar lista final ordenada
  const resultadoKits: KitResumenData[] = KITS_DISPONIBLES.map((k) => {
    const km = kitMap[k.id];
    const familiasArray = Array.from(km.familiasMap.values());
    const familiasCount = familiasArray.length;
    const pedidosCount = km.pedidosList.length;

    const porcentaje = totalFamiliasGlobal > 0
      ? Math.round((familiasCount / totalFamiliasGlobal) * 100)
      : 0;

    return {
      kitId: k.id,
      nombre: k.nombre,
      subtitulo: k.subtitulo,
      precio: k.precio,
      popular: k.popular,
      icono: k.icono,
      familiasCount,
      pedidosCount,
      totalRecaudado: km.totalRecaudado,
      porcentajeFamilias: porcentaje,
      familias: familiasArray,
    };
  });

  return {
    kits: resultadoKits,
    totalFamilias: totalFamiliasGlobal,
    totalPedidos: totalPedidosGlobal,
    totalRecaudado: totalRecaudadoGlobal,
    error: errorMsg,
  };
}
