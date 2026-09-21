import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

// Setup global de todas las pruebas: nunca debe salir tráfico de red real desde un test (ni a
// nuestro propio backend ni, indirectamente, a Supabase de producción vía @supabase/supabase-js,
// que también usa `fetch` por debajo). Cada test que necesite datos puntuales (galería, hijos de
// la familia, etc.) registra sus propias respuestas con `mockFetchJson` antes de montar el
// componente; cualquier URL no registrada cae en esta respuesta neutra de "no hay datos", que es
// exactamente cómo cada service ya maneja una respuesta vacía/fallida en producción.
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok: false,
      status: 404,
      json: async () => ({ success: false }),
    }))
  );
});

afterEach(() => {
  // `globals: false` en vitest.config.ts (a propósito, para no ensuciar el entorno de tests con
  // globals implícitos) significa que React Testing Library no detecta un framework de test y no
  // registra su limpieza automática — sin este `cleanup()` explícito, cada test deja montado el
  // modal del test anterior y las queries del siguiente test empiezan a encontrar elementos
  // duplicados.
  cleanup();
  vi.unstubAllGlobals();
  localStorage.clear();
  vi.restoreAllMocks();
});
