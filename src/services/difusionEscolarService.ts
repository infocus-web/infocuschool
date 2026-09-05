import * as XLSX from 'xlsx';
import { SeccionEscolar, ALUMNOS_NOMINA_2026 } from '../data/alumnosData';
import { descargarLibroExcel, descargarBlobSeguro } from './excelDownloadHelper';

export interface MensajeCursoInfo {
  seccion: SeccionEscolar;
  codigo: string;
  colegioNombre: string;
  mensajeTexto: string;
  urlWeb: string;
}

const DEFAULT_WEB_URL = 'https://retratoescolar.com.ar';

/**
 * Genera el texto perfectamente formateado para enviar a los grupos de WhatsApp de familias
 */
export function generarMensajeWhatsApp(
  seccion: SeccionEscolar,
  codigo: string,
  colegioNombre: string = 'Colegio Modelo',
  urlWeb: string = DEFAULT_WEB_URL
): string {
  return `📸 *FOTOGRAFÍAS ESCOLARES 2026*
🏫 *${colegioNombre.toUpperCase()}*
📍 *${seccion.nombreCompleto.toUpperCase()}* (${seccion.sala} · Turno ${seccion.turno} · Div. ${seccion.division})

¡Hola familias! Les informamos que ya se encuentran disponibles las fotos de la sesión escolar.

🔑 *CÓDIGO DE ACCESO EXCLUSIVO DE NUESTRO CURSO:*
👉 *${codigo}*

🌐 *Ingresen al portal para ver las muestras:*
${urlWeb}

📝 *¿Cómo elegir las fotos de su hijo/a?*
1️⃣ Ingresen al portal web y coloquen el código: *${codigo}*
2️⃣ Seleccionen a su hijo/a de la lista del curso.
3️⃣ Elijan las *3 fotos que están incluidas* en el paquete escolar (Retrato individual, foto grupal y con docente).
4️⃣ Confirmen el pedido ingresando su email para recibir los archivos.

📦 *Opciones disponibles:*
• *Impresiones en Laboratorio:* Fotos impresas en papel fotográfico químico + carpeta personalizada de recuerdo + *los 3 archivos digitales en HD de regalo*.
• *Solo Digitales HD:* Los 3 archivos en máxima resolución listos para guardar en el celular y compartir con familiares.

⏳ *Por favor realizar la selección antes de la fecha de cierre para ingresar en el lote de revelado escolar.*

¡Esperamos que disfruten mucho de este recuerdo!`;
}

/**
 * Genera un archivo de texto con todos los mensajes de WhatsApp organizados por curso
 * listo para enviar a la Dirección o maestras del colegio.
 */
export function generarGuiaWhatsAppColegioTexto(
  secciones: SeccionEscolar[],
  codigosMap: Record<string, string>,
  colegioNombre: string = 'Colegio Modelo',
  urlWeb: string = DEFAULT_WEB_URL
): string {
  const line = '='.repeat(68);
  const subline = '-'.repeat(68);

  const header = `${line}
GUÍA DE DIFUSIÓN POR WHATSAPP PARA EL COLEGIO - FOTOS ESCOLARES 2026
Institución: ${colegioNombre}
Sitio Web de Selección: ${urlWeb}
${line}

INSTRUCCIONES PARA LA SECRETARÍA Y DOCENTES:
Cada sala o división tiene asignado un código de acceso único.
A continuación encontrarán el mensaje individual correspondiente a cada curso.
Solo deben COPIAR y PEGAR el texto en el grupo de WhatsApp de las familias de esa sala.

`;

  const body = secciones.map((sec, idx) => {
    const code = codigosMap[sec.id] || sec.id;
    const msg = generarMensajeWhatsApp(sec, code, colegioNombre, urlWeb);

    return `${subline}
[${idx + 1}/${secciones.length}] CURSO: ${sec.nombreCompleto.toUpperCase()}
Turno: ${sec.turno} | División: ${sec.division} | Total alumnos: ${sec.totalAlumnos}
Código de acceso: ${code}
${subline}

${msg}

`;
  }).join('\n');

  return header + body;
}

/**
 * Descarga el kit de textos de WhatsApp en formato .txt legible
 */
