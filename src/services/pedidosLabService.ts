import JSZip from 'jszip';
import { FOTOS_MUESTRA, KITS_DISPONIBLES } from '../data/colegiosData';
import { enviarFotosPorEmail } from './emailService';
import { fetchAdminAutenticado } from './adminAuthService';
import { Foto } from '../types';

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
  /**
   * true cuando no se pudo encontrar la foto real que eligió la familia dentro de la galería
   * real del curso (auditoría 2026-09-15, pedido de Pablo: "eliminemos todas las fotos de
   * muestra" — que nunca se use una foto de stock como reemplazo silencioso de la real).
   * En ese caso `urlMuestra`/`urlOriginalHD` quedan vacíos a propósito: mejor marcarlo para que
   * el fotógrafo lo revise a mano que imprimir o enviar por error la foto de otro alumno.
   */
  sinFotoReal?: boolean;
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
  // Auditoría 2026-09-23 (Pablo: "¿por qué se generaron 2 pedidos si es uno solo?"): un carrito
  // multi-hijo (mellizos, por ejemplo) crea un pedido por hermano pero los cobra juntos en un
  // solo pago — todas las filas de ese pago comparten este id (ver grupo_pago_id en
  // /api/pedidos/crear-multiple). Se expone acá para que el panel pueda encontrar y aprobar
  // juntos los pedidos de un mismo pago combinado (ver handleAprobarPago en AdminModal.tsx).
  grupoPagoId?: string;
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
  metodoPago: 'mercadopago' | 'transferencia' | 'efectivo' | 'nave';
  estadoPago: 'aprobado' | 'pendiente' | 'rechazado';
  estadoEntrega: 'en_espera' | 'en_laboratorio' | 'laboratorio_listo' | 'listo_retiro' | 'listo_descarga' | 'entregado';
  /** Pago anticipado: el kit está pagado pero la familia todavía no eligió las fotos. */
  seleccionPendiente?: boolean;
  fotosSeleccionadas: {
    individualId: string;
    grupalId: string;
    docenteId?: string;
    otrasIds?: string[];
  };
  copiasExtras?: CopiasExtrasConfig;
  archivosParaLaboratorio: ArchivoFotoLab[];
  linkDescargaHD: string;
  emailEnviado: boolean;
  fechaEnvioEmail?: string;
  // Auditoría 2026-09-20 (pedido de Pablo): estado real de los avisos de laboratorio ("En
  // producción" / "Listo para retirar" del panel de Laboratorio) — antes esto no se exponía acá,
  // así que el panel no tenía forma de saber si un pedido ya había recibido el aviso y el botón
  // volvía a mostrarse como si nunca se hubiera enviado. Las fechas son SIEMPRE la del primer
  // envío (no se pisan en reenvíos — ver /api/admin/pedidos/notificar-estado).
  // Auditoría 2026-09-20 (revisión completa de estados): se suma 'entregado' como tercera etapa
  // del mismo pipeline — antes el retiro físico no tenía ninguna forma de registrarse (ver
  // POST /api/admin/pedidos/:id/marcar-retirado). Es la ÚNICA fuente de verdad del pipeline
  // físico del pedido; "estadoEntrega" de abajo es sólo una vista derivada de este campo para las
  // pantallas que ya existían antes de esta auditoría.
  estadoLab?: 'en_produccion' | 'listo_retiro' | 'entregado' | null;
  fechaEnvioProduccion?: string;
  fechaEnvioListoRetiro?: string;
  fechaEntregado?: string;
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
    const parsedCrudo: PedidoEscolarCompleto[] = JSON.parse(raw);
    if (!Array.isArray(parsedCrudo)) return [];
    // Auditoría 2026-09-23: datos guardados por versiones anteriores del sitio pueden venir sin
    // `archivosParaLaboratorio` — el panel de Laboratorio y el portal hacen .map/.filter sobre ese
    // campo y la pantalla entera se caía. Se normaliza al leer.
    const parsed = parsedCrudo
      .filter((p) => p && typeof p === 'object')
      .map((p) => (Array.isArray(p.archivosParaLaboratorio) ? p : { ...p, archivosParaLaboratorio: [] }));

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
  fotosSeleccionadas: { individualId: string; grupalId: string; docenteId?: string; otrasIds?: string[] },
  copiasExtras?: CopiasExtrasConfig,
  fotosDisponibles: Foto[] = FOTOS_MUESTRA
): ArchivoFotoLab[] {
  // Auditoría 2026-09-15 (pedido de Pablo: "eliminemos todas las fotos de muestra"): esta
  // búsqueda antes caía en FOTOS_MUESTRA (fotos de stock genéricas) cuando la foto real elegida
  // por la familia no aparecía en la galería — así fue como el pedido de Delfina Marin terminó
  // con archivos genéricos para el laboratorio. Ahora busca ÚNICAMENTE en la galería real
  // (`fotosDisponibles`, la de este curso) y nunca sustituye en silencio: si no la encuentra,
  // el archivo queda marcado con `sinFotoReal: true` (ver datosFoto) para que el fotógrafo lo
  // note y lo resuelva a mano, en vez de imprimir o enviar por error la foto de otro alumno.
  const buscarFoto = (id: string | undefined, categoria: Foto['categoria']): Foto | undefined =>
    id ? fotosDisponibles.find((foto) => foto.id === id && foto.categoria === categoria) : undefined;

  // Datos de imagen para un ArchivoFotoLab a partir de la foto resuelta (o el marcador de "no
  // encontrada" si `buscarFoto` no dio con la foto real).
  const datosFoto = (foto: Foto | undefined): Pick<ArchivoFotoLab, 'urlMuestra' | 'urlOriginalHD' | 'sinFotoReal'> =>
    foto ? { urlMuestra: foto.thumbnail, urlOriginalHD: foto.url } : { urlMuestra: '', sinFotoReal: true };

  const individualFoto = buscarFoto(fotosSeleccionadas.individualId, 'individual');
  const grupalFoto = buscarFoto(fotosSeleccionadas.grupalId, 'grupal');
  const seEligioDocente = Boolean(fotosSeleccionadas.docenteId);
  const docenteFoto = seEligioDocente ? buscarFoto(fotosSeleccionadas.docenteId, 'docente') : undefined;

  const archivosLab: ArchivoFotoLab[] = [
    {
      id: `arch-${Date.now()}-1`,
      tipo: 'individual',
      nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(cursoCodigo, numLista, alumnoNombre, 'INDIVIDUAL', '15x21'),
      tamanoImpresion: '15x21',
      ...datosFoto(individualFoto),
      numeroCopia: 1
    },
    {
      id: `arch-${Date.now()}-2`,
      tipo: 'grupal',
      nombreArchivoOriginal: 'GRUPAL_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(cursoCodigo, numLista, alumnoNombre, 'GRUPAL', '20x30'),
      tamanoImpresion: '20x30',
      ...datosFoto(grupalFoto),
      numeroCopia: 1
    }
  ];

  if (seEligioDocente) {
    archivosLab.push({
      id: `arch-${Date.now()}-3`,
      tipo: 'docente',
      nombreArchivoOriginal: 'DOCENTE_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(cursoCodigo, numLista, alumnoNombre, 'DOCENTE', '15x21'),
      tamanoImpresion: '15x21',
      ...datosFoto(docenteFoto),
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
        ...datosFoto(individualFoto),
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
        ...datosFoto(grupalFoto),
        esCopiaExtra: true,
        numeroCopia: numCopia
      });

      // 3. Copia extra de foto docente 15x21 (si la familia eligió foto de docente)
      if (seEligioDocente) {
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
          ...datosFoto(docenteFoto),
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
        ...datosFoto(individualFoto),
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
        ...datosFoto(grupalFoto),
        esCopiaExtra: true,
        numeroCopia: numCopia
      });
    }
  }

  // Generación automática de archivos duplicados para el laboratorio (Copia Extra 15x21 Con Docente)
  if (copiasExtras?.docente15x21 && copiasExtras.docente15x21 > 0 && seEligioDocente) {
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
        ...datosFoto(docenteFoto),
        esCopiaExtra: true,
        numeroCopia: numCopia
      });
    }
  }

  // Fotos digitales sueltas de eventos elegidas expresamente por la familia. Antes, si la foto
  // no aparecía en la galería real, esta copia extra pagada se perdía en silencio (el `if
  // (fotoEvento)` la salteaba sin dejar rastro); ahora siempre se genera el archivo — marcado
  // `sinFotoReal` si no se encontró — para que quede visible que hay una copia pendiente.
  for (const [indice, fotoId] of (fotosSeleccionadas.otrasIds || []).entries()) {
    const fotoEvento = fotosDisponibles.find((foto) => foto.id === fotoId && foto.categoria === 'patio');
    archivosLab.push({
      id: `arch-${Date.now()}-evento-${indice + 1}`,
      tipo: 'individual',
      nombreArchivoOriginal: 'OTRAS_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(
        cursoCodigo,
        numLista,
        alumnoNombre,
        'OTRAS',
        '15x21',
        true,
        indice + 1
      ),
      tamanoImpresion: '15x21',
      ...datosFoto(fotoEvento),
      esCopiaExtra: true,
      numeroCopia: indice + 1
    });
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
  metodoPago: 'mercadopago' | 'transferencia' | 'efectivo' | 'nave';
  fotosSeleccionadas: {
    individualId: string;
    grupalId: string;
    docenteId?: string;
    otrasIds?: string[];
  };
  copiasExtras?: CopiasExtrasConfig;
  fotosDisponibles?: Foto[];
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
    params.copiasExtras,
    params.fotosDisponibles
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
    // Auditoría 2026-09-15: antes acá se fabricaba un link a un .zip que en la práctica nunca se
    // genera ni se sube a Storage — no existe (todavía) ningún proceso, manual ni automático,
    // que arme ese archivo por pedido. El resultado era un enlace roto (404 "Bucket not found")
    // que igual se guardaba en la base y se mostraba en el portal de familias y en los emails.
    // Se deja vacío hasta que exista un proceso real de generación de ZIP por pedido; tanto el
    // portal (PortalFamiliasModal) como el email de fotos HD (server.ts, enviarCorreoFotosHD) ya
    // están preparados para ocultar el botón de descarga cuando el link viene vacío.
    linkDescargaHD: '',
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
      // Auditoría 2026-09-23: el servidor garantiza que el número de pedido (IFS-2026-XXXX) no se
      // repita — si el que se propuso acá ya existía, devuelve otro. Se adopta el definitivo en
      // el pedido y en el localStorage para que la familia vea el mismo número que le llega por
      // correo y que figura en el panel.
      if (dataSync.pedidoFriendlyId && dataSync.pedidoFriendlyId !== nuevoPedido.id) {
        nuevoPedido.id = dataSync.pedidoFriendlyId;
        guardarPedidosEnStorage([nuevoPedido, ...currentPedidos]);
      }
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

