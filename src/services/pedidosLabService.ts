import JSZip from 'jszip';
import { FOTOS_MUESTRA } from '../data/colegiosData';
import { enviarFotosPorEmail } from './emailService';
import { fetchAdminAutenticado } from './adminAuthService';

export interface ArchivoFotoLab {
  id: string;
  tipo: 'individual' | 'grupal' | 'docente' | 'stickers' | 'portarretrato';
  nombreArchivoOriginal: string;
  nombreArchivoLab: string; // Ej: 3ATT_FABRICIO_PEREZ.jpg o 3ATT_FABRICIO_PEREZ_COPIA2.jpg
  tamanoImpresion: string; // '15x21' | '20x30' | '10x15'
  urlMuestra: string;
  urlOriginalHD?: string;
  esCopiaExtra?: boolean;
  numeroCopia?: number; // 1 = original, 2 = copia extra, etc.
}

export interface CopiasExtrasConfig {
  carpetasExtras?: number;
  individual15x21?: number;
  grupal20x30?: number;
  docente15x21?: number;
  otras15x21?: number;
}

export interface PedidoEscolarCompleto {
  id: string; // Ej: IFS-2026-8812 (Identificador amigable para la familia)
  supabaseId?: string; // UUID estricto de la fila en Supabase (para webhooks y Mercado Pago)
  fecha: string;
  colegioId: string;
  colegioNombre: string;
  cursoCodigo: string; // Ej: SALA-3TM
  grado: string;
  division: string;
  turno: string;
  alumnoId?: string;
  alumnoNumeroLista: number;
  alumnoNombre: string;
  codigoAlumno: string; // Ej: SALA-3TM_01_ABBA_FAZIO_AGUSTIN
  tutorNombre: string;
  tutorTelefono: string;
  tutorEmail: string;
  kitId: string;
  kitNombre: string;
  total: number;
  metodoPago: 'mercadopago' | 'transferencia' | 'efectivo';
  estadoPago: 'aprobado' | 'pendiente';
  estadoEntrega: 'en_espera' | 'en_laboratorio' | 'listo_descarga' | 'entregado';
  fotosSeleccionadas: {
    individualId: string;
    grupalId: string;
    docenteId?: string;
  };
  copiasExtras?: CopiasExtrasConfig;
  archivosParaLaboratorio: ArchivoFotoLab[];
  linkDescargaHD: string;
  emailEnviado: boolean;
  fechaEnvioEmail?: string;
}

// Helper to sanitize strings for photo lab minilab machines (Noritsu / Fuji Frontier / Klick)
export function sanitizarParaMinilab(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '') // remove accents
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Genera el código de cliente normalizado para el minilab del laboratorio fotográfico.
 * Formato especificado: curso '3ATT', alumno 'Pérez, Fabricio' o 'Fabricio Pérez' -> '3ATT_FABRICIO_PEREZ'
 */
export function formatearCodigoCliente(cursoCodigo: string, alumnoNombre: string): string {
  const cleanCurso = sanitizarParaMinilab(cursoCodigo);
  let cleanNombre = '';

  if (alumnoNombre.includes(',')) {
    const parts = alumnoNombre.split(',').map(s => s.trim());
    const apellido = parts[0] || '';
    const nombre = parts[1] || '';
    if (nombre) {
      cleanNombre = `${sanitizarParaMinilab(nombre)}_${sanitizarParaMinilab(apellido)}`;
    } else {
      cleanNombre = sanitizarParaMinilab(apellido);
    }
  } else {
    cleanNombre = sanitizarParaMinilab(alumnoNombre);
  }

  return `${cleanCurso}_${cleanNombre}`;
}

/**
 * Genera el nombre del archivo para el minilab fotográfico.
 * Por defecto usa el código de cliente exacto (ej: 3ATT_FABRICIO_PEREZ.jpg)
 */
export function generarNombreArchivoLab(
  cursoCodigo: string,
  _numeroLista: number,
  alumnoNombre: string,
  tipoFoto?: 'INDIVIDUAL' | 'GRUPAL' | 'DOCENTE' | 'OTRAS' | 'STICKERS',
  _tamano?: '15x21' | '20x30' | '10x15',
  esCopiaExtra?: boolean,
  numeroCopia?: number
): string {
  const codigoCliente = formatearCodigoCliente(cursoCodigo, alumnoNombre);
  if (esCopiaExtra) {
    const sufijoCopia = numeroCopia && numeroCopia > 1 ? `_COPIA${numeroCopia}` : '_COPIA2';
    if (tipoFoto === 'DOCENTE') {
      return `${codigoCliente}_DOCENTE${sufijoCopia}.jpg`;
    }
    if (tipoFoto === 'OTRAS') {
      return `${codigoCliente}_OTRAS${sufijoCopia}.jpg`;
    }
    return `${codigoCliente}${sufijoCopia}.jpg`;
  }
  if (tipoFoto === 'DOCENTE') {
    return `${codigoCliente}_DOCENTE.jpg`;
  }
  if (tipoFoto === 'OTRAS') {
    return `${codigoCliente}_OTRAS.jpg`;
  }
  return `${codigoCliente}.jpg`;
}

