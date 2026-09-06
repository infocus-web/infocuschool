import React, { useState, useMemo, useEffect, useRef } from 'react';
import {
  Camera, Upload, CheckCircle2,
  Trash2, RefreshCw, ShieldCheck, Check,
  AlertCircle, Database, Copy, HardDrive, Key,
  Sliders, Image as ImageIcon, Sparkles, User,
  X, CheckSquare, Square, Wand2
} from 'lucide-react';
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
  registrarFotosAdmin,
  obtenerFotosActivasAdmin,
  eliminarFotoActivaAdmin,
  limpiarTodasLasFotosAdmin,
  regenerarMiniaturasAdmin,
  regenerarMarcaAguaAdmin,
  FotoRegistrada
} from '../services/fotosSubidasService';

interface FotoLoteItem {
  id: string;
  file?: File;
  previewUrl: string;
  watermarkedUrl: string;
  thumbUrl: string;
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
  const [fotosActivasCurso, setFotosActivasCurso] = useState<FotoRegistrada[]>([]);

  const [isProcessing, setIsProcessing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<{ actual: number; total: number }>({ actual: 0, total: 0 });
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const cancelarSubidaRef = useRef(false);
  const [cancelandoSubida, setCancelandoSubida] = useState(false);

  // Selección múltiple para borrar varias fotos activas de una sola vez
  const [modoSeleccionActivas, setModoSeleccionActivas] = useState(false);
  const [idsSeleccionados, setIdsSeleccionados] = useState<Set<string>>(new Set());
  const [borrandoSeleccionadas, setBorrandoSeleccionadas] = useState(false);
  // Filtro por categoría en "Fotos Activas": permite ver/seleccionar/borrar sólo una
  // categoría puntual (por ejemplo, sólo "Grupal") sin tocar el resto del curso.
  const [filtroCategoriaActivas, setFiltroCategoriaActivas] = useState<'todas' | 'individual' | 'grupal' | 'docente'>('todas');

  // Migración de miniaturas limpias para fotos subidas antes de este cambio
  const [regenerandoMiniaturas, setRegenerandoMiniaturas] = useState(false);
  const [progresoMiniaturas, setProgresoMiniaturas] = useState<{ procesadas: number; fallidas: number; restantes: number } | null>(null);

  // Migración de la marca de agua más liviana para fotos ya subidas (vista ampliada)
  const [regenerandoMarcaAgua, setRegenerandoMarcaAgua] = useState(false);
  const [progresoMarcaAgua, setProgresoMarcaAgua] = useState<{ procesadas: number; fallidas: number; restantes: number } | null>(null);

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

  // Cargar fotos activas del curso (desde Supabase, vía el panel admin)
  const recargarFotosActivas = async () => {
    const fotos = await obtenerFotosActivasAdmin({
      colegioId: colegioSeleccionado,
      grado: seccionActual.sala,
      turno: seccionActual.turno,
      division: seccionActual.division,
    });
    setFotosActivasCurso(fotos);
  };

  useEffect(() => {
    recargarFotosActivas();
    // Al cambiar de curso, no arrastrar selección ni filtro del curso anterior.
    setFiltroCategoriaActivas('todas');
    setModoSeleccionActivas(false);
    setIdsSeleccionados(new Set());
  }, [cursoSeleccionado, colegioSeleccionado]);

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

  // Convierte el dataURL del canvas (siempre JPEG) en un Blob real para subirlo a Supabase Storage
  const dataUrlABlob = (dataUrl: string): Blob => {
    const [header, base64] = dataUrl.split(',');
    const mimeMatch = header.match(/data:(.*?);base64/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const binario = atob(base64);
    const bytes = new Uint8Array(binario.length);
    for (let i = 0; i < binario.length; i++) bytes[i] = binario.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  };

  // Watermarking generator function — además reduce el tamaño para que la copia pública
  // (fotos-web) sea liviana: la marca de agua queda quemada en los píxeles, no es un
  // simple overlay, así que esta es la única versión que se sube al bucket público.
  const applyWatermarkToCanvas = (img: HTMLImageElement): string => {
    const MAX_DIMENSION = 1600;
    let anchoDestino = img.width;
    let altoDestino = img.height;
    if (anchoDestino > MAX_DIMENSION || altoDestino > MAX_DIMENSION) {
      const escala = MAX_DIMENSION / Math.max(anchoDestino, altoDestino);
      anchoDestino = Math.round(anchoDestino * escala);
      altoDestino = Math.round(altoDestino * escala);
    }

    const canvas = document.createElement('canvas');
    canvas.width = anchoDestino;
    canvas.height = altoDestino;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img.src;

    ctx.drawImage(img, 0, 0, anchoDestino, altoDestino);

    ctx.save();
    // Marca de agua real, quemada en los píxeles (no se puede desactivar ni quitar):
    // visible y legible, pero sin la densidad exagerada de la versión original.
    const text = 'MUESTRA RETRATO ESCOLAR · FOTOGRAFÍA ESCOLAR';
    const fontSize = Math.max(14, Math.round(canvas.width * 0.036));
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.fillStyle = 'rgba(255, 255, 255, 0.6)';
    ctx.shadowColor = 'rgba(0, 0, 0, 0.65)';
    ctx.shadowBlur = 4;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';

    ctx.translate(canvas.width / 2, canvas.height / 2);
    ctx.rotate((-25 * Math.PI) / 180);

    const stepX = canvas.width * 0.58;
    const stepY = canvas.height * 0.28;
    for (let y = -canvas.height; y < canvas.height; y += stepY) {
      for (let x = -canvas.width; x < canvas.width; x += stepX) {
        ctx.fillText(text, x, y);
      }
    }
    ctx.restore();

    return canvas.toDataURL('image/jpeg', 0.85);
  };

  // Miniatura liviana SIN marca de agua: es la que ven las familias en la grilla de la
  // galería. Al ser chica (ideal para una miniatura) no sirve para imprimir ni para robar
  // una copia útil, así que no hace falta quemarle el texto encima — la protección real
  // (marca de agua quemada en los píxeles) sigue estando en la versión ampliada.
  const generarMiniaturaLimpia = (img: HTMLImageElement): string => {
    const MAX_DIMENSION_THUMB = 500;
    let anchoDestino = img.width;
    let altoDestino = img.height;
    if (anchoDestino > MAX_DIMENSION_THUMB || altoDestino > MAX_DIMENSION_THUMB) {
      const escala = MAX_DIMENSION_THUMB / Math.max(anchoDestino, altoDestino);
      anchoDestino = Math.round(anchoDestino * escala);
      altoDestino = Math.round(altoDestino * escala);
    }
    const canvas = document.createElement('canvas');
    canvas.width = anchoDestino;
    canvas.height = altoDestino;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img.src;
    ctx.drawImage(img, 0, 0, anchoDestino, altoDestino);
    return canvas.toDataURL('image/jpeg', 0.82);
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

      // Genera, a partir de la misma imagen cargada una sola vez, la versión ampliada
      // (con marca de agua quemada) y la miniatura liviana (limpia, sin marca de agua)
      const { watermarked, miniatura } = await new Promise<{ watermarked: string; miniatura: string }>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const wm = applyWatermarkToCanvas(img);
          const mini = generarMiniaturaLimpia(img);
          resolve({ watermarked: wm, miniatura: mini });
        };
        img.onerror = () => resolve({ watermarked: rawUrl, miniatura: rawUrl });
        img.src = rawUrl;
      });