/** Un hijo del carrito multi-hijo, listo para registrarse como su propio pedido. */
export interface ItemCarritoHijo {
  colegioId: string;
  colegioNombre: string;
  cursoCodigo: string;
  grado: string;
  division: string;
  turno: string;
  alumnoNombre: string;
  alumnoNumeroLista?: number;
  kitId: string;
  kitNombre: string;
  metodoPago: 'mercadopago' | 'transferencia' | 'efectivo' | 'nave';
  fotosSeleccionadas: {
    individualId: string;
    grupalId: string;
    docenteId?: string;
    otrasIds?: string[];
  };
  copiasExtras?: CopiasExtrasConfig;
}

export interface ResultadoRegistroCarrito {
  grupoPagoId: string;
  pedidoIds: string[];
  // Auditoría 2026-09-17 (Pablo: "por que tiene esos numeros tan extraños y feos?"): un
  // "IFS-2026-XXXX" por cada hijo, generado acá con el mismo criterio que
  // registrarPedidoDesdePortal (antes esta función no generaba ninguno, y la pantalla de
  // confirmación terminaba mostrando los uuid crudos de "pedidoIds" pegados con comas).
  pedidoFriendlyIds: string[];
  total: number;
  sincronizado: boolean;
  errorSincronizacion?: string;
}

