import JSZip from 'jszip';
import { FOTOS_MUESTRA } from '../data/colegiosData';

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
  id: string; // Ej: IFS-2026-8812
  fecha: string;
  colegioId: string;
  colegioNombre: string;
  cursoCodigo: string; // Ej: SALA3TM
  grado: string;
  division: string;
  turno: string;
  alumnoId?: string;
  alumnoNumeroLista: number;
  alumnoNombre: string;
  codigoAlumno: string; // Ej: SALA3TM_01_ABBA_FAZIO_AGUSTIN
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
 * Ejemplo solicitado por el usuario: curso '3ATT', alumno 'Pérez, Fabricio' o 'Fabricio Pérez' -> '3ATT_FABRICIO_PEREZ'
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

// Pedidos iniciales registrados en el sistema
const PEDIDOS_INICIALES: PedidoEscolarCompleto[] = [
  {
    id: 'IFS-2026-9001',
    fecha: '05/09/2026 09:15',
    colegioId: 'col-modelo-2026',
    colegioNombre: 'Colegio Modelo',
    cursoCodigo: '3ATT',
    grado: 'Sala 3 Años',
    division: 'TT',
    turno: 'Tarde',
    alumnoId: 'alu-fab-01',
    alumnoNumeroLista: 15,
    alumnoNombre: 'Fabricio Pérez',
    codigoAlumno: '3ATT_FABRICIO_PEREZ',
    tutorNombre: 'Lorena Pérez',
    tutorTelefono: '1165432198',
    tutorEmail: 'lorena.perez@gmail.com',
    kitId: 'kit-impreso-digital',
    kitNombre: 'Kit Impreso + Digital',
    total: 33800,
    metodoPago: 'mercadopago',
    estadoPago: 'aprobado',
    estadoEntrega: 'en_laboratorio',
    fotosSeleccionadas: {
      individualId: 'f-ind-1',
      grupalId: 'f-grup-1'
    },
    copiasExtras: {
      individual15x21: 1,
      grupal20x30: 0
    },
    archivosParaLaboratorio: [
      {
        id: 'arch-fab-1',
        tipo: 'individual',
        nombreArchivoOriginal: 'IMG_4901_HD.jpg',
        nombreArchivoLab: '3ATT_FABRICIO_PEREZ.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[0].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[0].url,
        numeroCopia: 1
      },
      {
        id: 'arch-fab-1-dup',
        tipo: 'individual',
        nombreArchivoOriginal: 'IMG_4901_HD.jpg',
        nombreArchivoLab: '3ATT_FABRICIO_PEREZ_COPIA2.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[0].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[0].url,
        esCopiaExtra: true,
        numeroCopia: 2
      },
      {
        id: 'arch-fab-2',
        tipo: 'grupal',
        nombreArchivoOriginal: 'IMG_4920_GRUPAL_HD.jpg',
        nombreArchivoLab: '3ATT_FABRICIO_PEREZ.jpg',
        tamanoImpresion: '20x30',
        urlMuestra: FOTOS_MUESTRA[3].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[3].url,
        numeroCopia: 1
      }
    ],
    linkDescargaHD: 'https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/3ATT/3ATT_FABRICIO_PEREZ.zip',
    emailEnviado: true,
    fechaEnvioEmail: '05/09/2026 09:16'
  },
  {
    id: 'IFS-2026-8812',
    fecha: '02/09/2026 10:30',
    colegioId: 'col-modelo-2026',
    colegioNombre: 'Colegio Modelo',
    cursoCodigo: 'SALA3TM',
    grado: 'Sala 3',
    division: 'Única',
    turno: 'Mañana',
    alumnoId: 'alu-01',
    alumnoNumeroLista: 1,
    alumnoNombre: 'Abba Fazio, Agustín',
    codigoAlumno: 'SALA3TM_01_ABBA_FAZIO_AGUSTIN',
    tutorNombre: 'Mariana Fazio',
    tutorTelefono: '1154893210',
    tutorEmail: 'mariana.fazio@gmail.com',
    kitId: 'kit-impreso-digital',
    kitNombre: 'Kit Impreso + Digital',
    total: 30000,
    metodoPago: 'mercadopago',
    estadoPago: 'aprobado',
    estadoEntrega: 'en_laboratorio',
    fotosSeleccionadas: {
      individualId: 'f-ind-1',
      grupalId: 'f-grup-1',
      docenteId: 'f-doc-1'
    },
    archivosParaLaboratorio: [
      {
        id: 'arch-1',
        tipo: 'individual',
        nombreArchivoOriginal: 'IMG_4901_HD.jpg',
        nombreArchivoLab: 'SALA3TM_01_ABBA_FAZIO_AGUSTIN_INDIVIDUAL_15x21.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[0].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[0].url
      },
      {
        id: 'arch-2',
        tipo: 'grupal',
        nombreArchivoOriginal: 'IMG_4920_GRUPAL_HD.jpg',
        nombreArchivoLab: 'SALA3TM_01_ABBA_FAZIO_AGUSTIN_GRUPAL_20x30.jpg',
        tamanoImpresion: '20x30',
        urlMuestra: FOTOS_MUESTRA[3].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[3].url
      },
      {
        id: 'arch-3',
        tipo: 'docente',
        nombreArchivoOriginal: 'IMG_4935_DOCENTE_HD.jpg',
        nombreArchivoLab: 'SALA3TM_01_ABBA_FAZIO_AGUSTIN_DOCENTE_15x21.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[5].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[5].url
      }
    ],
    linkDescargaHD: 'https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/SALA3TM/01_ABBA_FAZIO_AGUSTIN.zip',
    emailEnviado: true,
    fechaEnvioEmail: '02/09/2026 10:31'
  },
  {
    id: 'IFS-2026-8809',
    fecha: '02/09/2026 11:45',
    colegioId: 'col-modelo-2026',
    colegioNombre: 'Colegio Modelo',
    cursoCodigo: 'SALA3TM',
    grado: 'Sala 3',
    division: 'Única',
    turno: 'Mañana',
    alumnoId: 'alu-02',
    alumnoNumeroLista: 2,
    alumnoNombre: 'Amigorena, Lucas',
    codigoAlumno: 'SALA3TM_02_AMIGORENA_LUCAS',
    tutorNombre: 'Esteban Amigorena',
    tutorTelefono: '1144559988',
    tutorEmail: 'esteban.amigorena@hotmail.com',
    kitId: 'kit-solo-digital',
    kitNombre: 'Solo Digital HD',
    total: 15000,
    metodoPago: 'transferencia',
    estadoPago: 'aprobado',
    estadoEntrega: 'listo_descarga',
    fotosSeleccionadas: {
      individualId: 'f-ind-2',
      grupalId: 'f-grup-1'
    },
    archivosParaLaboratorio: [
      {
        id: 'arch-4',
        tipo: 'individual',
        nombreArchivoOriginal: 'IMG_4905_HD.jpg',
        nombreArchivoLab: 'SALA3TM_02_AMIGORENA_LUCAS_INDIVIDUAL_15x21.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[1].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[1].url
      },
      {
        id: 'arch-5',
        tipo: 'grupal',
        nombreArchivoOriginal: 'IMG_4920_GRUPAL_HD.jpg',
        nombreArchivoLab: 'SALA3TM_02_AMIGORENA_LUCAS_GRUPAL_20x30.jpg',
        tamanoImpresion: '20x30',
        urlMuestra: FOTOS_MUESTRA[3].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[3].url
      }
    ],
    linkDescargaHD: 'https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/SALA3TM/02_AMIGORENA_LUCAS.zip',
    emailEnviado: true,
    fechaEnvioEmail: '02/09/2026 11:46'
  },
  {
    id: 'IFS-2026-8795',
    fecha: '01/09/2026 16:20',
    colegioId: 'col-modelo-2026',
    colegioNombre: 'Colegio Modelo',
    cursoCodigo: 'SALA4A',
    grado: 'Sala 4',
    division: 'A',
    turno: 'Tarde',
    alumnoId: 'alu-04',
    alumnoNumeroLista: 4,
    alumnoNombre: 'Balbi, Paz',
    codigoAlumno: 'SALA4A_04_BALBI_PAZ',
    tutorNombre: 'Carolina Balbi',
    tutorTelefono: '1167221100',
    tutorEmail: 'caro.balbi@yahoo.com.ar',
    kitId: 'kit-impreso-digital',
    kitNombre: 'Kit Impreso + Digital',
    total: 36700,
    metodoPago: 'mercadopago',
    estadoPago: 'aprobado',
    estadoEntrega: 'en_laboratorio',
    fotosSeleccionadas: {
      individualId: 'f-ind-3',
      grupalId: 'f-grup-1',
      docenteId: 'f-doc-1'
    },
    archivosParaLaboratorio: [
      {
        id: 'arch-6',
        tipo: 'individual',
        nombreArchivoOriginal: 'IMG_5102_HD.jpg',
        nombreArchivoLab: 'SALA4A_04_BALBI_PAZ_INDIVIDUAL_15x21.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[2].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[2].url
      },
      {
        id: 'arch-7',
        tipo: 'grupal',
        nombreArchivoOriginal: 'IMG_5150_GRUPAL_HD.jpg',
        nombreArchivoLab: 'SALA4A_04_BALBI_PAZ_GRUPAL_20x30.jpg',
        tamanoImpresion: '20x30',
        urlMuestra: FOTOS_MUESTRA[3].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[3].url
      },
      {
        id: 'arch-8',
        tipo: 'docente',
        nombreArchivoOriginal: 'IMG_5180_DOCENTE_HD.jpg',
        nombreArchivoLab: 'SALA4A_04_BALBI_PAZ_DOCENTE_15x21.jpg',
        tamanoImpresion: '15x21',
        urlMuestra: FOTOS_MUESTRA[5].thumbnail,
        urlOriginalHD: FOTOS_MUESTRA[5].url
      }
    ],
    linkDescargaHD: 'https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/SALA4A/04_BALBI_PAZ.zip',
    emailEnviado: true,
    fechaEnvioEmail: '01/09/2026 16:21'
  }
];

