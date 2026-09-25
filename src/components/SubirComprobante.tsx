import { useEffect, useRef, useState } from 'react';
import { CheckCircle2, FileUp, Loader2 } from 'lucide-react';

/**
 * Subida obligatoria del comprobante de transferencia (pedido de Pablo 25/9). La familia saca una
 * captura o foto del comprobante y la sube desde acá; a Pablo le llega por email y la ve en el panel
 * (Pedidos → "Ver comprobante"). Las fotos se achican en el navegador (máx. 1600 px, JPEG) para que
 * suban rápido desde el celular y entren en el límite del servidor.
 */
interface Props {
  pedidoId?: string;
  grupoPagoId?: string;
  numeros?: string;
}

const MAX_BYTES = Math.floor(2.5 * 1024 * 1024);

function leerComoDataUrl(archivo: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const lector = new FileReader();
    lector.onload = () => resolve(String(lector.result));
    lector.onerror = () => reject(lector.error);
    lector.readAsDataURL(archivo);
  });
}

async function achicarImagen(archivo: File): Promise<string> {
  const original = await leerComoDataUrl(archivo);
  // HEIC (iPhone) u otros formatos que el navegador no puede dibujar: se mandan tal cual.
  const imagen = await new Promise<HTMLImageElement | null>((resolve) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = original;
  });
  if (!imagen) return original;
  const escala = Math.min(1, 1600 / Math.max(imagen.width, imagen.height));
  const lienzo = document.createElement('canvas');
  lienzo.width = Math.round(imagen.width * escala);
  lienzo.height = Math.round(imagen.height * escala);
  const ctx = lienzo.getContext('2d');
  if (!ctx) return original;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, lienzo.width, lienzo.height);
  ctx.drawImage(imagen, 0, 0, lienzo.width, lienzo.height);
  return lienzo.toDataURL('image/jpeg', 0.85);
}

export default function SubirComprobante({ pedidoId, grupoPagoId, numeros }: Props) {
  const [estado, setEstado] = useState<'cargando' | 'falta' | 'subiendo' | 'subido'>('cargando');
  const [fecha, setFecha] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const referencia = grupoPagoId ? `grupoPagoId=${encodeURIComponent(grupoPagoId)}` : pedidoId ? `pedidoId=${encodeURIComponent(pedidoId)}` : '';

  useEffect(() => {
    if (!referencia) return;
    let vivo = true;
    fetch(`/api/pagos/comprobante?${referencia}`)
      .then((r) => r.json())
      .then((d) => {
        if (!vivo) return;
        if (d?.subido) {
          setFecha(d.fecha || null);
          setEstado('subido');
        } else setEstado('falta');
      })
      .catch(() => vivo && setEstado('falta'));
    return () => {
      vivo = false;
    };
  }, [referencia]);

  if (!referencia) return null;

  const subir = async (archivo: File) => {
    setError(null);
    const esPdf = archivo.type === 'application/pdf' || /\.pdf$/i.test(archivo.name);
    const esImagen = archivo.type.startsWith('image/') || /\.(jpe?g|png|webp|heic|heif)$/i.test(archivo.name);
    if (!esPdf && !esImagen) {
      setError('Subí una foto o captura (JPG, PNG) o un PDF del comprobante.');
      return;
    }
    setEstado('subiendo');
    try {
      let dataUrl = esPdf ? await leerComoDataUrl(archivo) : await achicarImagen(archivo);
      if (esPdf && !dataUrl.startsWith('data:application/pdf')) dataUrl = dataUrl.replace(/^data:[^;]*;/, 'data:application/pdf;');
      if (/^data:;|^data:application\/octet-stream;/.test(dataUrl) && /\.hei[cf]$/i.test(archivo.name)) dataUrl = dataUrl.replace(/^data:[^;]*;/, 'data:image/heic;');
      const bytes = Math.floor((dataUrl.length - dataUrl.indexOf(',') - 1) * 0.75);
      if (bytes > MAX_BYTES) {
        setEstado('falta');
        setError('El archivo es muy grande. Sacale una captura de pantalla al comprobante y subí esa imagen.');
        return;
      }
      const res = await fetch('/api/pagos/comprobante', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pedidoId, grupoPagoId, archivo: dataUrl, nombreArchivo: archivo.name }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.success) {
        setEstado('falta');
        setError(data.error || 'No pudimos subir el comprobante. Probá de nuevo.');
        return;
      }
      setFecha(data.fecha || new Date().toISOString());
      setEstado('subido');
    } catch {
      setEstado('falta');
      setError('No pudimos subir el comprobante. Revisá tu conexión y probá de nuevo.');
    } finally {
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  const input = (
    <input
      ref={inputRef}
      type="file"
      accept="image/*,application/pdf"
      className="hidden"
      onChange={(e) => {
        const archivo = e.target.files?.[0];
        if (archivo) void subir(archivo);
      }}
    />
  );

  if (estado === 'cargando') {
    return <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs text-slate-500">Cargando…</div>;
  }

  if (estado === 'subido') {
    return (
      <div className="rounded-xl border border-emerald-300 bg-emerald-50 p-3.5 text-left text-xs text-emerald-900">
        <p className="flex items-center gap-1.5 font-bold">
          <CheckCircle2 className="h-4 w-4 text-emerald-600" /> ¡Recibimos tu comprobante!
        </p>
        <p className="mt-1">
          Lo revisamos y, apenas confirmemos la transferencia, te llega un email con tus fotos.
          {fecha ? ` (Subido el ${new Date(fecha).toLocaleDateString('es-AR')} a las ${new Date(fecha).toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' })}.)` : ''}
        </p>
        <button type="button" onClick={() => inputRef.current?.click()} className="mt-1.5 font-semibold text-emerald-800 underline cursor-pointer">
          Me equivoqué de archivo, subir otro
        </button>
        {input}
      </div>
    );
  }

  return (
    <div className="rounded-xl border-2 border-amber-400 bg-amber-50 p-3.5 text-left text-xs text-amber-950">
      <p className="font-extrabold text-amber-900">Último paso: subí el comprobante de la transferencia</p>
      <p className="mt-1">
        Sin el comprobante no podemos confirmar tu pago{numeros ? ` (pedido ${numeros})` : ''}. Sacale una captura o foto al comprobante del banco y subila acá.
      </p>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={estado === 'subiendo'}
        className="mt-2.5 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-extrabold text-slate-950 hover:bg-amber-400 disabled:opacity-60 cursor-pointer"
      >
        {estado === 'subiendo' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
        {estado === 'subiendo' ? 'Subiendo…' : 'Subir comprobante'}
      </button>
      {error && <p className="mt-1.5 font-semibold text-rose-700">{error}</p>}
      {input}
    </div>
  );
}
