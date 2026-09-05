import { useState, useEffect } from 'react';
import { getSupabase } from './supabaseClient';

export interface ConfiguracionWhatsApp {
  whatsappSolicitudCodigo: string;
  nombreContacto: string;
  mensajePredeterminado: string;
  ultimaActualizacion?: string;
  guardadoEnSupabase?: boolean;
}

const STORAGE_KEY = 'infocus_config_whatsapp_v1';
export const WHATSAPP_DEFECTO = '5491128625916';
export const NOMBRE_CONTACTO_DEFECTO = 'Institución Educativa / Atención de Códigos';

/**
 * Normaliza y sanea cualquier formato de teléfono ingresado (espacios, guiones, paréntesis, prefijos)
 * para convertirlo en el formato internacional numérico que requiere wa.me.
 */
export function sanitizarNumeroWhatsApp(numero: string): string {
  if (!numero) return '';
  // Remover todo excepto números
  let limpio = numero.replace(/\D/g, '');

  // Si ingresan con formato local de Argentina (ej: 1128625916 o 1528625916)
  if (limpio.startsWith('15') && limpio.length === 10) {
    limpio = '54911' + limpio.slice(2);
  } else if (limpio.startsWith('11') && limpio.length === 10) {
    limpio = '549' + limpio;
  } else if (limpio.startsWith('911') && limpio.length === 11) {
    limpio = '54' + limpio;
  }

  return limpio;
}

/**
 * Formatea el número visualmente para que sea legible (ej: +54 9 11 2862-5916)
 */
export function formatearNumeroVisual(numero: string): string {
  const limpio = sanitizarNumeroWhatsApp(numero);
  if (!limpio) return 'No configurado';
  if (limpio.startsWith('549') && limpio.length >= 12) {
    const area = limpio.slice(3, 5);
    const parte1 = limpio.slice(5, 9);
    const parte2 = limpio.slice(9);
    return `+54 9 ${area} ${parte1}-${parte2}`;
  }
  return `+${limpio}`;
}

export function obtenerConfiguracionWhatsApp(): ConfiguracionWhatsApp {
  if (typeof window === 'undefined') {
    return {
      whatsappSolicitudCodigo: WHATSAPP_DEFECTO,
      nombreContacto: NOMBRE_CONTACTO_DEFECTO,
      mensajePredeterminado: 'Hola, quisiera solicitar el código de curso para ver las fotos.',
      guardadoEnSupabase: false,
    };
  }

  try {
    const guardado = localStorage.getItem(STORAGE_KEY);
    if (guardado) {
      const parsed = JSON.parse(guardado);
      return {
        whatsappSolicitudCodigo: sanitizarNumeroWhatsApp(parsed.whatsappSolicitudCodigo) || WHATSAPP_DEFECTO,
        nombreContacto: parsed.nombreContacto || NOMBRE_CONTACTO_DEFECTO,
        mensajePredeterminado: parsed.mensajePredeterminado || 'Hola, quisiera solicitar el código de curso para ver las fotos.',
        ultimaActualizacion: parsed.ultimaActualizacion,
        guardadoEnSupabase: !!parsed.guardadoEnSupabase,
      };
    }
  } catch (err) {
    console.error('Error al leer configuración de WhatsApp:', err);
  }

  return {
    whatsappSolicitudCodigo: WHATSAPP_DEFECTO,
    nombreContacto: NOMBRE_CONTACTO_DEFECTO,
    mensajePredeterminado: 'Hola, quisiera solicitar el código de curso para ver las fotos.',
    guardadoEnSupabase: false,
  };
}

/**
 * Guarda el nuevo número en localStorage y sincroniza con Supabase si está disponible.
 */
export async function guardarConfiguracionWhatsApp(
  nuevaConfig: Partial<ConfiguracionWhatsApp>
): Promise<{
  localOk: boolean;
  supabaseOk: boolean;
  numeroSanitizado: string;
  errorSupabase?: string;
}> {
  const actual = obtenerConfiguracionWhatsApp();
  const numeroSanitizado = sanitizarNumeroWhatsApp(nuevaConfig.whatsappSolicitudCodigo ?? actual.whatsappSolicitudCodigo);

  const actualizada: ConfiguracionWhatsApp = {
    ...actual,
    ...nuevaConfig,
    whatsappSolicitudCodigo: numeroSanitizado,
    ultimaActualizacion: new Date().toISOString(),
  };

  // 1. Guardar localmente
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(actualizada));
    window.dispatchEvent(new CustomEvent('whatsapp_config_actualizada', { detail: actualizada }));
  }

  // 2. Intentar guardar en Supabase si el cliente está inicializado
  let supabaseOk = false;
  let errorSupabase: string | undefined;

  try {
    const supabase = getSupabase();
    if (supabase) {
      const { error } = await supabase
        .from('configuracion')
        .upsert(
          {
            clave: 'whatsapp_solicitud_codigo',
            valor: numeroSanitizado,
            datos_extra: {
              nombreContacto: actualizada.nombreContacto,
              mensajePredeterminado: actualizada.mensajePredeterminado,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: 'clave' }
        );

      if (error) {
        // Puede ocurrir si la tabla "configuracion" aún no fue creada en la base de datos
        errorSupabase = error.message;
        actualizada.guardadoEnSupabase = false;
      } else {
        supabaseOk = true;
        actualizada.guardadoEnSupabase = true;
        if (typeof window !== 'undefined') {
          localStorage.setItem(STORAGE_KEY, JSON.stringify(actualizada));
        }
      }
    } else {
      errorSupabase = 'Supabase no inicializado o sin credenciales anon_key.';
    }
  } catch (err: any) {
    errorSupabase = err?.message || 'Error de conexión con Supabase.';
  }

  return {
    localOk: true,
    supabaseOk,
    numeroSanitizado,
    errorSupabase,
  };
}