// Pedidos iniciales registrados en el sistema (vacío para entorno de producción real)
const PEDIDOS_INICIALES: PedidoEscolarCompleto[] = [];

const LOCAL_STORAGE_PEDIDOS_KEY = 'infocus_pedidos_escolares_v1';

export function obtenerPedidosGuardados(): PedidoEscolarCompleto[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PEDIDOS_KEY);
    if (!raw) {
      return [];
    }
    const parsed: PedidoEscolarCompleto[] = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    // Filter out all sample / mock demo orders
    const cleaned = parsed.filter(
      (p) =>
        !['IFS-2026-9001', 'IFS-2026-8812', 'IFS-2026-8809', 'IFS-2026-8795', 'RE-2026-8812', 'RE-2026-8809', 'RE-2026-8795'].includes(p.id) &&
        !['Fabricio Pérez', 'Abba Fazio, Agustín', 'Amigorena, Lucas', 'Balbi, Paz', 'Valentina Rossi', 'Mateo Benítez', 'Sofía Álvarez'].includes(p.alumnoNombre)
    );
    if (cleaned.length !== parsed.length) {
      localStorage.setItem(LOCAL_STORAGE_PEDIDOS_KEY, JSON.stringify(cleaned));
    }
    return cleaned;
  } catch {
    return [];
  }
}

export function guardarPedidosEnStorage(pedidos: PedidoEscolarCompleto[]): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_STORAGE_PEDIDOS_KEY, JSON.stringify(pedidos));
  } catch (err) {
    console.error('Error guardando pedidos:', err);
  }
}

/**
 * Resultado de registrar un pedido: incluye si la sincronización con Supabase
 * (POST /api/pedidos/crear) fue confirmada por el servidor antes de proceder al pago.
 */
export interface ResultadoRegistroPedido {
  pedido: PedidoEscolarCompleto;
  sincronizado: boolean;
  errorSincronizacion?: string;
}

/**
 * Genera los archivos para el laboratorio (incluidas las copias extra) a partir de la
 * configuración de un pedido. Es una función pura, sin efectos secundarios, para poder
 * reutilizarla tanto al crear un pedido nuevo (registrarPedidoDesdePortal) como al reconstruir
 * un pedido ya existente a partir de los datos guardados en Supabase (ver
 * construirPedidoCompletoDesdeFila más abajo) — evita mantener esta lógica duplicada en dos
 * lugares que podrían desincronizarse.
 */
