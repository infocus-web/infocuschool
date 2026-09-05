import { useState, useEffect } from 'react';
import { Colegio } from '../types';

const STORAGE_KEY = 'colegios_escolares_v2';

export const COLEGIO_POR_DEFECTO: Colegio = {
  id: 'col-divino-pastor-2026',
  slug: 'instituto-madre-del-divino-pastor',
  nombre: 'Instituto Madre del Divino Pastor',
  localidad: 'Buenos Aires',
  zona: 'Zona Norte',
  eventoActual: 'Temporada Oficial Retratos y Fotos Escolares 2026',
  codigoAcceso: 'IMDP2026',
  grados: [
    'Sala 3 años',
    'Sala 4 años',
    'Sala 5 años',
    '1° grado',
    '2° grado',
    '3° grado',
    '4° grado',
    '5° grado',
    '6° grado',
    '7° grado',
    '1° año',
    '2° año',
    '3° año',
    '4° año',
    '5° año',
    '6° año',
  ],
  divisiones: ['A', 'B', 'C', 'Jornada Extendida'],
  turnos: ['Mañana', 'Tarde', 'Jornada Extendida / Completa'],
};

export function obtenerColegios(): Colegio[] {
  if (typeof window === 'undefined') {
    return [COLEGIO_POR_DEFECTO];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Limpiar versiones viejas si existían
      localStorage.removeItem('colegios_escolares_v1');
      localStorage.setItem(STORAGE_KEY, JSON.stringify([COLEGIO_POR_DEFECTO]));
      return [COLEGIO_POR_DEFECTO];
    }

    const parsed: Colegio[] = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify([COLEGIO_POR_DEFECTO]));
      return [COLEGIO_POR_DEFECTO];
    }

    // Filtrar / sanitizar: nunca incluir website y actualizar nombres anteriores a Instituto Madre del Divino Pastor
    let huboCambios = false;
    const sanitizados = parsed.map((col) => {
      const limpio = { ...col };
      delete limpio.website;
      if (
        limpio.nombre.includes('Colegio Modelo') ||
        limpio.nombre.includes('Instituto Superior Buenos Aires') ||
        limpio.id === 'col-modelo-2026' ||
        limpio.id === 'col-isba-2026' ||
        limpio.nombre.includes('Divino Pastor')
      ) {
        limpio.id = 'col-divino-pastor-2026';
        limpio.nombre = 'Instituto Madre del Divino Pastor';
        limpio.slug = 'instituto-madre-del-divino-pastor';
        limpio.codigoAcceso = 'IMDP2026';
        limpio.localidad = 'Buenos Aires';
        limpio.zona = 'Zona Norte';
        limpio.divisiones = ['A', 'B', 'C', 'Jornada Extendida'];
        huboCambios = true;
      }
      return limpio;
    });

    if (huboCambios) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizados));
    }

    return sanitizados;
  } catch (error) {
    console.error('Error al obtener lista de colegios:', error);
    return [COLEGIO_POR_DEFECTO];
  }
}

export function guardarNuevoColegio(datos: {
  nombre: string;
  localidad?: string;
  zona?: 'CABA' | 'Zona Norte' | 'Zona Sur' | 'Zona Oeste';
  codigoAcceso: string;
  whatsappContacto?: string;
}): Colegio {
  const listaActual = obtenerColegios();
  const slug = datos.nombre
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-');

  const nuevoColegio: Colegio = {
    id: `col-${Date.now()}`,
    slug,
    nombre: datos.nombre.trim(),
    localidad: (datos.localidad || 'Buenos Aires').trim(),
    zona: datos.zona || 'CABA',
    eventoActual: 'Temporada Oficial Retratos y Fotos Escolares 2026',
    codigoAcceso: datos.codigoAcceso.toUpperCase().trim(),
    whatsappContacto: datos.whatsappContacto ? datos.whatsappContacto.replace(/\D/g, '') : undefined,
    grados: [
      'Sala 3 años',
      'Sala 4 años',
      'Sala 5 años',
      '1° grado',
      '2° grado',
      '3° grado',
      '4° grado',
      '5° grado',
      '6° grado',
      '7° grado',
      '1° año',
      '2° año',
      '3° año',
      '4° año',
      '5° año',
      '6° año',
    ],
    divisiones: ['A', 'B', 'C', 'Jornada Extendida'],
    turnos: ['Mañana', 'Tarde', 'Jornada Extendida / Completa'],
  };

  const actualizada = [nuevoColegio, ...listaActual.filter((c) => c.id !== nuevoColegio.id)];
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actualizada));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('colegios_actualizados', { detail: actualizada }));
  }

  return nuevoColegio;
}

export function actualizarWhatsappColegio(colegioId: string, whatsapp: string): Colegio[] {
  const listaActual = obtenerColegios();
  const limpio = whatsapp.replace(/\D/g, '');
  const actualizada = listaActual.map((c) => {
    if (c.id === colegioId) {
      return { ...c, whatsappContacto: limpio || undefined };
    }
    return c;
  });

  localStorage.setItem(STORAGE_KEY, JSON.stringify(actualizada));
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('colegios_actualizados', { detail: actualizada }));
  }
  return actualizada;
}

export function eliminarColegio(id: string): Colegio[] {
  const listaActual = obtenerColegios();
  // Evitar eliminar si es el único colegio existente
  if (listaActual.length <= 1) {
    return listaActual;
  }

  const actualizada = listaActual.filter((c) => c.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(actualizada));

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('colegios_actualizados', { detail: actualizada }));
  }

  return actualizada;
}

/**
 * Hook de React para consumir y reaccionar automáticamente a altas/bajas de colegios
 */
export function useColegiosLista(): {
  colegios: Colegio[];
  agregarColegio: (datos: {
    nombre: string;
    localidad?: string;
    zona?: 'CABA' | 'Zona Norte' | 'Zona Sur' | 'Zona Oeste';
    codigoAcceso: string;
    whatsappContacto?: string;
  }) => Colegio;
  borrarColegio: (id: string) => void;
  recargarColegios: () => void;
} {
  const [colegios, setColegios] = useState<Colegio[]>(() => obtenerColegios());

  const recargar = () => {
    setColegios(obtenerColegios());
  };

  useEffect(() => {
    const handleActualizacion = () => {
      recargar();
    };

    window.addEventListener('colegios_actualizados', handleActualizacion);
    window.addEventListener('storage', handleActualizacion);

    return () => {
      window.removeEventListener('colegios_actualizados', handleActualizacion);
      window.removeEventListener('storage', handleActualizacion);
    };
  }, []);

  const agregarColegio = (datos: {
    nombre: string;
    localidad?: string;
    zona?: 'CABA' | 'Zona Norte' | 'Zona Sur' | 'Zona Oeste';
    codigoAcceso: string;
  }) => {
    const nuevo = guardarNuevoColegio(datos);
    recargar();
    return nuevo;
  };

  const borrarColegio = (id: string) => {
    borrarColegio(id);
    recargar();
  };

  return {
    colegios,
    agregarColegio,
    borrarColegio: (id: string) => {
      eliminarColegio(id);
      recargar();
    },
    recargarColegios: recargar,
  };
}