// Mismos precios que PRECIOS_KITS/PRECIO_CARPETA_EXTRA/PRECIO_FOTO_EVENTO en server.ts (y que las
// constantes locales del mismo nombre en PortalFamiliasModal.tsx) — el servidor es SIEMPRE quien
// calcula el monto que realmente se cobra (ver calcularTotalPedido en server.ts, usado por
// /api/pedidos/crear-multiple y por la creación de la preferencia de pago). Este cálculo acá es
// sólo para reconstruir, para esta pantalla, el mismo total que la familia ya vio y confirmó
// antes de pagar — nunca se manda a ningún endpoint de cobro.
const PRECIO_CARPETA_EXTRA_LOCAL = 15000;
const PRECIO_FOTO_EVENTO_LOCAL = 5000;
function calcularTotalItemLocal(item: { kitId: string; copiasExtras?: CopiasExtrasConfig }): number {
  const precioBase = KITS_DISPONIBLES.find((k) => k.id === item.kitId)?.precio || 0;
  const carpetasExtras = Math.max(0, Math.floor(Number(item.copiasExtras?.carpetasExtras) || 0));
  const fotosSueltas = Math.max(0, Math.floor(Number(item.copiasExtras?.otras15x21) || 0));
  return precioBase + carpetasExtras * PRECIO_CARPETA_EXTRA_LOCAL + fotosSueltas * PRECIO_FOTO_EVENTO_LOCAL;
}

/**
 * Auditoría 2026-09-16 (pedido de Pablo: "el cliente debe poder hacer multiple pedido en una
 * sola sesion, un solo pago"): equivalente a registrarPedidoDesdePortal, pero para el carrito
 * de familias con más de un hijo (Código Familiar). Registra en un solo llamado al servidor
 * (/api/pedidos/crear-multiple) UN pedido por cada hijo del carrito, todos agrupados bajo un
 * mismo "grupoPagoId" — esa referencia es la que después se usa para generar UNA sola
 * preferencia de Mercado Pago / intención de Nave que cobra el total combinado (ver
 * mercadoPagoService.ts / naveService.ts), y la que el webhook de pago usa para marcar todos
 * los pedidos del grupo como pagados con una sola confirmación. No reemplaza a
 * registrarPedidoDesdePortal: una familia con un solo hijo sigue usando ese camino, sin ningún
 * cambio de comportamiento.
 */