export function descargarGuiaWhatsAppTxt(
  secciones: SeccionEscolar[],
  codigosMap: Record<string, string>,
  colegioNombre: string = 'Colegio Modelo'
) {
  const contenido = generarGuiaWhatsAppColegioTexto(secciones, codigosMap, colegioNombre);
  const blob = new Blob([contenido], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `MENSAJES_WHATSAPP_FAMILIAS_${colegioNombre.replace(/\s+/g, '_')}_2026.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Descarga una planilla Microsoft Excel (.XLSX) nativa con SheetJS, con múltiples pestañas:
 * 1. "Códigos y WhatsApp": Códigos por curso y mensajes de WhatsApp listos para copiar.
 * 2. "Nómina Alumnos y Códigos": Listado completo de los 211 alumnos con su código correspondiente.
 * 3. "Instrucciones para el Colegio": Pasos para la Dirección y maestras.
 */
export function descargarExcelLegibleColegio(
  secciones: SeccionEscolar[],
  codigosMap: Record<string, string>,
  colegioNombre: string = 'Colegio Modelo',
  urlWeb: string = DEFAULT_WEB_URL
) {
  const wb = XLSX.utils.book_new();

  // 1. Hoja Códigos y WhatsApp
  const dataCursos = secciones.map((sec, idx) => {
    const code = codigosMap[sec.id] || sec.id;
    const msg = generarMensajeWhatsApp(sec, code, colegioNombre, urlWeb);
    return {
      'N°': idx + 1,
      'Curso / Sala': sec.nombreCompleto,
      'Sala': sec.sala,
      'Turno': sec.turno,
      'División': sec.division,
      'Código de Acceso Familias': code,
      'Total Alumnos': sec.totalAlumnos,
      'Enlace al Portal Web': urlWeb,
      'Mensaje Oficial para Grupos de WhatsApp (Copiar y Pegar)': msg
    };
  });

  const wsCursos = XLSX.utils.json_to_sheet(dataCursos);
  wsCursos['!cols'] = [
    { wch: 5 },   // N°
    { wch: 26 },  // Curso / Sala
    { wch: 12 },  // Sala
    { wch: 14 },  // Turno
    { wch: 10 },  // División
    { wch: 28 },  // Código de Acceso Familias
    { wch: 14 },  // Total Alumnos
    { wch: 35 },  // Enlace al Portal Web
    { wch: 80 },  // Mensaje WhatsApp
  ];
  XLSX.utils.book_append_sheet(wb, wsCursos, 'Códigos y WhatsApp');

  // 2. Hoja Nómina de Alumnos
  const dataAlumnos = ALUMNOS_NOMINA_2026.map((alu, idx) => {
    const sec = secciones.find(s => s.id === alu.seccionId);
    const code = sec ? (codigosMap[sec.id] || sec.id) : '';
    return {
      'N°': idx + 1,
      'Apellido': alu.apellido,
      'Nombre': alu.nombre,
      'Curso / Sala': sec ? sec.nombreCompleto : alu.grado,
      'Turno': sec ? sec.turno : '',
      'División': sec ? sec.division : '',
      'Código de Acceso': code,
      'Fotos Incluidas': '3 tomas (Retrato, Grupo, Docente)',
      'Acceso Web': urlWeb
    };
  });

  const wsAlumnos = XLSX.utils.json_to_sheet(dataAlumnos);
  wsAlumnos['!cols'] = [
    { wch: 5 },
    { wch: 22 },
    { wch: 22 },
    { wch: 26 },
    { wch: 12 },
    { wch: 10 },
    { wch: 20 },
    { wch: 36 },
    { wch: 35 }
  ];
  XLSX.utils.book_append_sheet(wb, wsAlumnos, 'Nómina Alumnos y Códigos');

  // 3. Hoja Guía para el Colegio
  const dataGuia = [
    {
      'Paso': '1. Compartir en WhatsApp',
      '¿Qué debe hacer el colegio?': 'Copiar el mensaje de la columna "Mensaje Oficial para Grupos de WhatsApp" de la Hoja 1 y enviarlo al grupo de padres de cada curso.'
    },
    {
      'Paso': '2. Cuaderno de Comunicaciones',
      '¿Qué debe hacer el colegio?': 'Si el colegio prefiere enviar notas en papel, en la plataforma está la opción "Notas Imprimibles (Cuaderno)" con 4 talones recortables listos por hoja A4.'
    },
    {
      'Paso': '3. ¿Cómo ingresan las familias?',
      '¿Qué debe hacer el colegio?': 'Las familias entran a ' + urlWeb + ', escriben el código de su sala, eligen a su hijo/a y eligen las 3 fotos que están incluidas en el paquete escolar.'
    },
    {
      'Paso': '4. Soporte y Consultas',
      '¿Qué debe hacer el colegio?': 'Por dudas de padres o personal directivo, comunicarse con el equipo de fotografía escolar de Retrato Escolar.'
    }
  ];
  const wsGuia = XLSX.utils.json_to_sheet(dataGuia);
  wsGuia['!cols'] = [
    { wch: 30 },
    { wch: 90 }
  ];
  XLSX.utils.book_append_sheet(wb, wsGuia, 'Instrucciones para el Colegio');

  // Escribir y descargar archivo binario XLSX nativo con fallback
  const nombreLimpio = colegioNombre.replace(/\s+/g, '_').toUpperCase();
  descargarLibroExcel(wb, `PLANILLA_FOTOS_ESCOLARES_2026_${nombreLimpio}.xlsx`);
}

export const descargarExcelXLSX = descargarExcelLegibleColegio;

/**
 * Exporta un CSV compatible con el Excel en español de Windows
 * usando punto y coma (;) como separador y \uFEFF para evitar caracteres corruptos como años
 */
export function descargarCSVEspañolCompatible(
  secciones: SeccionEscolar[],
  codigosMap: Record<string, string>,
  colegioNombre: string = 'Colegio Modelo'
) {
  const encabezados = [
    'Curso / Sección',
    'Sala',
    'Turno',
    'División',
    'Código de Acceso',
    'Total Alumnos',
    'Enlace al Portal'
  ];

  const filas = secciones.map(sec => {
    const code = codigosMap[sec.id] || sec.id;
    return [
      `"${sec.nombreCompleto}"`,
      `"${sec.sala}"`,
      `"${sec.turno}"`,
      `"${sec.division}"`,
      `"${code}"`,
      sec.totalAlumnos,
      `"https://retratoescolar.com.ar"`
    ].join(';');
  });

  const csvContent = '\uFEFF' + [encabezados.join(';'), ...filas].join('\r\n');
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  descargarBlobSeguro(blob, `PLANILLA_CURSOS_EXCEL_${colegioNombre.replace(/\s+/g, '_')}_2026.csv`);
}