export function generarArchivosParaLaboratorio(
  cursoCodigo: string,
  numLista: number,
  alumnoNombre: string,
  fotosSeleccionadas: { individualId: string; grupalId: string; docenteId?: string },
  copiasExtras?: CopiasExtrasConfig
): ArchivoFotoLab[] {
  const individualFoto = FOTOS_MUESTRA.find(f => f.id === fotosSeleccionadas.individualId) || FOTOS_MUESTRA.find(f => f.categoria === 'individual') || FOTOS_MUESTRA[0];
  const grupalFoto = FOTOS_MUESTRA.find(f => f.id === fotosSeleccionadas.grupalId) || FOTOS_MUESTRA.find(f => f.categoria === 'grupal') || FOTOS_MUESTRA[0];
  const docenteFoto = fotosSeleccionadas.docenteId ? (FOTOS_MUESTRA.find(f => f.id === fotosSeleccionadas.docenteId) || FOTOS_MUESTRA.find(f => f.categoria === 'docente')) : undefined;

  const archivosLab: ArchivoFotoLab[] = [
    {
      id: `arch-${Date.now()}-1`,
      tipo: 'individual',
      nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(cursoCodigo, numLista, alumnoNombre, 'INDIVIDUAL', '15x21'),
      tamanoImpresion: '15x21',
      urlMuestra: individualFoto.thumbnail,
      urlOriginalHD: individualFoto.url,
      numeroCopia: 1
    },
    {
      id: `arch-${Date.now()}-2`,
      tipo: 'grupal',
      nombreArchivoOriginal: 'GRUPAL_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(cursoCodigo, numLista, alumnoNombre, 'GRUPAL', '20x30'),
      tamanoImpresion: '20x30',
      urlMuestra: grupalFoto.thumbnail,
      urlOriginalHD: grupalFoto.url,
      numeroCopia: 1
    }
  ];

  if (docenteFoto) {
    archivosLab.push({
      id: `arch-${Date.now()}-3`,
      tipo: 'docente',
      nombreArchivoOriginal: 'DOCENTE_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(cursoCodigo, numLista, alumnoNombre, 'DOCENTE', '15x21'),
      tamanoImpresion: '15x21',
      urlMuestra: docenteFoto.thumbnail,
      urlOriginalHD: docenteFoto.url,
      numeroCopia: 1
    });
  }

  // Generación automática de archivos duplicados para el laboratorio por Copia Extra de Carpeta
  if (copiasExtras?.carpetasExtras && copiasExtras.carpetasExtras > 0) {
    for (let c = 1; c <= copiasExtras.carpetasExtras; c++) {
      const numCopia = c + 1;
      // 1. Copia extra de foto individual 15x21
      archivosLab.push({
        id: `arch-${Date.now()}-extra-carp-ind-${c}`,
        tipo: 'individual',
        nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          cursoCodigo,
          numLista,
          alumnoNombre,
          'INDIVIDUAL',
          '15x21',
          true,
          numCopia
        ),
        tamanoImpresion: '15x21',
        urlMuestra: individualFoto.thumbnail,
        urlOriginalHD: individualFoto.url,
        esCopiaExtra: true,
        numeroCopia: numCopia
      });

      // 2. Copia extra de foto grupal 20x30
      archivosLab.push({
        id: `arch-${Date.now()}-extra-carp-grup-${c}`,
        tipo: 'grupal',
        nombreArchivoOriginal: 'GRUPAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          cursoCodigo,
          numLista,
          alumnoNombre,
          'GRUPAL',
          '20x30',
          true,
          numCopia
        ),
        tamanoImpresion: '20x30',
        urlMuestra: grupalFoto.thumbnail,
        urlOriginalHD: grupalFoto.url,
        esCopiaExtra: true,
        numeroCopia: numCopia
      });

      // 3. Copia extra de foto docente 15x21 (si aplica)
      if (docenteFoto) {
        archivosLab.push({
          id: `arch-${Date.now()}-extra-carp-doc-${c}`,
          tipo: 'docente',
          nombreArchivoOriginal: 'DOCENTE_HD.jpg',
          nombreArchivoLab: generarNombreArchivoLab(
            cursoCodigo,
            numLista,
            alumnoNombre,
            'DOCENTE',
            '15x21',
            true,
            numCopia
          ),
          tamanoImpresion: '15x21',
          urlMuestra: docenteFoto.thumbnail,
          urlOriginalHD: docenteFoto.url,
          esCopiaExtra: true,
          numeroCopia: numCopia
        });
      }
    }
  }

  // Generación automática de archivos duplicados para el laboratorio (Copia Extra 15x21 suelta)
  if (copiasExtras?.individual15x21 && copiasExtras.individual15x21 > 0) {
    for (let c = 1; c <= copiasExtras.individual15x21; c++) {
      const numCopia = c + 1;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-ind-${c}`,
        tipo: 'individual',
        nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          cursoCodigo,
          numLista,
          alumnoNombre,
          'INDIVIDUAL',
          '15x21',
          true,
          numCopia
        ),
        tamanoImpresion: '15x21',
        urlMuestra: individualFoto.thumbnail,
        urlOriginalHD: individualFoto.url,
        esCopiaExtra: true,
        numeroCopia: numCopia
      });
    }
  }

  // Generación automática de archivos duplicados para el laboratorio (Copia Extra 20x30)
  if (copiasExtras?.grupal20x30 && copiasExtras.grupal20x30 > 0) {
    for (let c = 1; c <= copiasExtras.grupal20x30; c++) {
      const numCopia = c + 1;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-grup-${c}`,
        tipo: 'grupal',
        nombreArchivoOriginal: 'GRUPAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          cursoCodigo,
          numLista,
          alumnoNombre,
          'GRUPAL',
          '20x30',
          true,
          numCopia
        ),
        tamanoImpresion: '20x30',
        urlMuestra: grupalFoto.thumbnail,
        urlOriginalHD: grupalFoto.url,
        esCopiaExtra: true,
        numeroCopia: numCopia
      });
    }
  }

  // Generación automática de archivos duplicados para el laboratorio (Copia Extra 15x21 Con Docente)
  if (copiasExtras?.docente15x21 && copiasExtras.docente15x21 > 0 && docenteFoto) {
    for (let c = 1; c <= copiasExtras.docente15x21; c++) {
      const numCopia = c + 1;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-doc-${c}`,
        tipo: 'docente',
        nombreArchivoOriginal: 'DOCENTE_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          cursoCodigo,
          numLista,
          alumnoNombre,
          'DOCENTE',
          '15x21',
          true,
          numCopia
        ),
        tamanoImpresion: '15x21',
        urlMuestra: docenteFoto.thumbnail,
        urlOriginalHD: docenteFoto.url,
        esCopiaExtra: true,
        numeroCopia: numCopia
      });
    }
  }

  // Generación automática de archivos para el laboratorio (Copia Extra 15x21 Otras Fotos)
  if (copiasExtras?.otras15x21 && copiasExtras.otras15x21 > 0) {
    const patioFoto = FOTOS_MUESTRA.find(f => f.categoria === 'patio') || FOTOS_MUESTRA[0];
    for (let c = 1; c <= copiasExtras.otras15x21; c++) {
      const numCopia = c;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-otras-${c}`,
        tipo: 'individual',
        nombreArchivoOriginal: 'OTRAS_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          cursoCodigo,
          numLista,
          alumnoNombre,
          'OTRAS',
          '15x21',
          true,
          numCopia + 1
        ),
        tamanoImpresion: '15x21',
        urlMuestra: patioFoto.thumbnail,
        urlOriginalHD: patioFoto.url,
        esCopiaExtra: true,
        numeroCopia: numCopia
      });
    }
  }

  return archivosLab;
}

