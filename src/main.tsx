import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import ErrorBoundary from './components/ErrorBoundary';
import './index.css';
import { instalarCapturaDeErrores } from './services/reporteErrores';

// Antes del primer render: así también quedan anotadas las primeras llamadas al servidor.
instalarCapturaDeErrores();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary variante="pagina">
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
