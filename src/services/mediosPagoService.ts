import { useEffect, useState } from 'react';

// Nave sólo se ofrece cuando el servidor está en producción (ver /api/pagos/medios en server.ts).
// Mientras se consulta, o si la consulta falla, se oculta: es preferible no mostrar un medio que
// podría rechazar la tarjeta.
let cache: Promise<boolean> | null = null;

function consultarNaveHabilitado(): Promise<boolean> {
  if (!cache) {
    cache = fetch('/api/pagos/medios')
      .then((r) => r.json())
      .then((d) => Boolean(d?.nave))
      .catch(() => {
        cache = null;
        return false;
      });
  }
  return cache;
}

export function useNaveHabilitado(): boolean {
  const [habilitado, setHabilitado] = useState(false);
  useEffect(() => {
    let vivo = true;
    void consultarNaveHabilitado().then((v) => vivo && setHabilitado(v));
    return () => {
      vivo = false;
    };
  }, []);
  return habilitado;
}