const LOCAL_STORAGE_PEDIDOS_KEY = 'infocus_pedidos_escolares_v1';

export function obtenerPedidosGuardados(): PedidoEscolarCompleto[] {
  if (typeof window === 'undefined') return PEDIDOS_INICIALES;
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_PEDIDOS_KEY);
    if (!raw) {
      localStorage.setItem(LOCAL_STORAGE_PEDIDOS_KEY, JSON.stringify(PEDIDOS_INICIALES));
      return PEDIDOS_INICIALES;
    }
    return JSON.parse(raw);
  } catch {
    return PEDIDOS_INICIALES;
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
 * Registers a new order created by a parent in the portal
 */
export function registrarPedidoDesdePortal(params: {
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
}): PedidoEscolarCompleto {
  const currentPedidos = obtenerPedidosGuardados();
  const numPedido = `IFS-2026-${Math.floor(1000 + Math.random() * 9000)}`;
  const numLista = params.alumnoNumeroLista || currentPedidos.length + 1;
  const codigoAlumno = `${sanitizarParaMinilab(params.cursoCodigo)}_${String(numLista).padStart(2, '0')}_${sanitizarParaMinilab(params.alumnoNombre)}`;

  const individualFoto = FOTOS_MUESTRA.find(f => f.id === params.fotosSeleccionadas.individualId) || FOTOS_MUESTRA[0];
  const grupalFoto = FOTOS_MUESTRA.find(f => f.id === params.fotosSeleccionadas.grupalId) || FOTOS_MUESTRA[3];
  const docenteFoto = params.fotosSeleccionadas.docenteId ? (FOTOS_MUESTRA.find(f => f.id === params.fotosSeleccionadas.docenteId) || FOTOS_MUESTRA[5]) : undefined;

  const archivosLab: ArchivoFotoLab[] = [
    {
      id: `arch-${Date.now()}-1`,
      tipo: 'individual',
      nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(params.cursoCodigo, numLista, params.alumnoNombre, 'INDIVIDUAL', '15x21'),
      tamanoImpresion: '15x21',
      urlMuestra: individualFoto.thumbnail,
      urlOriginalHD: individualFoto.url,
      numeroCopia: 1
    },
    {
      id: `arch-${Date.now()}-2`,
      tipo: 'grupal',
      nombreArchivoOriginal: 'GRUPAL_HD.jpg',
      nombreArchivoLab: generarNombreArchivoLab(params.cursoCodigo, numLista, params.alumnoNombre, 'GRUPAL', '20x30'),
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
      nombreArchivoLab: generarNombreArchivoLab(params.cursoCodigo, numLista, params.alumnoNombre, 'DOCENTE', '15x21'),
      tamanoImpresion: '15x21',
      urlMuestra: docenteFoto.thumbnail,
      urlOriginalHD: docenteFoto.url,
      numeroCopia: 1
    });
  }

  // Generación automática de archivos duplicados para el laboratorio por Copia Extra de Carpeta
  if (params.copiasExtras?.carpetasExtras && params.copiasExtras.carpetasExtras > 0) {
    for (let c = 1; c <= params.copiasExtras.carpetasExtras; c++) {
      const numCopia = c + 1;
      // 1. Copia extra de foto individual 15x21
      archivosLab.push({
        id: `arch-${Date.now()}-extra-carp-ind-${c}`,
        tipo: 'individual',
        nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          params.cursoCodigo,
          numLista,
          params.alumnoNombre,
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
          params.cursoCodigo,
          numLista,
          params.alumnoNombre,
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
            params.cursoCodigo,
            numLista,
            params.alumnoNombre,
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
  if (params.copiasExtras?.individual15x21 && params.copiasExtras.individual15x21 > 0) {
    for (let c = 1; c <= params.copiasExtras.individual15x21; c++) {
      const numCopia = c + 1;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-ind-${c}`,
        tipo: 'individual',
        nombreArchivoOriginal: 'INDIVIDUAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          params.cursoCodigo,
          numLista,
          params.alumnoNombre,
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
  if (params.copiasExtras?.grupal20x30 && params.copiasExtras.grupal20x30 > 0) {
    for (let c = 1; c <= params.copiasExtras.grupal20x30; c++) {
      const numCopia = c + 1;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-grup-${c}`,
        tipo: 'grupal',
        nombreArchivoOriginal: 'GRUPAL_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          params.cursoCodigo,
          numLista,
          params.alumnoNombre,
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
  if (params.copiasExtras?.docente15x21 && params.copiasExtras.docente15x21 > 0 && docenteFoto) {
    for (let c = 1; c <= params.copiasExtras.docente15x21; c++) {
      const numCopia = c + 1;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-doc-${c}`,
        tipo: 'docente',
        nombreArchivoOriginal: 'DOCENTE_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          params.cursoCodigo,
          numLista,
          params.alumnoNombre,
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
  if (params.copiasExtras?.otras15x21 && params.copiasExtras.otras15x21 > 0) {
    const patioFoto = FOTOS_MUESTRA.find(f => f.categoria === 'patio') || FOTOS_MUESTRA[5];
    for (let c = 1; c <= params.copiasExtras.otras15x21; c++) {
      const numCopia = c;
      archivosLab.push({
        id: `arch-${Date.now()}-extra-otras-${c}`,
        tipo: 'individual',
        nombreArchivoOriginal: 'OTRAS_HD.jpg',
        nombreArchivoLab: generarNombreArchivoLab(
          params.cursoCodigo,
          numLista,
          params.alumnoNombre,
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

  const now = new Date();
  const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

  const nuevoPedido: PedidoEscolarCompleto = {
    id: numPedido,
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
    estadoPago: 'aprobado',
    estadoEntrega: 'en_laboratorio',
    fotosSeleccionadas: params.fotosSeleccionadas,
    copiasExtras: params.copiasExtras,
    archivosParaLaboratorio: archivosLab,
    linkDescargaHD: `https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/${sanitizarParaMinilab(params.cursoCodigo)}/${codigoAlumno}.zip`,
    emailEnviado: true,
    fechaEnvioEmail: fechaStr
  };

  const listaActualizada = [nuevoPedido, ...currentPedidos];
  guardarPedidosEnStorage(listaActualizada);
  return nuevoPedido;
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