export async function registrarCarritoMultipleDesdePortal(params: {
  tutorNombre: string;
  tutorTelefono: string;
  tutorEmail: string;
  items: ItemCarritoHijo[];
}): Promise<ResultadoRegistroCarrito> {
  // Un "IFS-2026-XXXX" por cada hijo, generado antes de mandar el carrito (mismo formato que
  // registrarPedidoDesdePortal) — el servidor ya sabe guardarlo (acepta "pedidoFriendlyId" por
  // ítem en /api/pedidos/crear-multiple desde que se agregó ese endpoint), sólo que hasta ahora
  // esta función nunca se lo mandaba.
  let pedidoFriendlyIds = params.items.map(() => `IFS-2026-${Math.floor(1000 + Math.random() * 9000)}`);
  try {
    const res = await fetch('/api/pedidos/crear-multiple', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        tutorNombre: params.tutorNombre,
        tutorTelefono: params.tutorTelefono,
        tutorEmail: params.tutorEmail,
        items: params.items.map((item, idx) => ({
          colegioId: item.colegioId,
          colegioNombre: item.colegioNombre,
          cursoCodigo: item.cursoCodigo,
          grado: item.grado,
          division: item.division,
          turno: item.turno,
          alumnoNombre: item.alumnoNombre,
          alumnoNumeroLista: item.alumnoNumeroLista,
          kitId: item.kitId,
          kitNombre: item.kitNombre,
          metodoPago: item.metodoPago,
          fotosSeleccionadas: item.fotosSeleccionadas,
          copiasExtras: item.copiasExtras,
          pedidoFriendlyId: pedidoFriendlyIds[idx],
          // El servidor calcula el total de cada ítem a partir de kitId + carpetasExtras (mismo
          // criterio que /api/pedidos/crear) — nunca de un total mandado por el navegador.
          carpetasExtras: item.copiasExtras?.carpetasExtras || 0,
        })),
      }),
    });
    const data = await res.json().catch(() => null);
    if (res.ok && data?.success) {
      // Auditoría 2026-09-23: números de pedido definitivos (únicos) según el servidor.
      if (Array.isArray(data.pedidoFriendlyIds) && data.pedidoFriendlyIds.length === pedidoFriendlyIds.length) {
        pedidoFriendlyIds = data.pedidoFriendlyIds.map((fid: unknown, idx: number) => (typeof fid === 'string' && fid) || pedidoFriendlyIds[idx]);
      }
      // Auditoría 2026-09-22 (bug real, ALTA): a diferencia de registrarPedidoDesdePortal (que
      // guarda el pedido en localStorage antes de redirigir a pagar), esta función nunca lo
      // hacía. Mercado Pago y Nave fuerzan una recarga completa de la página (window.location.href
      // al checkout externo), así que al volver, el único rastro que le queda a este navegador de
      // lo que se acababa de pagar es lo que haya en localStorage — y para un carrito multi-hijo
      // eso siempre estaba vacío. Resultado: la pantalla de confirmación mostraba "Alumno" / "Kit
      // Retrato Escolar" / $0 en vez de los hijos y el total reales, justo para las familias que
      // usan el caso insignia de esta función (varios hijos, un solo pago). Se guardan acá los N
      // pedidos del carrito (uno por hijo, todos con el mismo grupoPagoId) igual que hace
      // registrarPedidoDesdePortal para el camino de un solo hijo — no se manda nada nuevo a
      // Supabase, sólo se cachea localmente lo que el servidor ya confirmó.
      const pedidosGuardadosPrevios = obtenerPedidosGuardados();
      const nuevosPedidos: PedidoEscolarCompleto[] = params.items.map((item, idx) => {
        const totalItem = calcularTotalItemLocal(item);
        const numLista = item.alumnoNumeroLista || pedidosGuardadosPrevios.length + idx + 1;
        const codigoAlumno = `${sanitizarParaMinilab(item.cursoCodigo)}_${String(numLista).padStart(2, '0')}_${sanitizarParaMinilab(item.alumnoNombre)}`;
        return {
          id: pedidoFriendlyIds[idx],
          supabaseId: data.pedidoIds?.[idx],
          grupoPagoId: data.grupoPagoId,
          fecha: new Date().toLocaleString('es-AR'),
          colegioId: item.colegioId,
          colegioNombre: item.colegioNombre,
          cursoCodigo: item.cursoCodigo.toUpperCase(),
          grado: item.grado,
          division: item.division,
          turno: item.turno,
          alumnoNumeroLista: numLista,
          alumnoNombre: item.alumnoNombre,
          codigoAlumno,
          tutorNombre: params.tutorNombre,
          tutorTelefono: params.tutorTelefono,
          tutorEmail: params.tutorEmail,
          kitId: item.kitId,
          kitNombre: item.kitNombre,
          total: totalItem,
          metodoPago: item.metodoPago,
          estadoPago: 'pendiente',
          estadoEntrega: 'en_espera',
          fotosSeleccionadas: item.fotosSeleccionadas,
          copiasExtras: item.copiasExtras,
          archivosParaLaboratorio: [],
          linkDescargaHD: '',
          emailEnviado: false,
          fechaEnvioEmail: undefined,
        };
      });
      guardarPedidosEnStorage([...nuevosPedidos, ...pedidosGuardadosPrevios]);

      return {
        grupoPagoId: data.grupoPagoId,
        pedidoIds: data.pedidoIds || [],
        pedidoFriendlyIds,
        total: data.total || 0,
        sincronizado: true,
      };
    }
    return {
      grupoPagoId: '',
      pedidoIds: [],
      pedidoFriendlyIds,
      total: 0,
      sincronizado: false,
      errorSincronizacion: data?.error || `El servidor respondió con un error (HTTP ${res.status}).`,
    };
  } catch (e: any) {
    return {
      grupoPagoId: '',
      pedidoIds: [],
      pedidoFriendlyIds,
      total: 0,
      sincronizado: false,
      errorSincronizacion: e?.message || 'Error de conexión al registrar el carrito en el servidor.',
    };
  }
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
export function construirPedidoCompletoDesdeFila(fila: any, fotosDisponibles: Foto[] = FOTOS_MUESTRA): PedidoEscolarCompleto {
  const fotosSeleccionadas = (fila.fotos_seleccionadas && typeof fila.fotos_seleccionadas === 'object')
    ? fila.fotos_seleccionadas
    : { individualId: '', grupalId: '' };
  const copiasExtras: CopiasExtrasConfig = (fila.copias_extras && typeof fila.copias_extras === 'object')
    ? fila.copias_extras
    : {};
  const numLista = fila.alumno_numero_lista || 1;
  const cursoCodigo = fila.curso_codigo || '';
  const alumnoNombre = fila.alumno_nombre || 'Alumno';

  const archivosLab = generarArchivosParaLaboratorio(cursoCodigo, numLista, alumnoNombre, fotosSeleccionadas, copiasExtras, fotosDisponibles);

  // "estado" (columna real, sólo de PAGO): pendiente_pago | pagado | entregado (legado) |
  // cancelado. "estado_lab" (columna real, todo el pipeline FÍSICO): null | en_produccion |
  // listo_retiro | entregado — ver ETAPAS_LAB en server.ts.
  // Auditoría 2026-09-20 (revisión completa de estados): antes "entregado" existía como valor de
  // "estado" (mezclando "se cobró" con "se retiró"), pero nada en el panel llegó a escribirlo
  // nunca — era una etapa sin forma de alcanzarse. Ahora el retiro físico vive en estado_lab
  // (POST /api/admin/pedidos/:id/marcar-retirado) y "fila.estado === 'entregado'" queda sólo
  // como lectura de compatibilidad por si alguna fila vieja lo tuviera (hoy ninguna la tiene).
  // "estadoEntrega" es una vista derivada de estado_lab para las pantallas que ya existían antes
  // de esta auditoría (portal de familias, seguimiento) — estado_lab es la fuente de verdad.
  let estadoPago: 'aprobado' | 'pendiente' = 'pendiente';
  let estadoEntrega: PedidoEscolarCompleto['estadoEntrega'] = 'en_espera';
  // El pago lo define sólo `estado` (un pedido retirado sin pagar no se muestra como "Aprobado").
  if (fila.estado === 'entregado' || (fila.estado_lab === 'entregado' && fila.estado === 'pagado')) {
    estadoPago = 'aprobado';
    estadoEntrega = 'entregado';
  } else if (fila.estado === 'pagado') {
    estadoPago = 'aprobado';
    // Un kit pagado por adelantado no va al laboratorio hasta que la familia elija sus fotos.
    estadoEntrega = fila.seleccion_pendiente ? 'en_espera' : fila.estado_lab === 'listo_retiro' ? 'listo_retiro' : 'en_laboratorio';
  }

  const fecha = fila.created_at ? new Date(fila.created_at) : new Date();
  const fechaStr = `${String(fecha.getDate()).padStart(2, '0')}/${String(fecha.getMonth() + 1).padStart(2, '0')}/${fecha.getFullYear()} ${String(fecha.getHours()).padStart(2, '0')}:${String(fecha.getMinutes()).padStart(2, '0')}`;

  return {
    id: fila.pedido_friendly_id || fila.id,
    supabaseId: fila.id,
    grupoPagoId: fila.grupo_pago_id || undefined,
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
    seleccionPendiente: Boolean(fila.seleccion_pendiente),
    fotosSeleccionadas,
    copiasExtras,
    archivosParaLaboratorio: archivosLab,
    linkDescargaHD: fila.link_descarga_hd || '',
    emailEnviado: Boolean(fila.email_enviado),
    fechaEnvioEmail: fila.fecha_envio_email || undefined,
    estadoLab: fila.estado_lab || null,
    fechaEnvioProduccion: fila.fecha_envio_produccion || undefined,
    fechaEnvioListoRetiro: fila.fecha_envio_listo_retiro || undefined,
    fechaEntregado: fila.fecha_entregado || undefined,
  };
}