/**
 * Registers a new order created by a parent in the portal
 */
export async function registrarPedidoDesdePortal(params: {
  colegioId: string;
  colegioNombre: string;
  cursoCodigo: string;
  grado: string;
  division: string;
  turno: string;
  alumnoNombre: string;
  alumnoNumeroLista?: number;
  tutorNombre: string;
  tutorTelefono: string;
  tutorEmail: string;
  kitId: string;
  kitNombre: string;
  total: number;
  metodoPago: 'mercadopago' | 'transferencia' | 'efectivo';
  fotosSeleccionadas: {
    individualId: string;
    grupalId: string;
    docenteId?: string;
  };
  copiasExtras?: CopiasExtrasConfig;
}): Promise<ResultadoRegistroPedido> {
  const currentPedidos = obtenerPedidosGuardados();
  const numPedido = `IFS-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const numLista = params.alumnoNumeroLista || currentPedidos.length + 1;
  const codigoAlumno = `${sanitizarParaMinilab(params.cursoCodigo)}_${String(numLista).padStart(2, '0')}_${sanitizarParaMinilab(params.alumnoNombre)}`;

  const archivosLab = generarArchivosParaLaboratorio(
    params.cursoCodigo,
    numLista,
    params.alumnoNombre,
    params.fotosSeleccionadas,
    params.copiasExtras
  );

  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  // UUID estricto compatible con PostgreSQL UUID para la clave primaria de Supabase
  const supabaseId = typeof crypto !== 'undefined' && crypto.randomUUID
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        const v = c === 'x' ? r : (r & 0x3) | 0x8;
        return v.toString(16);
      });

  const nuevoPedido: PedidoEscolarCompleto = {
    id: numPedido,
    supabaseId,
    fecha: fechaStr,
    colegioId: params.colegioId,
    colegioNombre: params.colegioNombre,
    cursoCodigo: params.cursoCodigo.toUpperCase(),
    grado: params.grado,
    division: params.division,
    turno: params.turno,
    alumnoNumeroLista: numLista,
    alumnoNombre: params.alumnoNombre,
    codigoAlumno,
    tutorNombre: params.tutorNombre,
    tutorTelefono: params.tutorTelefono,
    tutorEmail: params.tutorEmail,
    kitId: params.kitId,
    kitNombre: params.kitNombre,
    total: params.total,
    metodoPago: params.metodoPago,
    estadoPago: 'pendiente',
    estadoEntrega: 'en_espera',
    fotosSeleccionadas: params.fotosSeleccionadas,
    copiasExtras: params.copiasExtras,
    archivosParaLaboratorio: archivosLab,
    linkDescargaHD: `https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/${sanitizarParaMinilab(params.cursoCodigo)}/${codigoAlumno}.zip`,
    emailEnviado: false,
    fechaEnvioEmail: undefined
  };

  const listaActualizada = [nuevoPedido, ...currentPedidos];
  guardarPedidosEnStorage(listaActualizada);

  // Sincronización con Supabase, ahora esperada por quien llama antes de avanzar al pago.
  // Auditoría 2026-09-09 (revisión a fondo): esto antes insertaba directo en 'familias' y
  // 'pedidos' con la clave anónima del navegador — ambas tablas tenían políticas de RLS que
  // permitían escribir (y, en 'familias', también LEER el listado completo de clientes) a
  // cualquiera, sin login. Luego se corrigió pasando por el servidor (POST /api/pedidos/crear),
  // pero ese fetch quedaba disparado en un setTimeout sin ser esperado por el llamador: si
  // fallaba (red caída, Supabase caído, error 500) el pedido quedaba SOLO en localStorage y el
  // family podía terminar pagando en Mercado Pago un pedido que el servidor nunca llegó a crear
  // — un pago real sin ningún registro en Supabase, un fallo completamente silencioso porque el
  // error del fetch sólo se logueaba en la consola del navegador de la familia. Ahora esta
  // función es async y devuelve si la sincronización fue confirmada, para que quien llama pueda
  // frenar el pago si no lo fue.
  let sincronizado = false;
  let errorSincronizacion: string | undefined;
  try {
    const resSync = await fetch('/api/pedidos/crear', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        pedidoId: nuevoPedido.supabaseId,
        kitId: nuevoPedido.kitId,
        carpetasExtras: nuevoPedido.copiasExtras?.carpetasExtras || 0,
        tutorNombre: nuevoPedido.tutorNombre,
        tutorTelefono: nuevoPedido.tutorTelefono,
        metodoPago: nuevoPedido.metodoPago,
        // Auditoría 2026-09-09 (revisión a fondo): se manda además todo lo necesario para poder
        // cumplir el pedido sin depender de este navegador — ver migración de esa fecha.
        pedidoFriendlyId: nuevoPedido.id,
        tutorEmail: nuevoPedido.tutorEmail,
        colegioId: nuevoPedido.colegioId,
        colegioNombre: nuevoPedido.colegioNombre,
        cursoCodigo: nuevoPedido.cursoCodigo,
        grado: nuevoPedido.grado,
        division: nuevoPedido.division,
        turno: nuevoPedido.turno,
        alumnoNombre: nuevoPedido.alumnoNombre,
        alumnoNumeroLista: nuevoPedido.alumnoNumeroLista,
        codigoAlumno: nuevoPedido.codigoAlumno,
        kitNombre: nuevoPedido.kitNombre,
        fotosSeleccionadas: nuevoPedido.fotosSeleccionadas,
        copiasExtras: nuevoPedido.copiasExtras,
        linkDescargaHD: nuevoPedido.linkDescargaHD,
      }),
    });
    const dataSync = await resSync.json().catch(() => null);
    if (resSync.ok && dataSync?.success) {
      sincronizado = true;
      // El email de confirmación y fotos HD se despacha una vez aprobado el pago (vía webhook de Mercado Pago o confirmación admin)
    } else {
      errorSincronizacion = dataSync?.error || `El servidor respondió con un error (HTTP ${resSync.status}).`;
      console.warn('No se pudo confirmar el pedido en Supabase:', errorSincronizacion);
    }
  } catch (e: any) {
    errorSincronizacion = e?.message || 'Error de conexión al registrar el pedido en el servidor.';
    console.warn('Sincronización con Supabase no completada:', e);
  }

  return { pedido: nuevoPedido, sincronizado, errorSincronizacion };
}

/**
 * Reconstruye un PedidoEscolarCompleto (la forma que usa toda la UI del panel) a partir de una
 * fila real de la tabla "pedidos" de Supabase (tal como la devuelve GET /api/admin/pedidos, con
 * su join a "familias"). Es la contraparte de registrarPedidoDesdePortal: mientras esa función
 * arma el pedido a partir de lo que completa la familia en el navegador, esta lo arma a partir
 * de lo que realmente quedó guardado en la base — así el panel de administración puede mostrar
 * pedidos reales aunque se abra desde un navegador o dispositivo distinto al de la familia que
 * compró (auditoría 2026-09-09, revisión a fondo).
 */
export function construirPedidoCompletoDesdeFila(fila: any): PedidoEscolarCompleto {
  const fotosSeleccionadas = (fila.fotos_seleccionadas && typeof fila.fotos_seleccionadas === 'object')
    ? fila.fotos_seleccionadas
    : { individualId: '', grupalId: '' };
  const copiasExtras: CopiasExtrasConfig = (fila.copias_extras && typeof fila.copias_extras === 'object')
    ? fila.copias_extras
    : {};
  const numLista = fila.alumno_numero_lista || 1;
  const cursoCodigo = fila.curso_codigo || '';
  const alumnoNombre = fila.alumno_nombre || 'Alumno';

  const archivosLab = generarArchivosParaLaboratorio(cursoCodigo, numLista, alumnoNombre, fotosSeleccionadas, copiasExtras);

  // La tabla real sólo tiene un único "estado" (pendiente_pago | pagado | entregado |
  // cancelado); se mapea a los dos campos más granulares que usa hoy la UI del panel.
  let estadoPago: 'aprobado' | 'pendiente' = 'pendiente';
  let estadoEntrega: PedidoEscolarCompleto['estadoEntrega'] = 'en_espera';
  if (fila.estado === 'pagado') {
    estadoPago = 'aprobado';
    estadoEntrega = 'en_laboratorio';
  } else if (fila.estado === 'entregado') {
    estadoPago = 'aprobado';
    estadoEntrega = 'entregado';
  }

  const fecha = fila.created_at ? new Date(fila.created_at) : new Date();
  const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()} ${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;

  return {
    id: fila.pedido_friendly_id || fila.id,
    supabaseId: fila.id,
    fecha: fechaStr,
    colegioId: fila.colegio_id || '',
    colegioNombre: fila.colegio_nombre || 'Colegio',
    cursoCodigo: cursoCodigo,
    grado: fila.grado || '',
    division: fila.division || '',
    turno: fila.turno || '',
    alumnoNumeroLista: numLista,
    alumnoNombre,
    codigoAlumno: fila.codigo_alumno || '',
    tutorNombre: fila.familias?.nombre || '',
    tutorTelefono: fila.familias?.whatsapp || '',
    tutorEmail: fila.familias?.email || '',
    kitId: fila.tipo_kit === 'solo_digital' ? 'kit-digital' : 'kit-clasico',
    kitNombre: fila.kit_nombre || (fila.tipo_kit === 'solo_digital' ? 'Kit Digital' : 'Kit Clásico'),
    total: Number(fila.total) || 0,
    metodoPago: fila.metodo_pago || 'mercadopago',
    estadoPago,
    estadoEntrega,
    fotosSeleccionadas,
    copiasExtras,
    archivosParaLaboratorio: archivosLab,
    linkDescargaHD: fila.link_descarga_hd || '',
    emailEnviado: Boolean(fila.email_enviado),
    fechaEnvioEmail: fila.fecha_envio_email || undefined,
  };
}

/**
 * Trae los pedidos reales desde Supabase (vía el servidor, con sesión de administrador) para el
 * panel. Devuelve [] ante cualquier falla de red/servidor en vez de tirar, para que el panel
 * pueda seguir mostrando lo que tenga en localStorage como respaldo en ese caso.
 */
export async function obtenerPedidosAdminDesdeSupabase(): Promise<PedidoEscolarCompleto[]> {
  try {
    const res = await fetchAdminAutenticado('/api/admin/pedidos');
    if (!res.ok) return [];
    const data = await res.json();
    if (!data?.success || !Array.isArray(data.pedidos)) return [];
    return data.pedidos.map(construirPedidoCompletoDesdeFila);
  } catch (e) {
    console.warn('No se pudieron obtener los pedidos reales de Supabase:', e);
    return [];
  }
}

/**
 * Combina los pedidos reales de Supabase con cualquier pedido que sólo exista en el
 * localStorage de este navegador (por ejemplo, uno creado hace un instante cuya sincronización
 * con el servidor todavía no se refleja en una lectura posterior). Supabase es la fuente de la
 * verdad: si un pedido está en ambos lados, se usa siempre la versión del servidor.
 */
export function combinarPedidosConLocal(pedidosServidor: PedidoEscolarCompleto[], pedidosLocales: PedidoEscolarCompleto[]): PedidoEscolarCompleto[] {
  const idsServidor = new Set(pedidosServidor.map((p) => p.supabaseId).filter(Boolean));
  const localesSinServidor = pedidosLocales.filter((p) => !p.supabaseId || !idsServidor.has(p.supabaseId));
  return [...pedidosServidor, ...localesSinServidor];
}

export interface PedidoSeguimiento {
  id: string;
  colegio: string;
  alumno: string;
  grado: string;
  division: string;
  tutor: string;
  telefono: string;
  kit: string;
  total: number;
  fecha: string;
  estado: 'pendiente_pago' | 'pagado' | 'entregado' | 'cancelado';
}

/**
 * Busca un pedido por número de pedido o teléfono contra el servidor (Supabase), para que el
 * seguimiento de pedidos de una familia funcione aunque esté en un dispositivo o navegador
 * distinto al que usó para comprar. Devuelve null si no hay coincidencia o si falla la consulta
 * (auditoría 2026-09-09, revisión a fondo — antes esta búsqueda sólo miraba el localStorage).
 */
export async function buscarPedidoPorSeguimiento(query: string): Promise<PedidoSeguimiento | null> {
  try {
    const res = await fetch(`/api/pedidos/buscar?query=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.pedido) return null;
    return data.pedido as PedidoSeguimiento;
  } catch (e) {
    console.warn('Error al buscar el pedido por seguimiento:', e);
    return null;
  }
}

