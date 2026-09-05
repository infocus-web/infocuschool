import { Colegio, KitProducto, Foto } from '../types';

export const KITS_DISPONIBLES: KitProducto[] = [
  {
    id: 'kit-clasico',
    nombre: 'Kit Impreso + Digital',
    subtitulo: 'Las 3 fotos impresas, con la carpeta',
    tagline: 'Foto grupal 20x30cm + 2 fotos 15x21cm + carpeta exclusiva y descarga HD de regalo',
    precio: 30000,
    popular: true,
    icono: 'Camera',
    incluye: [
      '1 fotografía grupal en formato ampliado 20x30cm',
      '2 fotografías 15x21cm (individual y con docente)',
      '1 carpeta de presentación con diseño exclusivo',
      '🎁 Descarga en alta resolución (HD) de regalo incluida',
      'Acceso directo por link + código QR y copia por email',
      'Entrega en sobre cerrado individual rotulado por grado y división',
    ],
    fotosPermitidas: {
      individuales: 1,
      grupales: 1,
      docentes: 1,
    },
  },
  {
    id: 'kit-digital',
    nombre: 'Solo Digital HD',
    subtitulo: 'Las mismas 3 fotos, sin impresión',
    tagline: 'Mismas 3 fotos seleccionadas en máxima resolución, sin producto físico',
    precio: 15000,
    popular: false,
    icono: 'Sparkles',
    incluye: [
      '1 fotografía grupal + 2 fotos (individual y con docente)',
      'Todas en alta resolución (HD), sin marca de agua',
      'Acceso y descarga inmediata desde el celular vía link + QR',
      'Copia automática enviada por email como respaldo permanente',
      'Libre de costos de envío o impresión',
    ],
    fotosPermitidas: {
      individuales: 1,
      grupales: 1,
      docentes: 1,
    },
  },
  {
    id: 'kit-evento-suelto',
    nombre: 'Fotos Sueltas de Eventos',
    subtitulo: 'Actos patrios, deportes, salidas y muestras',
    tagline: 'Galería digital opcional por evento para adquirir fotos individuales sueltas',
    precio: 5000,
    popular: false,
    icono: 'Bookmark',
    incluye: [
      '1 fotografía digital en alta resolución (HD) sin marca de agua',
      'Cobertura documental espontánea del calendario escolar',
      'Descarga inmediata a tu celular y computadora',
      '100% opcional evento por evento (sin compromiso)',
    ],
    fotosPermitidas: {
      individuales: 1,
      grupales: 0,
      docentes: 0,
    },
  },
];

export const COLEGIOS_EJEMPLO: Colegio[] = [
  {
    id: 'col-isba-2026',
    slug: 'instituto-superior-buenos-aires',
    nombre: 'Instituto Superior Buenos Aires',
    localidad: 'Buenos Aires',
    zona: 'CABA',
    eventoActual: 'Temporada Oficial Retratos y Fotos Escolares 2026',
    codigoAcceso: 'ISBA2026',
    grados: [
      'Sala 3 años',
      'Sala 4 años',
      'Sala 5 años',
      '1° grado',
      '2° grado',
      '3° grado',
      '4° grado',
      '5° grado',
      '6° grado',
      '1° año',
      '2° año',
      '3° año',
      '4° año',
      '5° año',
      '6° año',
    ],
    divisiones: ['A', 'B', 'Celeste', 'Blanca', 'Verde', 'Azul'],
    turnos: ['Mañana', 'Tarde', 'Jornada Completa'],
  },
];