      nuevosItems.push({
        id: `foto-${Date.now()}-${i}`,
        file,
        previewUrl: rawUrl,
        watermarkedUrl: watermarked,
        thumbUrl: miniatura,
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

  const handleCancelarSubida = () => {
    cancelarSubidaRef.current = true;
    setCancelandoSubida(true);
  };

  const handleSubirASupabase = async () => {
    if (fotosLote.length === 0) return;
    setIsUploading(true);
    setCancelandoSubida(false);
    cancelarSubidaRef.current = false;
    setErrorMessage(null);
    setUploadProgress({ actual: 0, total: fotosLote.length });

    let exitosas = 0;
    let fallidas = 0;
    let canceladaEn = -1;
    const colaActualizada = [...fotosLote];
    const fotosParaRegistrar: { colegioId: string; categoria: 'individual' | 'grupal' | 'docente'; grado: string; turno: string; division: string; storagePathHD: string; storagePathWeb: string; storagePathThumb: string; alumnoNombre?: string }[] = [];

    for (let i = 0; i < colaActualizada.length; i++) {
      if (cancelarSubidaRef.current) {
        canceladaEn = i;
        break;
      }
      const item = colaActualizada[i];
      if (item.file && item.estado !== 'subida') {
        item.estado = 'subiendo';
        setFotosLote([...colaActualizada]);

        const pathHD = `2026/${cursoSeleccionado}/originales/${item.nombreOriginal}`;
        const nombreBaseWeb = item.nombreOriginal.replace(/\.[^./]+$/, '');
        const pathWeb = `2026/${cursoSeleccionado}/muestras/${nombreBaseWeb}.jpg`;
        const pathThumb = `2026/${cursoSeleccionado}/miniaturas/${nombreBaseWeb}.jpg`;

        // 1. Upload HD (el archivo original, sin tocar) al bucket privado
        const resHD = await uploadFotoHD(item.file, pathHD);
        // 2. Upload al bucket público de la copia YA reducida y con la marca de agua quemada
        //    en los píxeles (item.watermarkedUrl), no el archivo original — así lo que queda
        //    en la dirección pública nunca es la foto limpia. Esta es la que se ve al ampliar.
        const blobWeb = dataUrlABlob(item.watermarkedUrl);
        const resWeb = await uploadFotoWeb(blobWeb, pathWeb);
        // 3. Upload de la miniatura chica y limpia (sin marca de agua) para la grilla de la galería
        const blobThumb = dataUrlABlob(item.thumbUrl);
        const resThumb = await uploadFotoWeb(blobThumb, pathThumb);

        if (resHD.error || resWeb.error || resThumb.error) {
          item.estado = 'error';
          item.errorMensaje = resWeb.error || resThumb.error || resHD.error;
          fallidas++;
        } else {
          item.estado = 'subida';
          item.errorMensaje = undefined;
          exitosas++;

          // Preparar para registrar en el catálogo de fotos activas (Supabase)
          fotosParaRegistrar.push({
            colegioId: colegioSeleccionado,
            categoria: item.tipo,
            grado: seccionActual.sala,
            turno: seccionActual.turno,
            division: seccionActual.division,
            storagePathHD: pathHD,
            storagePathWeb: resWeb.publicUrl || pathWeb,
            storagePathThumb: resThumb.publicUrl || pathThumb,
            alumnoNombre: item.alumnoNombre
          });
        }

        setUploadProgress({ actual: i + 1, total: colaActualizada.length });
        setFotosLote([...colaActualizada]);
      }
    }

    // Registrar en Supabase, en un solo lote, las fotos subidas con éxito
    if (fotosParaRegistrar.length > 0) {
      const resultadoRegistro = await registrarFotosAdmin(fotosParaRegistrar);
      if (!resultadoRegistro.success) {
        setErrorMessage(resultadoRegistro.error || 'Las fotos se subieron a Storage pero no se pudieron registrar en el catálogo.');
      }
    }

    setIsUploading(false);
    setCancelandoSubida(false);
    cancelarSubidaRef.current = false;
    await recargarFotosActivas();

    const fueCancelada = canceladaEn !== -1;
    const pendientes = colaActualizada.filter(f => f.estado !== 'subida').length;

    if (fueCancelada) {
      setStatusMessage(`Subida cancelada: ${exitosas} foto(s) ya quedaron guardadas en Supabase, ${pendientes} quedaron pendientes en la lista para subir después.`);
      setTimeout(() => setStatusMessage(null), 7000);
      setFotosLote(colaActualizada.filter(f => f.estado !== 'subida'));
    } else if (fallidas > 0) {
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
      '¿Estás seguro de vaciar el almacenamiento de Supabase y eliminar las fotos subidas?\n\nEsta acción dejará los buckets "fotos-web" y "fotos-hd" limpios.'
    );
    if (!confirmar) return;

    setIsProcessing(true);
    try {
      const resWeb = await limpiarStorageBucket('fotos-web');
      const resHD = await limpiarStorageBucket('fotos-hd');
      await limpiarTodasLasFotosAdmin();
      setFotosLote([]);
      await recargarFotosActivas();

      setStatusMessage(`¡Supabase Storage limpiado con éxito! Se eliminaron ${resWeb.eliminados + resHD.eliminados} archivos. Listo para la subida de fotos escolares.`);
      setTimeout(() => setStatusMessage(null), 5000);
      handleEjecutarDiagnostico();
    } catch (err: any) {
      setErrorMessage('Error al limpiar Supabase: ' + (err?.message || 'Error desconocido'));
    } finally {
      setIsProcessing(false);
    }
  };

  // Migración: fotos que ya estaban subidas antes de separar la miniatura limpia de la
  // versión con marca de agua. Genera la miniatura faltante a partir del original guardado,
  // sin tener que volver a subir nada. Se llama al endpoint en bucle porque el servidor
  // procesa de a un lote chico por vez (para no exceder el tiempo de una función serverless).
  const handleRegenerarMiniaturas = async () => {
    const confirmar = window.confirm(
      'Esto va a generar la miniatura limpia (sin marca de agua) para todas las fotos que ya subiste antes de este cambio — incluidas las de prueba duplicadas. Puede tardar unos minutos. ¿Continuar?'
    );
    if (!confirmar) return;

    setRegenerandoMiniaturas(true);
    setErrorMessage(null);
    let totalProcesadas = 0;
    let totalFallidas = 0;
    let restantes = 1;

    try {
      while (restantes > 0) {
        const resultado = await regenerarMiniaturasAdmin(12);
        if (!resultado.success) {
          setErrorMessage(resultado.error || 'No se pudieron regenerar las miniaturas.');
          break;
        }
        totalProcesadas += resultado.procesadas || 0;
        totalFallidas += resultado.fallidas || 0;
        restantes = resultado.restantes || 0;
        setProgresoMiniaturas({ procesadas: totalProcesadas, fallidas: totalFallidas, restantes });
      }
      setStatusMessage(
        `¡Listo! Se regeneraron ${totalProcesadas} miniatura(s) limpia(s)${totalFallidas > 0 ? `, ${totalFallidas} fallaron` : ''}.`
      );
      setTimeout(() => setStatusMessage(null), 8000);
      await recargarFotosActivas();
    } finally {
      setRegenerandoMiniaturas(false);
      setProgresoMiniaturas(null);
    }
  };

  // Migración: re-genera la vista ampliada (con marca de agua quemada) de TODAS las fotos
  // ya subidas, usando la nueva versión más liviana y espaciada — a partir del original
  // guardado, sin volver a subir nada. Avanza con "offset" en lugar de filtrar, porque acá
  // se quiere reprocesar cada foto una sola vez, ya tenga o no la marca vieja.
  const handleRegenerarMarcaAgua = async () => {
    const confirmar = window.confirm(
      'Esto va a re-generar la vista ampliada de TODAS las fotos ya subidas con la nueva marca de agua, más liviana y espaciada. Puede tardar varios minutos. ¿Continuar?'
    );
    if (!confirmar) return;

    setRegenerandoMarcaAgua(true);
    setErrorMessage(null);
    let totalProcesadas = 0;
    let totalFallidas = 0;
    let restantes = 1;
    let offset = 0;

    try {
      while (restantes > 0) {
        const resultado = await regenerarMarcaAguaAdmin(8, offset);
        if (!resultado.success) {
          setErrorMessage(resultado.error || 'No se pudo regenerar la marca de agua.');
          break;
        }
        totalProcesadas += resultado.procesadas || 0;
        totalFallidas += resultado.fallidas || 0;
        restantes = resultado.restantes || 0;
        offset = resultado.siguienteOffset || offset;
        setProgresoMarcaAgua({ procesadas: totalProcesadas, fallidas: totalFallidas, restantes });
      }
      setStatusMessage(
        `¡Listo! Se actualizó la marca de agua de ${totalProcesadas} foto(s)${totalFallidas > 0 ? `, ${totalFallidas} fallaron` : ''}.`
      );
      setTimeout(() => setStatusMessage(null), 8000);
      await recargarFotosActivas();
    } finally {
      setRegenerandoMarcaAgua(false);
      setProgresoMarcaAgua(null);
    }
  };

  const handleEliminarFotoActiva = async (foto: FotoRegistrada) => {
    const confirmar = window.confirm('¿Deseás eliminar esta foto de Supabase y del catálogo del curso?');
    if (!confirmar) return;

    const resultado = await eliminarFotoActivaAdmin(foto);
    if (!resultado.success) {
      setErrorMessage(resultado.error || 'No se pudo eliminar la foto.');
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    await recargarFotosActivas();
    setStatusMessage('Foto eliminada de Supabase.');
    setTimeout(() => setStatusMessage(null), 3000);
  };

  const handleToggleModoSeleccion = () => {
    setModoSeleccionActivas(prev => !prev);
    setIdsSeleccionados(new Set());
  };

  // Conteo de fotos activas por categoría (para las pestañas de filtro) y la lista ya
  // filtrada según la categoría elegida — "todas" muestra el curso completo, como antes.
  const conteoActivasPorCategoria = useMemo(() => {
    const conteo = { individual: 0, grupal: 0, docente: 0 };
    for (const f of fotosActivasCurso) {
      if (f.categoria === 'individual') conteo.individual++;
      else if (f.categoria === 'grupal') conteo.grupal++;
      else if (f.categoria === 'docente') conteo.docente++;
    }
    return conteo;
  }, [fotosActivasCurso]);

  const fotosActivasFiltradas = useMemo(() => {
    if (filtroCategoriaActivas === 'todas') return fotosActivasCurso;
    return fotosActivasCurso.filter(f => f.categoria === filtroCategoriaActivas);
  }, [fotosActivasCurso, filtroCategoriaActivas]);

  const handleToggleSeleccionFoto = (id: string) => {
    setIdsSeleccionados(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSeleccionarTodasActivas = () => {
    // Respeta el filtro de categoría activo: si estás viendo sólo "Grupal", selecciona
    // sólo esas — no todo el curso.
    setIdsSeleccionados(new Set(fotosActivasFiltradas.map(f => f.id)));
  };

  const handleEliminarSeleccionadas = async () => {
    if (idsSeleccionados.size === 0) return;
    const confirmar = window.confirm(
      `¿Deseás eliminar ${idsSeleccionados.size} foto(s) de Supabase y del catálogo del curso? Esta acción no se puede deshacer.`
    );
    if (!confirmar) return;

    setBorrandoSeleccionadas(true);
    const aBorrar = fotosActivasCurso.filter(f => idsSeleccionados.has(f.id));
    let exitosas = 0;
    let fallidas = 0;

    for (const foto of aBorrar) {
      const resultado = await eliminarFotoActivaAdmin(foto);
      if (resultado.success) exitosas++;
      else fallidas++;
    }

    setBorrandoSeleccionadas(false);
    setIdsSeleccionados(new Set());
    setModoSeleccionActivas(false);
    await recargarFotosActivas();

    if (fallidas > 0) {
      setErrorMessage(`Se eliminaron ${exitosas} foto(s). ${fallidas} no se pudieron eliminar.`);
      setTimeout(() => setErrorMessage(null), 6000);
    } else {
      setStatusMessage(`${exitosas} foto(s) eliminadas de Supabase.`);
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const handleGuardarConfiguracion = (e: React.FormEvent) => {
    e.preventDefault();
    const res = saveSupabaseConfig(configUrl, configKey);
    if (!res.ok) {
      setErrorMessage(res.error || 'Clave de Supabase rechazada por seguridad.');
      setTimeout(() => setErrorMessage(null), 5000);
      return;
    }
    setMostrarConfigSupabase(false);
    setStatusMessage('Configuración de Supabase actualizada con éxito.');
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
              title="Configurar credenciales Anon de Supabase"
            >
              <Sliders className="w-3.5 h-3.5 text-slate-300" />
              <span>Ajustes</span>
            </button>
            <button
              onClick={handleRegenerarMiniaturas}
              disabled={regenerandoMiniaturas}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-1.5 cursor-pointer"
              title="Generar la miniatura limpia (sin marca de agua) para fotos subidas antes de este cambio"
            >
              <Wand2 className={`w-3.5 h-3.5 text-amber-400 ${regenerandoMiniaturas ? 'animate-pulse' : ''}`} />
              <span>
                {regenerandoMiniaturas
                  ? `Regenerando miniaturas... (${progresoMiniaturas?.procesadas || 0} listas, ${progresoMiniaturas?.restantes ?? '…'} restantes)`
                  : 'Regenerar Miniaturas'}
              </span>
            </button>
            <button
              onClick={handleRegenerarMarcaAgua}
              disabled={regenerandoMarcaAgua}
              className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 text-xs font-bold rounded-xl transition-all border border-slate-700 flex items-center gap-1.5 cursor-pointer"
              title="Re-generar la vista ampliada con la marca de agua nueva, más liviana, para fotos subidas antes de este cambio"
            >
              <Sparkles className={`w-3.5 h-3.5 text-amber-400 ${regenerandoMarcaAgua ? 'animate-pulse' : ''}`} />
              <span>
                {regenerandoMarcaAgua
                  ? `Actualizando marca de agua... (${progresoMarcaAgua?.procesadas || 0} listas, ${progresoMarcaAgua?.restantes ?? '…'} restantes)`
                  : 'Aliviar Marca de Agua'}
              </span>
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
                {diagnostico?.keyType === 'publishable_anon'
                  ? 'Anon Publishable'
                  : diagnostico?.keyType === 'custom'
                  ? 'Anon Personalizada'
                  : 'Sin Clave'}
              </span>
            </div>
          </div>
        </div>

        {/* Expandable Configuration Form */}
        {mostrarConfigSupabase && (
          <form onSubmit={handleGuardarConfiguracion} className="bg-slate-800/90 p-4 rounded-xl border border-slate-700 space-y-3">
            <h4 className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Configurar Clave Pública Anon de Supabase
            </h4>
            <p className="text-[11px] text-slate-300">
              Podés ingresar tu <strong>Anon Key / Publishable Key</strong> pública de Supabase. Por seguridad, la Service Role Key está deshabilitada en el cliente y solo se ejecuta del lado del servidor.
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
                <label className="text-slate-300 font-bold">Supabase Anon Key (Clave Pública)</label>
                <input
                  type="password"
                  required
                  value={configKey}
                  onChange={e => setConfigKey(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-white font-mono text-xs"
                  placeholder="sb_publishable_... o anon key"
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
              {isUploading && (
                <button
                  type="button"
                  onClick={handleCancelarSubida}
                  disabled={cancelandoSubida}
                  title="Termina la foto que se está subiendo ahora y detiene el resto — lo que ya se subió queda guardado"
                  className="px-3 py-2 bg-rose-100 hover:bg-rose-200 disabled:opacity-50 text-rose-700 text-xs font-bold rounded-xl transition-all flex items-center gap-1.5 cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                  <span>{cancelandoSubida ? 'Cancelando...' : 'Cancelar subida'}</span>
                </button>
              )}
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

          <div className="flex items-center gap-2">
            {fotosActivasCurso.length > 0 && !modoSeleccionActivas && (
              <span className="text-xs font-semibold text-emerald-700 bg-emerald-50 px-2.5 py-1 rounded-full border border-emerald-200 flex items-center gap-1">
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                <span>{fotosActivasCurso.length} fotos listas para venta</span>
              </span>
            )}
            {fotosActivasCurso.length > 0 && (
              <button
                type="button"
                onClick={handleToggleModoSeleccion}
                className="px-3 py-1.5 text-xs font-bold text-slate-600 hover:text-slate-900 bg-slate-100 hover:bg-slate-200 rounded-xl transition-colors cursor-pointer flex items-center gap-1.5"
              >
                {modoSeleccionActivas ? (
                  <>
                    <X className="w-3.5 h-3.5" />
                    <span>Cancelar selección</span>
                  </>
                ) : (
                  <>
                    <CheckSquare className="w-3.5 h-3.5" />
                    <span>Seleccionar varias</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>

        {fotosActivasCurso.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 text-xs">
            {([
              { id: 'todas' as const, label: 'Todas', cantidad: fotosActivasCurso.length },
              { id: 'individual' as const, label: 'Individual', cantidad: conteoActivasPorCategoria.individual },
              { id: 'grupal' as const, label: 'Grupal', cantidad: conteoActivasPorCategoria.grupal },
              { id: 'docente' as const, label: 'Docente', cantidad: conteoActivasPorCategoria.docente },
            ]).map(op => (
              <button
                key={op.id}
                type="button"
                onClick={() => {
                  setFiltroCategoriaActivas(op.id);
                  setIdsSeleccionados(new Set());
                }}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-bold whitespace-nowrap transition-colors cursor-pointer ${
                  filtroCategoriaActivas === op.id
                    ? 'bg-amber-400 text-slate-950'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {op.label} ({op.cantidad})
              </button>
            ))}
          </div>
        )}

        {modoSeleccionActivas && (
          <div className="flex flex-wrap items-center gap-2 p-3 rounded-xl bg-amber-50 border border-amber-200">
            <span className="text-xs font-bold text-amber-900">
              {idsSeleccionados.size} seleccionada(s)
            </span>
            <button
              type="button"
              onClick={handleSeleccionarTodasActivas}
              className="px-2.5 py-1 text-[11px] font-bold text-amber-800 hover:text-amber-950 bg-white hover:bg-amber-100 border border-amber-300 rounded-lg transition-colors cursor-pointer"
            >
              Seleccionar todas las {filtroCategoriaActivas === 'todas' ? '' : `de "${filtroCategoriaActivas}"`} ({fotosActivasFiltradas.length})
            </button>
            <button
              type="button"
              onClick={handleEliminarSeleccionadas}
              disabled={idsSeleccionados.size === 0 || borrandoSeleccionadas}
              className="ml-auto px-3 py-1.5 text-xs font-extrabold text-white bg-rose-600 hover:bg-rose-700 disabled:opacity-50 rounded-lg transition-colors cursor-pointer flex items-center gap-1.5"
            >
              {borrandoSeleccionadas ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5" />
              )}
              <span>Eliminar seleccionadas{idsSeleccionados.size > 0 ? ` (${idsSeleccionados.size})` : ''}</span>
            </button>
          </div>
        )}

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
        ) : fotosActivasFiltradas.length === 0 ? (
          <div className="p-8 rounded-2xl bg-slate-50 border border-dashed border-slate-300 text-center space-y-2">
            <div className="w-10 h-10 rounded-full bg-slate-200 text-slate-500 flex items-center justify-center mx-auto">
              <Camera className="w-5 h-5" />
            </div>
            <p className="text-sm font-bold text-slate-700">
              No hay fotos "{filtroCategoriaActivas}" en {seccionActual.nombreCompleto}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
            {fotosActivasFiltradas.map((foto) => {
              const seleccionada = idsSeleccionados.has(foto.id);
              return (
              <div
                key={foto.id}
                onClick={() => modoSeleccionActivas && handleToggleSeleccionFoto(foto.id)}
                className={`bg-white rounded-xl border overflow-hidden shadow-2xs group relative ${
                  modoSeleccionActivas ? 'cursor-pointer' : ''
                } ${seleccionada ? 'border-amber-500 ring-2 ring-amber-400/40' : 'border-slate-200'}`}
              >
                <div className="relative aspect-4/3 bg-black overflow-hidden">
                  <img
                    src={foto.urlWeb}
                    alt={foto.alumnoNombre || foto.categoria}
                    className={`w-full h-full object-cover ${seleccionada ? 'opacity-80' : ''}`}
                  />
                  <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-950/80 text-amber-300 uppercase">
                    {foto.categoria}
                  </span>

                  {modoSeleccionActivas ? (
                    <div
                      className={`absolute top-1.5 right-1.5 p-0.5 rounded shadow ${
                        seleccionada ? 'bg-amber-500 text-slate-950' : 'bg-white/90 text-slate-500'
                      }`}
                    >
                      {seleccionada ? <CheckSquare className="w-4 h-4" /> : <Square className="w-4 h-4" />}
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => handleEliminarFotoActiva(foto)}
                      className="absolute top-1.5 right-1.5 p-1 rounded bg-rose-600/90 text-white opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                      title="Eliminar de Supabase"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>

                <div className="p-2 text-[10px]">
                  <p className="font-semibold text-slate-800 truncate uppercase" title={foto.categoria}>
                    {foto.categoria}
                  </p>
                  {foto.alumnoNombre && (
                    <p className="text-amber-700 font-bold truncate">
                      👤 {foto.alumnoNombre}
                    </p>
                  )}
                  <div className="flex items-center justify-between text-slate-400 mt-0.5 text-[9px]">
                    <span className="truncate">{foto.createdAt ? new Date(foto.createdAt).toLocaleDateString('es-AR') : ''}</span>
                    <span className="text-emerald-600 font-bold">✓ En Supabase</span>
                  </div>
                </div>
              </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