/**
 * Trae los pedidos reales desde Supabase (vía el servidor, con sesión de administrador) para el
 * panel. Devuelve [] ante cualquier falla de red/servidor en vez de tirar, para que el panel
 * pueda seguir mostrando lo que tenga en localStorage como respaldo en ese caso.
 */
export async function obtenerPedidosAdminDesdeSupabase(): Promise<PedidoEscolarCompleto[] | null> {
  try {
    const [resPedidos, resFotos] = await Promise.all([
      fetchAdminAutenticado('/api/admin/pedidos'),
      fetchAdminAutenticado('/api/admin/fotos'),
    ]);
    if (!resPedidos.ok || !resFotos.ok) return null;
    const [dataPedidos, dataFotos] = await Promise.all([resPedidos.json(), resFotos.json()]);
    if (!dataPedidos?.success || !Array.isArray(dataPedidos.pedidos) || !dataFotos?.success || !Array.isArray(dataFotos.fotos)) return null;

    const fotosDisponibles: Foto[] = dataFotos.fotos.map((foto: any) => ({
      id: foto.id,
      url: `/api/admin/fotos/${encodeURIComponent(foto.id)}/original`,
      thumbnail: foto.thumb_path || foto.preview_path || '',
      categoria: foto.categoria,
      titulo: foto.alumno_nombre || `Foto ${foto.categoria}`,
    }));

    return dataPedidos.pedidos.map((fila: any) => construirPedidoCompletoDesdeFila(fila, fotosDisponibles));
  } catch (e) {
    console.warn('No se pudieron obtener los pedidos reales de Supabase:', e);
    // null (y no []): así quien llama distingue "no pude consultar" de "no hay pedidos".
    return null;
  }
}

/**
 * Auditoría 2026-09-18 (pedido de Pablo: automatizar el .zip de descarga HD): esto ya se intenta
 * solo apenas se confirma el pago (en los webhooks del servidor). Esta función es el reintento
 * manual desde el panel — para cuando esa generación automática falló (por ejemplo, si en ese
 * momento todavía no estaban cargadas las fotos del curso) — usada por "Reenviar Email HD".
 */
