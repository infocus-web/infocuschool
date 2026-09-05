import React, { useState, useMemo, useEffect } from 'react';
import { 
  Camera, Upload, CheckCircle2, 
  Trash2, RefreshCw, ShieldCheck, Check,
  AlertCircle, Database, Copy, HardDrive, Key,
  Sliders, Image as ImageIcon, Sparkles, User
} from 'lucide-react';
import { COLEGIOS_EJEMPLO } from '../data/colegiosData';
import { useColegiosLista } from '../services/colegiosService';
import { SECCIONES_INICIAL_2026, ALUMNOS_NOMINA_2026 } from '../data/alumnosData';
import { CODIGOS_CURSOS_INICIALES } from '../data/codigosCursos';
import { 
  uploadFotoWeb, 
  uploadFotoHD,
  testSupabaseConnection,
  limpiarStorageBucket,
  SupabaseDiagnosticResult,
  getSupabaseConfig,
  saveSupabaseConfig,
  resetSupabaseConfig
} from '../services/supabaseClient';
import {
  guardarFotoSubida,
  obtenerFotosSubidasPorCurso,
  eliminarFotoSubida,
  limpiarTodasLasFotosSubidas,
  FotoSubida
} from '../services/fotosSubidasService';

interface FotoLoteItem {
  id: string;
  file?: File;
  previewUrl: string;
  watermarkedUrl: string;
  tipo: 'individual' | 'grupal' | 'docente';
  nombreOriginal: string;
  estado: 'procesada' | 'subiendo' | 'subida' | 'error';
  errorMensaje?: string;
  alumnoNombre?: string;
}