/**
 * Intenta sincronizar la configuración desde Supabase al iniciar
 */
export async function sincronizarDesdeSupabase(): Promise<ConfiguracionWhatsApp | null> {
  try {
    const supabase = getSupabase();
    if (!supabase) return null;

    const { data, error } = await supabase
      .from('configuracion')
      .select('clave, valor, datos_extra, updated_at')
      .eq('clave', 'whatsapp_solicitud_codigo')
      .maybeSingle();

    if (error || !data) return null;

    const config: ConfiguracionWhatsApp = {
      whatsappSolicitudCodigo: sanitizarNumeroWhatsApp(data.valor) || WHATSAPP_DEFECTO,
      nombreContacto: data.datos_extra?.nombreContacto || NOMBRE_CONTACTO_DEFECTO,
      mensajePredeterminado: data.datos_extra?.mensajePredeterminado || 'Hola, quisiera solicitar el código de curso para ver las fotos.',
      ultimaActualizacion: data.updated_at,
      guardadoEnSupabase: true,
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
      window.dispatchEvent(new CustomEvent('whatsapp_config_actualizada', { detail: config }));
    }

    return config;
  } catch (err) {
    // Si la tabla no existe, no interrumpe el flujo
    return null;
  }
}

/**
 * Genera el script SQL para crear la tabla de configuración en el SQL Editor de Supabase
 */
export function getScriptSqlSupabase(): string {
  return `-- Script para crear la tabla de configuración en Supabase
create table if not exists public.configuracion (
  clave text primary key,
  valor text not null,
  datos_extra jsonb default '{}'::jsonb,
  updated_at timestamp with time zone default now()
);

-- Habilitar Row-Level Security (RLS)
alter table public.configuracion enable row level security;

-- Permitir lectura pública (para que el portal de familias lea el número actualizado)
create policy "Lectura publica de configuracion"
  on public.configuracion for select
  using (true);

-- Permitir guardado y actualización
create policy "Permitir guardar configuracion"
  on public.configuracion for all
  using (true)
  with check (true);
`;
}

/**
 * Hook de React para consumir y reaccionar en tiempo real a los cambios de WhatsApp
 */
export function useWhatsAppConfig() {
  const [config, setConfig] = useState<ConfiguracionWhatsApp>(() => obtenerConfiguracionWhatsApp());
  const [cargando, setCargando] = useState(false);
  const [estadoGuardado, setEstadoGuardado] = useState<{
    guardado: boolean;
    enSupabase: boolean;
    errorSupabase?: string;
  } | null>(null);

  const recargar = () => {
    setConfig(obtenerConfiguracionWhatsApp());
  };

  useEffect(() => {
    // Sincronizar desde Supabase en background al montar
    sincronizarDesdeSupabase().then((remota) => {
      if (remota) setConfig(remota);
    });

    const handleActualizacion = (e: any) => {
      if (e.detail) {
        setConfig(e.detail);
      } else {
        recargar();
      }
    };

    window.addEventListener('whatsapp_config_actualizada', handleActualizacion);
    window.addEventListener('storage', handleActualizacion);

    return () => {
      window.removeEventListener('whatsapp_config_actualizada', handleActualizacion);
      window.removeEventListener('storage', handleActualizacion);
    };
  }, []);

  const actualizarConfig = async (nueva: Partial<ConfiguracionWhatsApp>) => {
    setCargando(true);
    try {
      const resultado = await guardarConfiguracionWhatsApp(nueva);
      recargar();
      setEstadoGuardado({
        guardado: resultado.localOk,
        enSupabase: resultado.supabaseOk,
        errorSupabase: resultado.errorSupabase,
      });
      return resultado;
    } finally {
      setCargando(false);
    }
  };

  return {
    config,
    actualizarConfig,
    recargar,
    cargando,
    estadoGuardado,
    limpiarEstadoGuardado: () => setEstadoGuardado(null),
  };
}