export async function generarZipHDAdmin(pedidoSupabaseId: string): Promise<{ success: boolean; linkDescargaHD?: string; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/pedidos/${encodeURIComponent(pedidoSupabaseId)}/generar-zip-hd`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo generar el .zip HD.' };
    }
    return { success: true, linkDescargaHD: data.linkDescargaHD };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al generar el .zip HD.' };
  }
}

/**
 * Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo): cierra el pipeline físico
 * del pedido registrando que la familia ya vino y se llevó sus fotos. El servidor exige que el
 * pedido ya esté en "listo_retiro" (ver POST /api/admin/pedidos/:id/marcar-retirado en server.ts)
 * — no se puede marcar como retirado algo que nunca avisamos que estaba listo.
 */
export async function marcarPedidoRetirado(pedidoSupabaseId: string): Promise<{ success: boolean; estadoLab?: string; fechaEntregado?: string; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/pedidos/${encodeURIComponent(pedidoSupabaseId)}/marcar-retirado`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo marcar el pedido como retirado.' };
    }
    return { success: true, estadoLab: data.estadoLab, fechaEntregado: data.fechaEntregado };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al marcar el pedido como retirado.' };
  }
}

/**
 * Auditoría 2026-09-21 (pedido real de Pablo): permite a la familia cambiar el método de pago
 * de un pedido que quedó "Pendiente de Pago" (por ejemplo, si empezó a pagar con Mercado Pago,
 * canceló la ventana de pago antes de confirmar, y prefiere pagar por Nave o transferencia en
 * su lugar). Es un endpoint público (no de admin) — el servidor solo lo permite mientras el
 * pedido siga sin pagarse (ver POST /api/pedidos/:id/cambiar-metodo-pago en server.ts).
 */
export async function cambiarMetodoPagoPedido(
  pedidoSupabaseId: string,
  metodoPago: 'mercadopago' | 'nave' | 'transferencia'
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetch(`/api/pedidos/${encodeURIComponent(pedidoSupabaseId)}/cambiar-metodo-pago`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ metodoPago }),
    });
    const data = await res.json();
    if (!res.ok || !data.success) {
      return { success: false, error: data.error || 'No se pudo cambiar el método de pago.' };
    }
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red al cambiar el método de pago.' };
  }
}

/**
 * Combina los pedidos reales de Supabase con cualquier pedido que sólo exista en el
 * localStorage de este navegador (por ejemplo, uno creado hace un instante cuya sincronización
 * con el servidor todavía no se refleja en una lectura posterior). Supabase es la fuente de la
 * verdad: si un pedido está en ambos lados, se usa siempre la versión del servidor.
 */
export function combinarPedidosConLocal(pedidosServidor: PedidoEscolarCompleto[] | null, pedidosLocales: PedidoEscolarCompleto[]): PedidoEscolarCompleto[] {
  // Sin respuesta del servidor (sin conexión, sesión vencida): se muestra lo guardado localmente.
  if (pedidosServidor === null) return pedidosLocales;
  const idsServidor = new Set(pedidosServidor.map((p) => p.supabaseId).filter(Boolean));
  // Auditoría 2026-09-24 (bug real): antes se conservaban también los pedidos locales que SÍ
  // tenían id de Supabase pero ya no existen en el servidor (borrados desde otra computadora o con
  // "Cerrar año") — quedaban como fantasmas en el panel para siempre. Si el servidor respondió,
  // sólo se suman los locales que nunca llegaron a registrarse (sin supabaseId).
  const localesSinServidor = pedidosLocales.filter((p) => !p.supabaseId);
  return [...pedidosServidor, ...localesSinServidor.filter((p) => !idsServidor.has(p.id))];
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
  linkDescargaHD?: string;
}

/**
 * Busca un pedido por número de pedido o teléfono contra el servidor (Supabase), para que el
 * seguimiento de pedidos de una familia funcione aunque esté en un dispositivo o navegador
 * distinto al que usó para comprar. Devuelve null si no hay coincidencia o si falla la consulta
 * (auditoría 2026-09-09, revisión a fondo — antes esta búsqueda sólo miraba el localStorage).
 */
export class ErrorLimiteBusqueda extends Error {}

export async function buscarPedidoPorSeguimiento(query: string): Promise<PedidoSeguimiento | null> {
  try {
    const res = await fetch(`/api/pedidos/buscar?query=${encodeURIComponent(query)}`);
    const data = await res.json().catch(() => null);
    // Límite de búsquedas alcanzado: se avisa tal cual (antes se informaba "no encontramos tu
    // pedido", y la familia creía que su pedido no existía).
    if (res.status === 429) throw new ErrorLimiteBusqueda(data?.error || 'Demasiadas búsquedas seguidas. Probá de nuevo en unos minutos.');
    if (!res.ok || !data?.success || !data.pedido) return null;
    return data.pedido as PedidoSeguimiento;
  } catch (e) {
    if (e instanceof ErrorLimiteBusqueda) throw e;
    console.warn('Error al buscar el pedido por seguimiento:', e);
    return null;
  }
}

/** Resumen mínimo de un pedido ya existente, para el cartel de confirmación antes de comprar de nuevo. */
export interface PedidoExistenteResumen {
  id: string;
  kit: string;
  total: number;
  estado: 'pendiente_pago' | 'pagado' | 'entregado' | 'cancelado';
  fecha: string;
}

/**
 * Auditoría 2026-09-22 (pedido de Pablo: "por qué me deja volver a comprar si ya tengo un
 * pedido hecho? debería mostrarme el pedido que ya realicé y preguntarme si deseo hacer otro").
 * Se llama justo antes de abrir la galería de un alumno/a puntual, para avisar si ese mismo
 * alumno ya tiene un pedido registrado en ese curso. Devuelve `null` tanto si no hay ningún
 * pedido como si falla la consulta — el chequeo nunca debe bloquear a la familia de comprar,
 * sólo avisarle cuando puede hacerlo con conocimiento de causa.
 */