export default function AdminLoteFotosTab() {
  const { colegios } = useColegiosLista();
  const [cursoSeleccionado, setCursoSeleccionado] = useState<string>('SALA3TM');
  const [colegioSeleccionado, setColegioSeleccionado] = useState<string>(() => colegios[0]?.id || 'col-isba-2026');
  const [tipoFotoLote, setTipoFotoLote] = useState<'individual' | 'grupal' | 'docente'>('individual');
  const [alumnoSeleccionadoId, setAlumnoSeleccionadoId] = useState<string>('');

  // Clean initial queue: ready for real student photos
  const [fotosLote, setFotosLote] = useState<FotoLoteItem[]>([]);
  const [fotosActivasCurso, setFotosActivasCurso] = useState<FotoSubida[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ actual: number; total: number }>({ actual: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Supabase Diagnostics & Settings
  const [diagnostico, setDiagnostico] = useState<SupabaseDiagnosticResult | null>(null);
  const [isTestingSupabase, setIsTestingSupabase] = useState(false);
  const [mostrarConfigSupabase, setMostrarConfigSupabase] = useState(false);
  const [mostrarSqlHelper, setMostrarSqlHelper] = useState(false);
  const [sqlCopiado, setSqlCopiado] = useState(false);

  // Form config
  const [configUrl, setConfigUrl] = useState(() => getSupabaseConfig().url);
  const [configKey, setConfigKey] = useState(() => getSupabaseConfig().anonKey);

  const seccionActual = useMemo(() => {
    return SECCIONES_INICIAL_2026.find(s => (CODIGOS_CURSOS_INICIALES[s.id] || s.id) === cursoSeleccionado) || SECCIONES_INICIAL_2026[0];
  }, [cursoSeleccionado]);

  // Alumnos del curso actual para asignación opcional
  const alumnosDelCurso = useMemo(() => {
    if (!seccionActual) return [];
    return ALUMNOS_NOMINA_2026.filter(a => a.seccionId === seccionActual.id);
  }, [seccionActual]);

  // Cargar fotos activas del curso
  const recargarFotosActivas = () => {
    setFotosActivasCurso(obtenerFotosSubidasPorCurso(cursoSeleccionado));
  };

  useEffect(() => {
    recargarFotosActivas();
    const handleSync = () => recargarFotosActivas();
    window.addEventListener('infocus_fotos_updated', handleSync);
    return () => window.removeEventListener('infocus_fotos_updated', handleSync);
  }, [cursoSeleccionado]);

  // Ejecutar diagnóstico automático al iniciar
  useEffect(() => {
    handleEjecutarDiagnostico();
  }, []);

  const handleEjecutarDiagnostico = async () => {
    setIsTestingSupabase(true);
    try {
      const diag = await testSupabaseConnection();
      setDiagnostico(diag);
      if (diag.fotosWebStatus === 'rls_blocked' || diag.fotosHdStatus === 'rls_blocked') {
        setMostrarSqlHelper(true);
      }
    } catch (err: any) {
      console.error('Error al probar Supabase:', err);
    } finally {
      setIsTestingSupabase(false);
    }
  };

  // Watermarking generator function
  const applyWatermarkToCanvas = (img: HTMLImageElement): string => {
    const canvas = document.createElement('canvas');
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img.src;

    ctx.drawImage(img, 0, 0);

    ctx.save();
    const text = 'MUESTRA RETRATO ESCOLAR · FOTOGRAFÍA ESCOLAR';
    const fontSize = Math.max(16, Math.round(canvas.width * 0.04));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.75)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
    ctx.shadowBlur = 6;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-25 * Math.PI) / 180);

    const stepX = canvas.width * 0.45;
    const stepY = canvas.height * 0.22;
    for (let y = -canvas.height; y < canvas.height; y += stepY) {
      for (let x = -canvas.width; x < canvas.width; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.85);
  };

  const handleFilesSelected = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsProcessing(true);
    setErrorMessage(null);

    const nuevosItems: FotoLoteItem[] = [];
    const alumnoEncontrado = alumnosDelCurso.find(a => a.id === alumnoSeleccionadoId);

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const rawUrl = URL.createObjectURL(file);

      // Create watermark
      const watermarked = await new Promise<string>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const wm = applyWatermarkToCanvas(img);
          resolve(wm);
        };
        img.onerror = () => resolve(rawUrl);
        img.src = rawUrl;
      });

      nuevosItems.push({
        id: `foto-${Date.now()}-${i}`,
        file,
        previewUrl: rawUrl,
        watermarkedUrl: watermarked,
        tipo: tipoFotoLote,
        nombreOriginal: file.name,
        estado: 'procesada',
        alumnoNombre: alumnoEncontrado ? `${alumnoEncontrado.nombre} ${alumnoEncontrado.apellido || ''}`.trim() : undefined
      });
    }

    setFotosLote(prev => [...nuevosItems, ...prev]);
    setIsProcessing(false);
    setStatusMessage(`¡${files.length} foto(s) procesadas con marca de agua y listas para subir a Supabase para ${seccionActual.nombreCompleto}!`);
    setTimeout(() => setStatusMessage(null), 4000);
  };

  const handleEliminarFotoDeCola = (id: string) => {
    setFotosLote(prev => prev.filter(f => f.id !== id));
  };

  const handleVaciarCola = () => {
    setFotosLote([]);
    setStatusMessage('Lista de espera vaciada.');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleSubirASupabase = async () => {
    if (fotosLote.length === 0) return;
    setIsUploading(true);
    setErrorMessage(null);
    setUploadProgress({ actual: 0, total: fotosLote.length });

    let exitosas = 0;
    let fallidas = 0;
    const colaActualizada = [...fotosLote];

    for (let i = 0; i < colaActualizada.length; i++) {
      const item = colaActualizada[i];
      if (item.file && item.estado !== 'subida') {
        item.estado = 'subiendo';
        setFotosLote([...colaActualizada]);

        const pathHD = `2026/${cursoSeleccionado}/originales/${item.nombreOriginal}`;
        const pathWeb = `2026/${cursoSeleccionado}/muestras/${item.nombreOriginal}`;

        // 1. Upload HD to private bucket
        const resHD = await uploadFotoHD(item.file, pathHD);
        // 2. Upload web preview with watermark
        const resWeb = await uploadFotoWeb(item.file, pathWeb);

        if (resHD.error || resWeb.error) {
          item.estado = 'error';
          item.errorMensaje = resWeb.error || resHD.error;
          fallidas++;
        } else {
          item.estado = 'subida';
          item.errorMensaje = undefined;
          exitosas++;

          // Registrar en el catálogo de fotos activas
          guardarFotoSubida({
            id: `subida-${Date.now()}-${i}`,
            colegioId: colegioSeleccionado,
            cursoCodigo: cursoSeleccionado,
            categoria: item.tipo,
            nombreOriginal: item.nombreOriginal,
            urlWeb: resWeb.publicUrl || item.watermarkedUrl,
            urlHD: resHD.path,
            pathStorageWeb: pathWeb,
            pathStorageHD: pathHD,
            fechaSubida: new Date().toLocaleString('es-AR'),
            tamanoBytes: item.file.size,
            alumnoNombre: item.alumnoNombre
          });
        }

        setUploadProgress({ actual: i + 1, total: colaActualizada.length });
        setFotosLote([...colaActualizada]);
      }
    }

    setIsUploading(false);
    recargarFotosActivas();

    if (fallidas > 0) {
      setErrorMessage(`Se subieron ${exitosas} fotos. ${fallidas} fotos fallaron. Verificá los permisos RLS en Supabase.`);
      setMostrarSqlHelper(true);
    } else {
      setStatusMessage(`¡${exitosas} foto(s) subidas y vinculadas con éxito a Supabase Pro para ${cursoSeleccionado}! Ya están disponibles en el Portal de Familias.`);
      setTimeout(() => setStatusMessage(null), 6000);
      // Remover de la cola las subidas exitosamente
      setFotosLote(prev => prev.filter(f => f.estado !== 'subida'));
    }
  };

  const handleLimpiarSupabaseCompleto = async () => {
    const confirmar = window.confirm(
      '¿Estás seguro de vaciar el almacenamiento de Supabase y eliminar las fotos de prueba?\n\nEsta acción dejará los buckets "fotos-web" y "fotos-hd" limpios para comenzar de cero.'
    );
    if (!confirmar) return;

    setIsProcessing(true);
    try {
      const resWeb = await limpiarStorageBucket('fotos-web');
      const resHD = await limpiarStorageBucket('fotos-hd');
      limpiarTodasLasFotosSubidas();
      setFotosLote([]);
      recargarFotosActivas();

      setStatusMessage(`¡Supabase Storage limpiado con éxito! Se eliminaron ${resWeb.eliminados + resHD.eliminados} archivos de prueba. Listo para la subida de fotos escolares.`);
      setTimeout(() => setStatusMessage(null), 5000);
      handleEjecutarDiagnostico();
    } catch (err: any) {
      setErrorMessage('Error al limpiar Supabase: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsProcessing(false);
    }
  };

  const handleEliminarFotoActiva = async (fotoId: string) => {
    const confirmar = window.confirm('¿Deseás eliminar esta foto de Supabase y del catálogo del curso?');
    if (!confirmar) return;

    await eliminarFotoSubida(fotoId);
    recargarFotosActivas();
    setStatusMessage('Foto eliminada de Supabase.');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleGuardarConfiguracion = (e: React.FormEvent) => {
    e.preventDefault();
    saveSupabaseConfig(configUrl, configKey);
    setMostrarConfigSupabase(false);
    setStatusMessage('Configuración de Supabase actualizada.');
    setTimeout(() => setStatusMessage(null), 3000);
    handleEjecutarDiagnostico();
  };

  const handleRestaurarConfiguracion = () => {
    resetSupabaseConfig();
    const def = getSupabaseConfig();
    setConfigUrl(def.url);
    setConfigKey(def.anonKey);
    setMostrarConfigSupabase(false);
    setStatusMessage('Configuración restaurada a los valores predeterminados.');
    setTimeout(() => setStatusMessage(null), 3000);
    handleEjecutarDiagnostico();
  };

  const sqlPoliticas = `-- ==========================================
-- POLÍTICAS DE ACCESO PARA SUPABASE STORAGE
-- Ejecutar en Supabase -> SQL Editor -> Run
-- ==========================================

-- 1. Crear / Asegurar los dos buckets necesarios
INSERT INTO storage.buckets (id, name, public) 
VALUES 
  ('fotos-web', 'fotos-web', true),
  ('fotos-hd', 'fotos-hd', false)
ON CONFLICT (id) DO UPDATE SET public = EXCLUDED.public;

-- 2. Permitir a la aplicación subir fotos a fotos-web
CREATE POLICY "Permitir subida a fotos-web" 
ON storage.objects FOR INSERT 
TO anon, authenticated 
WITH CHECK (bucket_id = 'fotos-web');

-- 3. Permitir ver fotos-web públicamente (para las familias)
CREATE POLICY "Permitir lectura publica fotos-web" 
ON storage.objects FOR SELECT 
TO public 
USING (bucket_id = 'fotos-web');

-- 4. Permitir subir fotos de alta resolución a fotos-hd
CREATE POLICY "Permitir subida a fotos-hd" 
ON storage.objects FOR INSERT 
TO anon, authenticated 
WITH CHECK (bucket_id = 'fotos-hd');

-- 5. Permitir lectura de fotos-hd para generar enlaces de descarga
CREATE POLICY "Permitir lectura fotos-hd" 
ON storage.objects FOR SELECT 
TO anon, authenticated 
USING (bucket_id = 'fotos-hd');

-- 6. Permitir eliminar/actualizar fotos
CREATE POLICY "Permitir actualizar y borrar fotos" 
ON storage.objects FOR ALL 
TO anon, authenticated 
USING (bucket_id IN ('fotos-web', 'fotos-hd'));`;

  const handleCopiarSql = () => {
    navigator.clipboard.writeText(sqlPoliticas);
    setSqlCopiado(true);
    setTimeout(() => setSqlCopiado(false), 3000);
  };

  return (
    <div className="space-y-6 text-left">
      {/* Toast Feedback */}
      {statusMessage && (
        <div className="p-4 bg-emerald-50 border border-emerald-300 text-emerald-950 rounded-2xl text-xs font-bold flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
            <span>{statusMessage}</span>
          </div>
          <button 
            onClick={() => setStatusMessage(null)}
            className="text-emerald-700 hover:text-emerald-900 text-xs px-2 py-1 rounded bg-emerald-100 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {errorMessage && (
        <div className="p-4 bg-rose-50 border border-rose-300 text-rose-950 rounded-2xl text-xs font-bold flex items-center justify-between gap-3 shadow-xs animate-in fade-in">
          <div className="flex items-center gap-2">
            <AlertCircle className="w-5 h-5 text-rose-600 shrink-0" />
            <span>{errorMessage}</span>
          </div>
          <button 
            onClick={() => setErrorMessage(null)}
            className="text-rose-700 hover:text-rose-900 text-xs px-2 py-1 rounded bg-rose-100 cursor-pointer"
          >
            Cerrar
          </button>
        </div>
      )}

      {/* Supabase Connection Status Card */}
      <div className="p-5 rounded-2xl bg-slate-900 text-white shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center border border-emerald-500/30">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-bold tracking-wide">Almacenamiento Supabase Pro (100 GB)</h3>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-extrabold bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                  Activo
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5 truncate max-w-md font-mono">
                {getSupabaseConfig().url}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleEjecutarDiagnostico}
              disabled={isTestingSupabase}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-1.5 cursor-pointer"
              title="Probar conexión con Supabase Storage"
            >
              <RefreshCw className={`w-3.5 h-3.5 text-amber-400 ${isTestingSupabase ? 'animate-spin' : ''}`} />
              <span>Probar Conexión</span>
            </button>
            <button
              onClick={() => setMostrarConfigSupabase(!mostrarConfigSupabase)}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-1.5 cursor-pointer"
              title="Configurar credenciales o Service Role"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-300" />
              <span>Ajustes</span>
            </button>
            <button
              onClick={handleLimpiarSupabaseCompleto}
              disabled={isProcessing}
              className="px-3 py-1.5 bg-rose-950/60 hover:bg-rose-900 text-rose-300 text-xs font-bold rounded-xl transition-all border border-rose-800/60 flex items-center gap-1.5 cursor-pointer"
              title="Vaciar buckets y dejar listo para producción"
            >
              <Trash2 className="w-3.5 h-3.5 text-rose-400" />
              <span>Limpiar Supabase</span>
            </button>
          </div>
        </div>

        {/* Diagnostic Status Chips */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Bucket Público (Muestras):</span>
            <div className="flex items-center gap-2 mt-1 font-mono font-bold">
              <span className="text-amber-300">fotos-web</span>
              {diagnostico ? (
                diagnostico.fotosWebStatus === 'ok' ? (
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    ✓ Listo
                  </span>
                ) : diagnostico.fotosWebStatus === 'rls_blocked' ? (
                  <span className="text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                    ⚠ Falta RLS
                  </span>
                ) : (
                  <span className="text-[10px] text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800">
                    ✗ Error
                  </span>
                )
              ) : (
                <span className="text-[10px] text-slate-400">Verificando...</span>
              )}
            </div>
          </div>

          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Bucket Privado (Originales HD):</span>
            <div className="flex items-center gap-2 mt-1 font-mono font-bold">
              <span className="text-sky-300">fotos-hd</span>
              {diagnostico ? (
                diagnostico.fotosHdStatus === 'ok' ? (
                  <span className="text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-800">
                    ✓ Listo
                  </span>
                ) : diagnostico.fotosHdStatus === 'rls_blocked' ? (
                  <span className="text-[10px] text-amber-400 bg-amber-950/60 px-2 py-0.5 rounded border border-amber-800">
                    ⚠ Falta RLS
                  </span>
                ) : (
                  <span className="text-[10px] text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded border border-rose-800">
                    ✗ Error
                  </span>
                )
              ) : (
                <span className="text-[10px] text-slate-400">Verificando...</span>
              )}
            </div>
          </div>

          <div className="bg-slate-800/80 p-3 rounded-xl border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Tipo de Clave Configurada:</span>
            <div className="flex items-center gap-2 mt-1 font-semibold">
              <Key className="w-3.5 h-3.5 text-amber-400" />
              <span className="text-slate-200">
                {diagnostico?.keyType === 'service_role' 
                  ? 'Service Role (Acceso Total)' 
                  : diagnostico?.keyType === 'publishable_anon'
                  ? 'Anon Publishable'
                  : 'Clave Personalizada'}
              </span>
            </div>
          </div>
        </div>

        {/* Expandable Configuration Form */}
        {mostrarConfigSupabase && (
          <form onSubmit={handleGuardarConfiguracion} className="bg-slate-800/90 p-4 rounded-xl border border-slate-700 space-y-3">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Configurar Claves de Supabase
            </h4>
            <p className="text-[11px] text-slate-300">
              Podés pegar tu <strong>Service Role Key</strong> (recomendado para fotógrafo administrador, sin restricciones de RLS) o tu <strong>Anon Key</strong>.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Supabase URL</label>
                <input
                  type="text"
                  required
                  value={configUrl}
                  onChange={e => setConfigUrl(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs"
                />
              </div>
              <div className="space-y-1">
                <label className="text-slate-300 font-bold">Supabase Key (Anon o Service Role)</label>
                <input
                  type="password"
                  required
                  value={configKey}
                  onChange={e => setConfigKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs"
                  placeholder="sb_publishable_... o ey..."
                />
              </div>
            </div>
            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={handleRestaurarConfiguracion}
                className="px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-xs font-bold rounded-lg cursor-pointer"
              >
                Restaurar por Defecto
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 text-xs font-bold rounded-lg cursor-pointer shadow"
              >
                Guardar y Conectar
              </button>
            </div>
          </form>
        )}

        {/* Expandable SQL RLS Helper */}
        {mostrarSqlHelper && (
          <div className="bg-amber-950/40 border border-amber-500/40 p-4 rounded-xl space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <h5 className="text-xs font-bold text-amber-300 flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-amber-400" />
                  <span>Configurar Permisos RLS en Supabase (Solo 1 Vez)</span>
                </h5>
                <p className="text-[11px] text-amber-200/90 mt-1">
                  Si Supabase bloquea las subidas por política de seguridad (RLS), copiá este script y pegalo en el <strong>SQL Editor</strong> de tu panel de Supabase:
                </p>
              </div>
              <button
                type="button"
                onClick={handleCopiarSql}
                className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold text-xs rounded-lg flex items-center gap-1.5 shrink-0 cursor-pointer shadow"
              >
                {sqlCopiado ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                <span>{sqlCopiado ? '¡Copiado!' : 'Copiar SQL'}</span>
              </button>
            </div>

            <pre className="p-3 bg-slate-950/80 rounded-lg text-[10px] font-mono text-slate-300 overflow-x-auto max-h-36 border border-slate-800">
              {sqlPoliticas}
            </pre>
          </div>
        )}
      </div>

      {/* Course & Batch Selection Controls */}
      <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wider flex items-center gap-2">
          <Camera className="w-4 h-4 text-amber-600" />
          <span>Carga Masiva de Fotos por Curso / Sesión</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4">
          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Colegio</label>
            <select
              value={colegioSeleccionado}
              onChange={(e) => setColegioSeleccionado(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 font-medium"
            >
              {colegios.map(c => (
                <option key={c.id} value={c.id}>{c.nombre}</option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Curso / Sección</label>
            <select
              value={cursoSeleccionado}
              onChange={(e) => {
                setCursoSeleccionado(e.target.value);
                setAlumnoSeleccionadoId('');
              }}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 font-bold"
            >
              {SECCIONES_INICIAL_2026.map(sec => (
                <option key={sec.id} value={CODIGOS_CURSOS_INICIALES[sec.id] || sec.id}>
                  {sec.nombreCompleto} ({sec.totalAlumnos} alumnos) - {CODIGOS_CURSOS_INICIALES[sec.id] || sec.id}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">Categoría de la Toma</label>
            <select
              value={tipoFotoLote}
              onChange={(e) => setTipoFotoLote(e.target.value as any)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 font-medium"
            >
              <option value="individual">Retratos Individuales (15x21)</option>
              <option value="grupal">Foto Grupal del Curso (20x30)</option>
              <option value="docente">Foto con Docente / Seño (15x21)</option>
            </select>
          </div>

          <div className="space-y-1">
            <label className="text-xs font-bold text-slate-700">
              Asignar a Alumno <span className="font-normal text-slate-400">(opcional)</span>
            </label>
            <select
              value={alumnoSeleccionadoId}
              onChange={(e) => setAlumnoSeleccionadoId(e.target.value)}
              className="w-full px-3 py-2 rounded-xl border border-slate-200 text-xs bg-slate-50 font-medium truncate"
            >
              <option value="">-- Sin asignar / Múltiples --</option>
              {alumnosDelCurso.map(a => (
                <option key={a.id} value={a.id}>
                  {a.nombre} {a.apellido || ''}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Drag and Drop Zone */}
        <div className="relative border-2 border-dashed border-amber-300 hover:border-amber-400 bg-amber-50/50 hover:bg-amber-50/80 rounded-2xl p-8 text-center transition-all">
          <input
            type="file"
            multiple
            accept="image/*"
            disabled={isProcessing || isUploading}
            onChange={(e) => handleFilesSelected(e.target.files)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />
          <div className="space-y-2 pointer-events-none">
            <div className="w-12 h-12 rounded-full bg-amber-400 text-slate-950 flex items-center justify-center mx-auto shadow-md">
              <Upload className="w-6 h-6" />
            </div>
            <p className="text-sm font-extrabold text-slate-900">
              Arrastrá las fotos de {seccionActual.nombreCompleto} aquí o hacé clic para seleccionar
            </p>
            <p className="text-xs text-slate-500 max-w-xl mx-auto">
              Podés seleccionar 1, 20 o 50 fotos al mismo tiempo. El sistema aplicará la marca de agua fotográfica y las preparará para subirlas a Supabase Storage con código <strong className="text-amber-900 font-mono">{cursoSeleccionado}</strong>.
            </p>
          </div>
        </div>
      </div>

      {/* STAGING QUEUE: Fotos seleccionadas pendientes de subir */}
      {fotosLote.length > 0 && (
        <div className="p-5 rounded-2xl bg-white border border-slate-200 shadow-xs space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-3">
            <div>
              <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
                <span>Fotos preparadas para subir ({fotosLote.length})</span>
                <span className="text-[11px] font-bold text-amber-800 bg-amber-100 px-2 py-0.5 rounded-full border border-amber-200">
                  {cursoSeleccionado}
                </span>
              </h4>
              <span className="text-[11px] text-slate-500">
                Verificá las muestras antes de sincronizarlas con Supabase Pro
              </span>
            </div>

            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={handleVaciarCola}
                disabled={isUploading}
                className="px-3 py-1.5 text-xs text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer"
              >
                Vaciar lista
              </button>
              <button
                type="button"
                onClick={handleSubirASupabase}
                disabled={isUploading || isProcessing}
                className="px-4 py-2 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-slate-950 text-xs font-extrabold rounded-xl transition-all shadow flex items-center gap-2 cursor-pointer"
              >
                {isUploading ? (
                  <>
                    <RefreshCw className="w-4 h-4 animate-spin text-slate-950" />
                    <span>Subiendo ({uploadProgress.actual}/{uploadProgress.total})...</span>
                  </>
                ) : (
                  <>
                    <HardDrive className="w-4 h-4" />
                    <span>Subir {fotosLote.length} foto(s) a Supabase</span>
                  </>
                )}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {fotosLote.map((foto) => (
              <div 
                key={foto.id}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs group relative"
              >
                <div className="relative aspect-4/3 bg-black overflow-hidden">
                  <img 
                    src={foto.watermarkedUrl} 
                    alt={foto.nombreOriginal}
                    className="w-full h-full object-cover" 
                  />
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-950/80 text-amber-300 uppercase">
                    {foto.tipo}
                  </span>

                  {!isUploading && (
                    <button
                      type="button"
                      onClick={() => handleEliminarFotoDeCola(foto.id)}
                      className="absolute top-1.5 right-1.5 p-1 rounded bg-rose-600/90 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Quitar de la lista"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}

                  {/* Upload State Overlay */}
                  {foto.estado === 'subiendo' && (
                    <div className="absolute inset-0 bg-slate-950/70 flex flex-col items-center justify-center text-amber-400 gap-1 text-[10px] font-bold">
                      <RefreshCw className="w-4 h-4 animate-spin" />
                      <span>Subiendo...</span>
                    </div>
                  )}

                  {foto.estado === 'subida' && (
                    <div className="absolute top-1.5 right-1.5 p-1 rounded-full bg-emerald-500 text-slate-950 shadow">
                      <Check className="w-3 h-3 stroke-[3]" />
                    </div>
                  )}

                  {foto.estado === 'error' && (
                    <div className="absolute inset-0 bg-rose-950/80 p-2 flex flex-col items-center justify-center text-rose-200 text-center text-[10px]">
                      <AlertCircle className="w-4 h-4 text-rose-400 mb-1" />
                      <span className="font-bold">Error al subir</span>
                      <span className="text-[9px] line-clamp-2 mt-0.5">{foto.errorMensaje}</span>
                    </div>
                  )}
                </div>

                <div className="p-2 text-[10px]">
                  <p className="font-semibold text-slate-800 truncate" title={foto.nombreOriginal}>
                    {foto.nombreOriginal}
                  </p>
                  {foto.alumnoNombre && (
                    <p className="text-amber-700 font-bold truncate">
                      👤 {foto.alumnoNombre}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-slate-400 mt-0.5">
                    <span>Marca lista</span>
                    <span className={`font-bold ${
                      foto.estado === 'subida' ? 'text-emerald-600' :
                      foto.estado === 'error' ? 'text-rose-600' :
                      foto.estado === 'subiendo' ? 'text-amber-600' : 'text-slate-500'
                    }`}>
                      {foto.estado === 'subida' ? '✓ En Supabase' :
                       foto.estado === 'error' ? '✗ Error' :
                       foto.estado === 'subiendo' ? '⏳ Subiendo' : 'Listo'}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ACTIVE SUPABASE PHOTOS FOR CURRENT COURSE */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h4 className="text-sm font-bold text-slate-900 flex items-center gap-2">
              <ImageIcon className="w-4 h-4 text-amber-600" />
              <span>Fotos Activas en Supabase para {seccionActual.nombreCompleto} ({fotosActivasCurso.length})</span>
            </h4>
            <span className="text-[11px] text-slate-500">
              Estas son las fotos que ven las familias cuando ingresan el código <strong className="text-slate-900 font-mono">{cursoSeleccionado}</strong>
            </span>
          </div>

          {fotosActivasCurso.length > 0 && (
            <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
              <span>{fotosActivasCurso.length} fotos listas para venta</span>
            </span>
          )}
        </div>

        {fotosActivasCurso.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center mx-auto">
              <Camera className="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-slate-700">
              No hay fotos cargadas aún para {seccionActual.nombreCompleto}
            </p>
            <p className="text-xs text-slate-500 max-w-md mx-auto">
              El almacenamiento está limpio y listo. Arrastrá las fotos del curso arriba para comenzar la carga a Supabase Pro.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {fotosActivasCurso.map((foto) => (
              <div 
                key={foto.id}
                className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-2xs group relative"
              >
                <div className="relative aspect-4/3 bg-black overflow-hidden">
                  <img 
                    src={foto.urlWeb} 
                    alt={foto.nombreOriginal}
                    className="w-full h-full object-cover" 
                  />
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-950/80 text-amber-300 uppercase">
                    {foto.categoria}
                  </span>

                  <button
                    type="button"
                    onClick={() => handleEliminarFotoActiva(foto.id)}
                    className="absolute top-1.5 right-1.5 p-1 rounded bg-rose-600/90 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                    title="Eliminar de Supabase"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>

                <div className="p-2 text-[10px]">
                  <p className="font-semibold text-slate-800 truncate" title={foto.nombreOriginal}>
                    {foto.nombreOriginal}
                  </p>
                  {foto.alumnoNombre && (
                    <p className="text-amber-700 font-bold truncate">
                      👤 {foto.alumnoNombre}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-slate-400 mt-0.5 text-[9px]">
                    <span className="truncate">{foto.fechaSubida.split(' ')[0]}</span>
                    <span className="text-emerald-600 font-bold">✓ En Supabase</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
