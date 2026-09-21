import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vitest/config';

// Configuración de pruebas automáticas — separada de vite.config.ts (que es la config de
// build/dev del sitio real) para no mezclar ninguna opción de testing con lo que corre en
// producción. Corre con `npm test` (o `npx vitest` en modo watch).
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    css: false,
    globals: false,
  },
});