// Auditoría 2026-09-23: antes recibía el código SECRETO de la sección y el servidor lo comparaba
// contra `pedidos.curso_codigo` (el código determinístico de curso) — nunca coincidían y el aviso
// no aparecía jamás. Ahora se mandan colegio/grado/turno/división y el servidor recalcula el
// código de curso con la misma fórmula con la que guarda los pedidos.
export async function verificarPedidoExistente(datos: {
  colegioId?: string;
  grado?: string;
  turno?: string;
  division?: string;
  alumnoNombre?: string;
}): Promise<PedidoExistenteResumen | null> {
  const { colegioId, grado, turno, division, alumnoNombre } = datos;
  if (!colegioId || !grado || !turno || !alumnoNombre) return null;
  try {
    const params = new URLSearchParams({ colegioId, grado, turno, division: division || '', alumnoNombre });
    const res = await fetch(`/api/pedidos/existente?${params.toString()}`);
    const data = await res.json().catch(() => null);
    if (!res.ok || !data?.success || !data.existe || !data.pedido) return null;
    return data.pedido as PedidoExistenteResumen;
  } catch (e) {
    console.warn('Error al verificar si ya existe un pedido para este alumno:', e);
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
  numeroCopia?: number,
  faltaFotoReal?: boolean
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
    // Fondo profesional para laboratorio. Auditoría 2026-09-15 (pedido de Pablo: "eliminemos
    // todas las fotos de muestra"): cuando no se encontró la foto real (faltaFotoReal), este
    // cartel rojo reemplaza lo que antes era una foto de stock genérica — así el operador del
    // laboratorio ve de inmediato que falta resolver esa foto a mano, en vez de imprimir por
    // error la foto de otro alumno sin darse cuenta.
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    if (faltaFotoReal) {
      grad.addColorStop(0, '#fef2f2');
      grad.addColorStop(1, '#fecaca');
    } else if (esCopiaExtra) {
      grad.addColorStop(0, '#fffbeb');
      grad.addColorStop(1, '#fef3c7');
    } else {
      grad.addColorStop(0, '#f8fafc');
      grad.addColorStop(1, '#e2e8f0');
    }
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // Marco
    ctx.strokeStyle = faltaFotoReal ? '#dc2626' : (esCopiaExtra ? '#f59e0b' : '#cbd5e1');
    ctx.lineWidth = faltaFotoReal ? 22 : (esCopiaExtra ? 18 : 14);
    ctx.strokeRect(18, 18, canvas.width - 36, canvas.height - 36);

    // Encabezado
    ctx.fillStyle = faltaFotoReal ? '#b91c1c' : '#d97706';
    ctx.font = 'bold 24px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('RETRATO ESCOLAR · FOTOGRAFÍA ESCOLAR 2026', canvas.width / 2, 65);

    if (faltaFotoReal) {
      // Badge de alerta: no se encontró la foto real elegida por la familia
      ctx.fillStyle = '#b91c1c';
      ctx.fillRect(canvas.width / 2 - 280, 90, 560, 42);
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 20px sans-serif';
      ctx.fillText('⚠ FALTA LA FOTO REAL — REVISAR A MANO ⚠', canvas.width / 2, 118);

      ctx.fillStyle = '#991b1b';
      ctx.font = 'bold 16px sans-serif';
      ctx.fillText('NO IMPRIMIR ESTA HOJA · BUSCAR LA FOTO CORRECTA ANTES DE ENSOBRAR', canvas.width / 2, 160);
    } else if (esCopiaExtra) {
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
          // Auditoría 2026-09-22: acá se pisaba el nombre con un genérico CODIGO_COPIAn.jpg,
          // descartando el sufijo de TIPO (docente/otras) que generarNombreArchivoLab ya había
          // calculado en foto.nombreArchivoLab. Con eso, una copia extra individual y una copia
          // extra de la foto de docente (mismo numeroCopia, mismo tamaño 15x21) generaban el
          // mismo nombre, colisionaban, y la de docente terminaba renombrada a un genérico
          // "CODIGO_2.jpg" por el fallback de más abajo — sin ninguna marca de que era la copia
          // extra pagada de la foto con el/la docente, con riesgo real de que se arme mal el
          // sobre en el laboratorio. Mismo criterio de sufijo que usa la rama "por_alumno" (más
          // abajo en este archivo, fix del 15/9) para no perder el tipo de foto.
          const sufijoTipoCopia =
            foto.tipo === 'docente'
              ? '_DOCENTE'
              : foto.nombreArchivoOriginal === 'OTRAS_HD.jpg'
                ? '_OTRAS'
                : '';
          nombreJpg = `${codigoCliente}_COPIA${foto.numeroCopia || 2}${sufijoTipoCopia}.jpg`;
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
        listaArchivosLab.push(`${foto.tamanoImpresion}/${nombreJpg}${foto.esCopiaExtra ? ' [COPIA EXTRA]' : ''}${foto.sinFotoReal ? ' [⚠ FALTA FOTO]' : ''}`);

        // Auditoría 2026-09-15 (pedido de Pablo: "eliminemos todas las fotos de muestra"): si
        // no se encontró la foto real (sinFotoReal), no se intenta descargar nada — directo al
        // cartel rojo de "falta la foto" (generarJpgSimuladoLaboratorio con faltaFotoReal), para
        // no arriesgarse a que un fetch a una URL vacía devuelva cualquier cosa.
        if (foto.sinFotoReal) {
          const fallbackBlob = await generarJpgSimuladoLaboratorio(
            codigoCliente,
            foto.tamanoImpresion,
            foto.tipo,
            foto.esCopiaExtra,
            foto.numeroCopia,
            true
          );
          targetFolder?.file(nombreJpg, fallbackBlob);
        } else {
          // Descarga la imagen o genera JPEG válido nativo si hay restricción de CORS
          try {
            const urlFoto = foto.urlOriginalHD || foto.urlMuestra;
            const response = urlFoto.startsWith('/api/admin/')
              ? await fetchAdminAutenticado(urlFoto)
              : await fetch(urlFoto);
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
      }

      const tieneCopiasExtras = p.archivosParaLaboratorio.some(a => a.esCopiaExtra) || (p.copiasExtras && (p.copiasExtras.individual15x21 > 0 || p.copiasExtras.grupal20x30 > 0));
      const tieneFaltantes = p.archivosParaLaboratorio.some(a => a.sinFotoReal);
      const alertaExtra = tieneCopiasExtras ? ' ⚠️ [INCLUYE COPIA EXTRA DUPLICADA]' : '';
      const alertaFaltante = tieneFaltantes ? ' 🛑 [FALTA UNA FOTO REAL - REVISAR ANTES DE ENSOBRAR]' : '';
      planillaTexto += `#${String(p.alumnoNumeroLista).padStart(2, '0')} | ${p.cursoCodigo} | ${p.alumnoNombre} | ${codigoCliente} | ${p.kitNombre}${alertaExtra}${alertaFaltante} | ${listaArchivosLab.join(' + ')}\n`;
    }
  } else {
    // Estructura opcional alternativa: subcarpeta por cada alumno
    for (let i = 0; i < pedidosFiltrados.length; i++) {
      const p = pedidosFiltrados[i];
      const codigoCliente = formatearCodigoCliente(p.cursoCodigo, p.alumnoNombre);
      const carpetaAlumno = `${p.cursoCodigo}/${String(p.alumnoNumeroLista).padStart(2, '0')}_${sanitizarParaMinilab(p.alumnoNombre)}`;

      const nombresUsadosAlumno = new Set<string>();
      for (const foto of p.archivosParaLaboratorio) {
        const sufijoExtra = foto.esCopiaExtra ? `_COPIA${foto.numeroCopia || 2}` : '';
        // Bug crítico (15/9): antes el nombre solo combinaba tamaño + copia, sin distinguir el
        // TIPO de foto (individual/grupal/docente/otras). Como la foto de docente también es
        // 15x21, terminaba con el mismo nombre que la foto individual del mismo alumno y JSZip
        // sobrescribía un archivo con el otro dentro de la misma carpeta — la familia se
        // quedaba sin una de las dos fotos en el ZIP del laboratorio sin ningún aviso.
        const sufijoTipo =
          foto.tipo === 'docente'
            ? '_DOCENTE'
            : foto.nombreArchivoOriginal === 'OTRAS_HD.jpg'
              ? '_OTRAS'
              : '';
        let nombreJpg = `${codigoCliente}_${foto.tamanoImpresion}${sufijoTipo}${sufijoExtra}.jpg`;
        // Red de seguridad adicional: si por cualquier otro motivo dos archivos del mismo
        // alumno terminaran con igual nombre, se agrega un sufijo numérico en vez de
        // sobrescribirse en silencio.
        if (nombresUsadosAlumno.has(nombreJpg)) {
          let seq = 2;
          const base = nombreJpg.replace(/\.jpg$/, '');
          while (nombresUsadosAlumno.has(`${base}_${seq}.jpg`)) seq++;
          nombreJpg = `${base}_${seq}.jpg`;
        }
        nombresUsadosAlumno.add(nombreJpg);
        if (foto.sinFotoReal) {
          const fallbackBlob = await generarJpgSimuladoLaboratorio(
            codigoCliente,
            foto.tamanoImpresion,
            foto.tipo,
            foto.esCopiaExtra,
            foto.numeroCopia,
            true
          );
          zip.folder(carpetaAlumno)?.file(nombreJpg, fallbackBlob);
        } else {
          try {
            const urlFoto = foto.urlOriginalHD || foto.urlMuestra;
            const response = urlFoto.startsWith('/api/admin/')
              ? await fetchAdminAutenticado(urlFoto)
              : await fetch(urlFoto);
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
      }

      const tieneCopiasExtras = p.archivosParaLaboratorio.some(a => a.esCopiaExtra) || (p.copiasExtras && (p.copiasExtras.individual15x21 > 0 || p.copiasExtras.grupal20x30 > 0));
      const tieneFaltantes = p.archivosParaLaboratorio.some(a => a.sinFotoReal);
      const alertaExtra = tieneCopiasExtras ? ' ⚠️ [INCLUYE COPIA EXTRA DUPLICADA]' : '';
      const alertaFaltante = tieneFaltantes ? ' 🛑 [FALTA UNA FOTO REAL - REVISAR ANTES DE ENSOBRAR]' : '';
      planillaTexto += `#${String(p.alumnoNumeroLista).padStart(2, '0')} | ${p.cursoCodigo} | ${p.alumnoNombre} | ${codigoCliente} | ${p.kitNombre}${alertaExtra}${alertaFaltante}\n`;
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
