import { Foto, CategoriaFoto } from '../types';
import { FOTOS_MUESTRA } from '../data/colegiosData';
import { eliminarFotoDeStorage } from './supabaseClient';

export interface FotoSubida {
  id: string;
  colegioId: string;
  cursoCodigo: string;
  alumnoId?: string;
  alumnoNombre?: string;
  categoria: 'individual' | 'grupal' | 'docente';
  nombreOriginal: string;
  urlWeb: string;
  urlHD?: string;
  pathStorageWeb: string;
  pathStorageHD: string;
  fechaSubida: string;
  tamanoBytes?: number;
}

const STORAGE_KEY_FOTOS = 'infocus_fotos_subidas_v1';

export function obtenerTodasLasFotosSubidas(): FotoSubida[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY_FOTOS);
    if (!raw) return [];
    return JSON.parse(raw);
  } catch (err) {
    console.error('Error al leer fotos subidas:', err);
    return [];
  }
}

export function obtenerFotosSubidasPorCurso(cursoCodigo: string): FotoSubida[] {
  const todas = obtenerTodasLasFotosSubidas();
  const codigoLimpio = cursoCodigo.trim().toUpperCase();
  return todas.filter(f => f.cursoCodigo.trim().toUpperCase() === codigoLimpio);
}

export function guardarFotoSubida(nueva: FotoSubida): void {
  const todas = obtenerTodasLasFotosSubidas();
  // Evitar duplicados por id o mismo path
  const filtradas = todas.filter(f => f.id !== nueva.id && f.pathStorageHD !== nueva.pathStorageHD);
  filtradas.unshift(nueva);
  
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_FOTOS, JSON.stringify(filtradas));
    window.dispatchEvent(new CustomEvent('infocus_fotos_updated', { detail: filtradas }));
  }
}

export async function eliminarFotoSubida(id: string): Promise<boolean> {
  const todas = obtenerTodasLasFotosSubidas();
  const foto = todas.find(f => f.id === id);
  if (!foto) return false;

  // Eliminar de Supabase Storage si corresponde
  try {
    await eliminarFotoDeStorage(foto.pathStorageWeb, foto.pathStorageHD);
  } catch (e) {
    console.warn('No se pudo borrar de storage remoto:', e);
  }

  const restantes = todas.filter(f => f.id !== id);
  if (typeof window !== 'undefined') {
    localStorage.setItem(STORAGE_KEY_FOTOS, JSON.stringify(restantes));
    window.dispatchEvent(new CustomEvent('infocus_fotos_updated', { detail: restantes }));
  }
  return true;
}

export function limpiarTodasLasFotosSubidas(): void {
  if (typeof window !== 'undefined') {
    localStorage.removeItem(STORAGE_KEY_FOTOS);
    window.dispatchEvent(new CustomEvent('infocus_fotos_updated', { detail: [] }));
  }
}

/**
 * Retorna las fotos disponibles para un curso en el portal de familias.
 * Si el fotógrafo ya subió fotos reales para este curso, devuelve las fotos reales.
 * Si aún no se subieron fotos para el curso, retorna las fotos de muestra estándar.
 */
export function obtenerFotosParaGaleria(cursoCodigo?: string): Foto[] {
  if (!cursoCodigo) {
    return FOTOS_MUESTRA;
  }

  const subidas = obtenerFotosSubidasPorCurso(cursoCodigo);
  if (subidas.length === 0) {
    return FOTOS_MUESTRA;
  }

  return subidas.map((s): Foto => ({
    id: s.id,
    url: s.urlWeb,
    thumbnail: s.urlWeb,
    categoria: s.categoria as CategoriaFoto,
    titulo: s.alumnoNombre 
      ? `${s.alumnoNombre} (${s.categoria})` 
      : `${s.categoria.toUpperCase()} - ${s.nombreOriginal}`,
    descripcion: `Foto ${s.categoria} para ${s.cursoCodigo}`,
    alumnoNombre: s.alumnoNombre
  }));
}