/**
 * Genera un Blob JPEG válido con los datos del alumno y código de cliente
 * para garantizar que el archivo .jpg sea real y visible incluso si la imagen remota tiene CORS.
 */
async function generarJpgSimuladoLaboratorio(
  codigoCliente: string,
  tamano: string,
  tipo: string,
  esCopiaExtra?: boolean,
  numeroCopia?: number
): Promise<Blob> {
  if (typeof document === 'undefined') {
    return new Blob([], { type: 'image/jpeg' });
  }

  const canvas = document.createElement('canvas');
  const es20x30 = tamano === '20x30';
  canvas.width = es20x30 ? 1200 : 840;
  canvas.height = es20x30 ? 800 : 1180;
  const ctx = canvas.getContext('2d');
  if (ctx) {
    // Fondo profesional para laboratorio
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    if (esCopiaExtra) {
      grad.addColorStop(0, '#fffbeb');
      grad.addColorStop(1, '#fef3c7');
    } else {
      grad.addColorStop(0, '#f8fafc');
      grad.addColorStop(1, '#e2e8f0');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Marco
    ctx.strokeStyle = esCopiaExtra ? '#f59e0b' : '#cbd5e1';
    ctx.lineWidth = esCopiaExtra ? 18 : 14;
    ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

    // Encabezado
    ctx.fillStyle = '#d97706';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RETRATO ESCOLAR · FOTOGRAFÍA ESCOLAR 2026', canvas.width / 2, 65);

    if (esCopiaExtra) {
      // Badge destacado de copia extra
      ctx.fillStyle = '#b45309';
      ctx.fillRect(canvas.width / 2 - 260, 90, 520, 42);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText(`★ COPIA EXTRA DUPLICADA (COPIA N° ${numeroCopia || 2}) ★`, canvas.width / 2, 118);

      ctx.fillStyle = '#92400e';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('SOLICITADA POR FAMILIARES · NO OMITIR EN EL ENSOBRADO', canvas.width / 2, 160);
    }

    // Código de cliente destacado para el operador
    ctx.fillStyle = '#0f172a';
    ctx.font = 'bold 42px monospace';
    const textoCodigo = esCopiaExtra 
      ? `${codigoCliente}_COPIA${numeroCopia || 2}` 
      : codigoCliente;
    ctx.fillText(textoCodigo, canvas.width / 2, canvas.height / 2 - 20);

    // Medida y tipo
    ctx.fillStyle = '#475569';
    ctx.font = 'bold 22px sans-serif';
    ctx.fillText(`CARPETA: ${tamano} · TOMA: ${tipo.toUpperCase()}`, canvas.width / 2, canvas.height / 2 + 35);

    ctx.fillStyle = '#94a3b8';
    ctx.font = '16px monospace';
    ctx.fillText(`Archivo para Minilab: ${textoCodigo}.jpg`, canvas.width / 2, canvas.height - 60);
  }

  return new Promise<Blob>((resolve) => {
    canvas.toBlob((b) => {
      resolve(b || new Blob([], { type: 'image/jpeg' }));
    }, 'image/jpeg', 0.92);
  });
}

/**
 * Downloads a complete ZIP bundle with all student photos automatically renamed for the photo lab.
 * By default organizes into EXACTLY 2 folders: "15x21" and "20x30" with loose JPG files
 * named with the client code (e.g. 3ATT_FABRICIO_PEREZ.jpg).
 */
export async function descargarLoteLaboratorioZip(
  pedidos: PedidoEscolarCompleto[],
  opciones: {
    nombreColegio: string;
    filtroCurso?: string;
    estructuraCarpetas?: 'solo_2_carpetas_tamano' | 'por_alumno';
    organizarEnSubcarpetasPorAlumno?: boolean;
  }
): Promise<Blob> {
  const zip = new JSZip();
  const estructura = opciones.estructuraCarpetas || (opciones.organizarEnSubcarpetasPorAlumno ? 'por_alumno' : 'solo_2_carpetas_tamano');

  const pedidosFiltrados = pedidos.filter(p => 
    (!opciones.filtroCurso || opciones.filtroCurso === 'todos' || p.cursoCodigo === opciones.filtroCurso) &&
    p.estadoPago === 'aprobado'
  );

  // 1. Text checklist for envelope packing
  let planillaTexto = `===========================================================\n`;
  planillaTexto += `RETRATO ESCOLAR - PLANILLA DE LABORATORIO Y ENSOBRADO\n`;
  planillaTexto += `Institución: ${opciones.nombreColegio}\n`;
  planillaTexto += `Fecha de Generación: ${new Date().toLocaleString('es-AR')}\n`;
  planillaTexto += `Total de Pedidos Aprobados: ${pedidosFiltrados.length}\n`;
  planillaTexto += `Estructura: ${estructura === 'solo_2_carpetas_tamano' ? '2 Carpetas por Tamaño (15x21 y 20x30)' : 'Carpetas individuales por alumno'}\n`;
  planillaTexto += `===========================================================\n\n`;

  planillaTexto += `ORDEN | CURSO | ALUMNO | CÓDIGO CLIENTE (ARCHIVO) | KIT | IMPRESIONES\n`;
  planillaTexto += `----------------------------------------------------------------------------------------------------\n`;

  if (estructura === 'solo_2_carpetas_tamano') {
    // ESTRUCTURA SOLICITADA POR EL USUARIO:
    // Solo 2 carpetas: "15x21" y "20x30", y dentro los archivos JPG sueltos con código de cliente
    const folder15x21 = zip.folder('15x21');
    const folder20x30 = zip.folder('20x30');

    // Sets para evitar colisiones dentro de la misma carpeta
    const nombresUsados15x21 = new Set<string>();
    const nombresUsados20x30 = new Set<string>();

    for (let i = 0; i < pedidosFiltrados.length; i++) {
      const p = pedidosFiltrados[i];
      const codigoCliente = formatearCodigoCliente(p.cursoCodigo, p.alumnoNombre);
      const listaArchivosLab: string[] = [];

      for (const foto of p.archivosParaLaboratorio) {
        const es20x30 = foto.tamanoImpresion === '20x30';
        const targetFolder = es20x30 ? folder20x30 : folder15x21;
        const setNombres = es20x30 ? nombresUsados20x30 : nombresUsados15x21;

        // Nombre de archivo con el código de cliente (ej: 3ATT_FABRICIO_PEREZ.jpg o 3ATT_FABRICIO_PEREZ_COPIA2.jpg)
        let nombreJpg = foto.nombreArchivoLab || `${codigoCliente}.jpg`;
        if (foto.esCopiaExtra) {
          nombreJpg = `${codigoCliente}_COPIA${foto.numeroCopia || 2}.jpg`;
        } else if (setNombres.has(nombreJpg)) {
          nombreJpg = `${codigoCliente}_${sanitizarParaMinilab(foto.tipo)}.jpg`;
        }
        if (setNombres.has(nombreJpg)) {
          let seq = 2;
          while (setNombres.has(`${codigoCliente}_${seq}.jpg`)) {
            seq++;
          }
          nombreJpg = `${codigoCliente}_${seq}.jpg`;
        }
        setNombres.add(nombreJpg);
        listaArchivosLab.push(`${foto.tamanoImpresion}/${nombreJpg}${foto.esCopiaExtra ? ' [COPIA EXTRA]' : ''}`);

        // Descarga la imagen o genera JPEG válido nativo si hay restricción de CORS
        try {
          const response = await fetch(foto.urlOriginalHD || foto.urlMuestra);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          targetFolder?.file(nombreJpg, blob);
        } catch {
          const fallbackBlob = await generarJpgSimuladoLaboratorio(
            codigoCliente,
            foto.tamanoImpresion,
            foto.tipo,
            foto.esCopiaExtra,
            foto.numeroCopia
          );
          targetFolder?.file(nombreJpg, fallbackBlob);
        }
      }

      const tieneCopiasExtras = p.archivosParaLaboratorio.some(a => a.esCopiaExtra) || (p.copiasExtras && (p.copiasExtras.individual15x21 > 0 || p.copiasExtras.grupal20x30 > 0));
      const alertaExtra = tieneCopiasExtras ? ' ⚠️ [INCLUYE COPIA EXTRA DUPLICADA]' : '';
      planillaTexto += `#${String(p.alumnoNumeroLista).padStart(2, '0')} | ${p.cursoCodigo} | ${p.alumnoNombre} | ${codigoCliente} | ${p.kitNombre}${alertaExtra} | ${listaArchivosLab.join(' + ')}\n`;
    }
  } else {
    // Estructura opcional alternativa: subcarpeta por cada alumno
    for (let i = 0; i < pedidosFiltrados.length; i++) {
      const p = pedidosFiltrados[i];
      const codigoCliente = formatearCodigoCliente(p.cursoCodigo, p.alumnoNombre);
      const carpetaAlumno = `${p.cursoCodigo}/${String(p.alumnoNumeroLista).padStart(2, '0')}_${sanitizarParaMinilab(p.alumnoNombre)}`;

      for (const foto of p.archivosParaLaboratorio) {
        const sufijoExtra = foto.esCopiaExtra ? `_COPIA${foto.numeroCopia || 2}` : '';
        const nombreJpg = `${codigoCliente}_${foto.tamanoImpresion}${sufijoExtra}.jpg`;
        try {
          const response = await fetch(foto.urlOriginalHD || foto.urlMuestra);
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          const blob = await response.blob();
          zip.folder(carpetaAlumno)?.file(nombreJpg, blob);
        } catch {
          const fallbackBlob = await generarJpgSimuladoLaboratorio(
            codigoCliente,
            foto.tamanoImpresion,
            foto.tipo,
            foto.esCopiaExtra,
            foto.numeroCopia
          );
          zip.folder(carpetaAlumno)?.file(nombreJpg, fallbackBlob);
        }
      }

      const tieneCopiasExtras = p.archivosParaLaboratorio.some(a => a.esCopiaExtra) || (p.copiasExtras && (p.copiasExtras.individual15x21 > 0 || p.copiasExtras.grupal20x30 > 0));
      const alertaExtra = tieneCopiasExtras ? ' ⚠️ [INCLUYE COPIA EXTRA DUPLICADA]' : '';
      planillaTexto += `#${String(p.alumnoNumeroLista).padStart(2, '0')} | ${p.cursoCodigo} | ${p.alumnoNombre} | ${codigoCliente} | ${p.kitNombre}${alertaExtra}\n`;
    }
  }

  // 3. Add packing checklist
  zip.file(`00_PLANILLA_CONTROL_ENSOBRADO_${sanitizarParaMinilab(opciones.filtroCurso || 'TODOS')}.txt`, planillaTexto);

  // 4. Add Readme for the lab technician
  const readmeLab = `INSTRUCCIONES PARA EL OPERADOR DE LABORATORIO / MINILAB:
1. Este archivo ZIP contiene exactamente 2 carpetas organizadas por tamaño de papel:
   - "15x21": Contiene las fotos individuales y ampliaciones 15x21 sueltas.
   - "20x30": Contiene las fotos grupales 20x30 sueltas.
2. Cada archivo JPG tiene como nombre el CÓDIGO DE CLIENTE del alumno (ej: 3ATT_FABRICIO_PEREZ.jpg).
3. ATENCIÓN A COPIAS EXTRAS DUPLICADAS:
   Los archivos con sufijo "_COPIA2.jpg", "_COPIA3.jpg" corresponden a fotos duplicadas solicitadas y abonadas por los padres.
   El minilab imprimirá ambos archivos automáticamente. Ambos ejemplares deben guardarse juntos dentro del mismo sobre del alumno para evitar omisiones.
4. Por favor asegurar que la máquina (Noritsu / Fuji Frontier / Klick) tenga activada la opción:
   "IMPRIMIR NOMBRE DE ARCHIVO EN EL DORSO DEL PAPEL (Backprint)".
5. De este modo, tanto la copia original como la copia extra tendrán estampado en el reverso:
   "3ATT_FABRICIO_PEREZ" y "3ATT_FABRICIO_PEREZ_COPIA2"
6. En la mesa de ensobrado, basta con hacer coincidir ambos dorsos para colocarlos en el sobre del alumno.
Muchas gracias. Retrato Escolar.`;

  zip.file(`00_LEAME_OPERADOR_LABORATORIO.txt`, readmeLab);

  return await zip.generateAsync({ type: 'blob' });
}