export const FOTOS_MUESTRA: Foto[] = [
  {
    id: 'foto-ind-1',
    url: '/alumna_instituto.jpg',
    thumbnail: '/alumna_instituto.jpg',
    categoria: 'individual',
    titulo: 'Individual - Toma 1',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-ind-2',
    url: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=1200&q=85',
    thumbnail: 'https://images.unsplash.com/photo-1516627145497-ae6968895b74?auto=format&fit=crop&w=400&q=80',
    categoria: 'individual',
    titulo: 'Individual - Toma 2',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-ind-3',
    url: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=1200&q=85',
    thumbnail: 'https://images.unsplash.com/photo-1509062522246-3755977927d7?auto=format&fit=crop&w=400&q=80',
    categoria: 'individual',
    titulo: 'Individual - Toma 3',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-grup-1',
    url: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=1200&q=85',
    thumbnail: 'https://images.unsplash.com/photo-1577896851231-70ef18881754?auto=format&fit=crop&w=400&q=80',
    categoria: 'grupal',
    titulo: 'Grupal de Grado',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-grup-2',
    url: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=1200&q=85',
    thumbnail: 'https://images.unsplash.com/photo-1580582932707-520aed937b7b?auto=format&fit=crop&w=400&q=80',
    categoria: 'grupal',
    titulo: 'Grupal Divertida',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-doc-1',
    url: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=1200&q=85',
    thumbnail: 'https://images.unsplash.com/photo-1524178232363-1fb2b075b655?auto=format&fit=crop&w=400&q=80',
    categoria: 'docente',
    titulo: 'Con la Docente',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-pat-1',
    url: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=1200&q=85',
    thumbnail: 'https://images.unsplash.com/photo-1503676260728-1c00da094a0b?auto=format&fit=crop&w=400&q=80',
    categoria: 'patio',
    titulo: 'Otras Fotos',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
];

export const PREGUNTAS_FRECUENTES = [
  {
    pregunta: '¿Cómo accedo a las fotos de mi hijo/a?',
    respuesta:
      'Al momento de inscribirse en el portal como padre/madre, debés contactarte por WhatsApp con la institución educativa para solicitar el Código de Curso correspondiente a tu hijo/a. Con ese código (por ejemplo, SALA3TM, SALA4A o SALA5B) podrás acceder directamente a ver las fotografías escolares protegidas.',
  },
  {
    pregunta: '¿Puedo comprar solo la versión digital HD sin imprimir?',
    respuesta:
      'Sí. El paquete "Solo Digital HD" ($15.000) incluye exactamente las 3 fotos en alta resolución (grupal, individual y con docente) sin marcas de agua, listas para guardar y compartir desde tu celular o computadora.',
  },
  {
    pregunta: '¿Cuáles son las 3 fotos que incluye el paquete?',
    respuesta:
      'El paquete oficial incluye 3 fotografías seleccionadas: 1 foto grupal de todo el grado/sala (en tamaño ampliado 20x30 cm en kit impreso), 1 retrato individual de tu hijo/a (15x21 cm) eligiendo tu toma favorita, y 1 foto de recuerdo con la docente/seño (15x21 cm).',
  },
  {
    pregunta: '¿Cómo y cuándo recibo las fotos?',
    respuesta:
      'Los archivos digitales en alta definición (HD) sin marca de agua se descargan inmediatamente al acreditarse el pago, y además recibís una copia de respaldo por email y WhatsApp. Si elegiste el Kit Impreso, las copias físicas en papel satinado de alta durabilidad se entregan en carpeta de presentación rotulada en el colegio.',
  },
  {
    pregunta: '¿Cuáles son los medios de pago disponibles?',
    respuesta:
      'Podés abonar 100% online y seguro mediante Mercado Pago (tarjeta de débito, crédito o saldo en cuenta) o por Transferencia Bancaria directa con comprobante. No se maneja efectivo ni sobres en la escuela.',
  },
  {
    pregunta: '¿Qué pasa si tengo más de un hijo en el colegio?',
    respuesta:
      'Podés ingresar con el código o sala correspondiente a cada uno de tus hijos para ver la galería de su curso, donde encontrarás las tomas del grupo y podrás elegir las fotos de cada uno por separado.',
  },
  {
    pregunta: '¿Es obligatorio comprar las fotos?',
    respuesta:
      'No, para nada. La compra es 100% opcional y voluntaria. Podés ingresar a ver la galería de muestra con marca de agua y decidir libremente si querés conservar el recuerdo.',
  },
  {
    pregunta: '¿Puedo adquirir fotos sueltas de actos u otros eventos del año?',
    respuesta:
      'Sí. Los eventos del año (actos patrios, muestras, deportes y salidas) cuentan con galería digital abierta donde podés adquirir fotos individuales digitales sueltas por $5.000 cada una.',
  },
];
