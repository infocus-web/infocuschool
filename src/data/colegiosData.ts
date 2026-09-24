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

// Fotos reales del repo (public/): reemplazan las fotos de stock (Unsplash) que se usaban antes.
// Nota: por ahora se repite la misma foto para las 3 "tomas" individuales y para las 2 variantes
// grupales, porque todavía no hay más fotos de muestra distintas cargadas — si Pablo suma más
// fotos a public/, alcanza con darles su propia entrada acá.
const FOTO_INDIVIDUAL_MUESTRA = '/individual.png';
const FOTO_GRUPAL_MUESTRA = '/grupal.jpg';
const FOTO_DOCENTE_MUESTRA = '/con%20la%20seno.png';

export const FOTOS_MUESTRA: Foto[] = [
  {
    id: 'foto-ind-1',
    url: FOTO_INDIVIDUAL_MUESTRA,
    thumbnail: FOTO_INDIVIDUAL_MUESTRA,
    categoria: 'individual',
    titulo: 'Individual - Toma 1',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-ind-2',
    url: FOTO_INDIVIDUAL_MUESTRA,
    thumbnail: FOTO_INDIVIDUAL_MUESTRA,
    categoria: 'individual',
    titulo: 'Individual - Toma 2',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-ind-3',
    url: FOTO_INDIVIDUAL_MUESTRA,
    thumbnail: FOTO_INDIVIDUAL_MUESTRA,
    categoria: 'individual',
    titulo: 'Individual - Toma 3',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-grup-1',
    url: FOTO_GRUPAL_MUESTRA,
    thumbnail: FOTO_GRUPAL_MUESTRA,
    categoria: 'grupal',
    titulo: 'Grupal de Grado',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-doc-1',
    url: FOTO_DOCENTE_MUESTRA,
    thumbnail: FOTO_DOCENTE_MUESTRA,
    categoria: 'docente',
    titulo: 'Con la Docente',
    descripcion: '',
    grado: '3° grado',
    division: 'A',
  },
  {
    id: 'foto-pat-1',
    url: FOTO_GRUPAL_MUESTRA,
    thumbnail: FOTO_GRUPAL_MUESTRA,
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
      'Te anotás una sola vez completando el formulario de inscripción online del colegio con tus datos de contacto (email y WhatsApp) y los de tu hijo/a. El sistema compara automáticamente esos datos con el padrón oficial que cargó el colegio: si tu nombre, email o teléfono coinciden con lo registrado, la inscripción se aprueba al instante y te llega por email tu Código Familiar para ver las fotos protegidas. Por eso es clave anotarte con los mismos datos (nombre completo, email y WhatsApp) que el colegio tiene en su padrón — si no coinciden, la inscripción queda pendiente de revisión manual y el fotógrafo te envía el código a la brevedad.',
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
      'Los archivos digitales en alta definición (HD) sin marca de agua se descargan inmediatamente al acreditarse el pago, y además recibís una copia de respaldo por email. Si elegiste el Kit Impreso, las copias físicas en papel satinado de alta durabilidad se entregan en carpeta de presentación rotulada en el colegio.',
  },
  {
    pregunta: '¿Me avisan cuando mi Kit Impreso esté en producción o listo para retirar?',
    respuesta:
      'Sí. Además del email de confirmación al acreditarse el pago, te enviamos un email cuando tu pedido entra en producción en el laboratorio y otro cuando la carpeta ya está lista para retirar en el colegio, para que no tengas que estar preguntando.',
  },
  {
    pregunta: '¿Cuáles son los medios de pago disponibles?',
    respuesta:
      'Podés abonar 100% online y seguro mediante Mercado Pago (tarjeta de débito, crédito o saldo en cuenta), Nave (tarjetas y QR de Banco Galicia) o por Transferencia Bancaria directa con comprobante. No se maneja efectivo ni sobres en la escuela.',
  },
  {
    pregunta: '¿Puedo pagar el kit por adelantado, antes de que estén las fotos?',
    respuesta:
      'Sí. Si las fotos del curso de tu hijo/a todavía no están publicadas, al entrar en "Acceder a las Fotos" vas a ver la opción "Reservá tu kit ahora": elegís el kit, lo pagás con Mercado Pago, Nave o transferencia y listo. Cuando se suban las fotos te avisamos, entrás de nuevo, elegís tus 3 fotos favoritas y tocás "Confirmar mis fotos", sin volver a pagar. Apenas las confirmás te llega la descarga en alta resolución.',
  },
  {
    pregunta: '¿Qué pasa si tengo más de un hijo en el colegio? ¿Tengo que hacer todo doble?',
    respuesta:
      '¡No, para nada! Ahora funciona con 1 solo Código Familiar para todos tus hijos. Al anotarte en la web, cargás a tu primer hijo/a y hacés clic en "Agregar Hermano/a" para sumar a los demás (sin importar si van a distintas salas, turnos o grados). El sistema te entrega un único código familiar (ej: FAM-4821) que te llega por email. Al entrar a la web con ese código podés ver las fotos de todos tus hijos en la misma pantalla y alternar entre ellos con un solo toque. Además, podés pedir la toma de foto de hermanos juntos.',
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
