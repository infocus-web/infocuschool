import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { Resend } from 'resend';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import sharp from 'sharp';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

// Detrás del proxy de Vercel, sin esto Express cree que cada request llega por "http"
// (aunque el visitante esté en https) — eso rompe cualquier lógica que dependa de
// req.protocol, como la URL de retorno que le mandamos a Mercado Pago más abajo.
app.set('trust proxy', true);

app.use(express.json());

// Límite de intentos básico, en memoria, para frenar fuerza bruta / spam en endpoints
// públicos sensibles (login de admin, búsqueda de inscripción por teléfono/email, creación
// de preferencias de pago, solicitudes de código). Auditoría 2026-09-09: hasta ahora ningún
// endpoint tenía ningún límite de frecuencia.
//
// OJO — limitación conocida: en Vercel (serverless) cada instancia puede tener su propia
// memoria, así que esto no es un límite global infalible contra un atacante distribuido;
// sí frena intentos manuales y scripts simples desde una misma conexión, que es el 90% del
// riesgo real hoy. Si en el futuro esto pasa a preocupar más, lo correcto es un store
// compartido (Redis/Upstash) en vez de memoria del proceso.
const intentosPorClave = new Map<string, { count: number; desde: number }>();
function limitarFrecuencia(nombre: string, maxIntentos: number, ventanaMs: number) {
  return (req: Request, res: Response, next: NextFunction) => {
    const ip = req.ip || 'desconocida';
    const clave = `${nombre}:${ip}`;
    const ahora = Date.now();
    const entrada = intentosPorClave.get(clave);
    if (!entrada || ahora - entrada.desde > ventanaMs) {
      intentosPorClave.set(clave, { count: 1, desde: ahora });
      return next();
    }
    entrada.count += 1;
    if (entrada.count > maxIntentos) {
      const segundosRestantes = Math.ceil((ventanaMs - (ahora - entrada.desde)) / 1000);
      return res.status(429).json({
        success: false,
        error: `Demasiados intentos. Probá de nuevo en ${segundosRestantes} segundos.`,
      });
    }
    return next();
  };
}
// Limpieza periódica para no acumular memoria indefinidamente en un proceso de larga vida.
setInterval(() => {
  const ahora = Date.now();
  for (const [clave, entrada] of intentosPorClave.entries()) {
    if (ahora - entrada.desde > 30 * 60 * 1000) intentosPorClave.delete(clave);
  }
}, 5 * 60 * 1000).unref?.();

// ==============================================================================
// 1. CONFIGURACIÓN DE SERVICIOS Y CLIENTES
// ==============================================================================

// Lazy client para Resend
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new Resend(apiKey.trim());
}

// Lazy client para Supabase con Service Role Key (Backend seguro)
let serverSupabaseInstance: SupabaseClient | null = null;
function getServerSupabase(): SupabaseClient | null {
  const url = process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || 'https://ntkqypxvrljuihbxdrtx.supabase.co';
  // Preferir la Service Role Key si existe para saltar RLS en operaciones administrativas
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) {
    return null;
  }
  if (!serverSupabaseInstance) {
    serverSupabaseInstance = createClient(url, key.trim(), {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return serverSupabaseInstance;
}

// Lazy client para Mercado Pago
function getMercadoPagoConfig(): MercadoPagoConfig | null {
  const token = process.env.MERCADOPAGO_ACCESS_TOKEN;
  if (!token || token.trim() === '') {
    return null;
  }
  return new MercadoPagoConfig({ accessToken: token.trim() });
}

// ==============================================================================
// 2. AUTENTICACIÓN ADMINISTRATIVA (ADMIN PIN Y TOKENS FIRMADOS)
// ==============================================================================
function getAdminPin(): string | null {
  const pin = process.env.ADMIN_PIN;
  if (!pin || pin.trim() === '') return null;
  return pin.trim();
}

function getAdminSessionSecret(): string | null {
  const secret = process.env.ADMIN_SESSION_SECRET;
  if (!secret || secret.trim() === '') return null;
  return secret.trim();
}

function normalizePin(p: string): string {
  return (p || '').trim().replace(/^#/, '');
}

function generateAdminToken(): string | null {
  const secret = getAdminSessionSecret();
  if (!secret) return null;
  const timestamp = Date.now();
  const random = crypto.randomBytes(16).toString('hex');
  const payload = `${timestamp}.${random}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(payload)
    .digest('hex');
  return `${payload}.${signature}`;
}

function verifyAdminToken(token?: string): boolean {
  if (!token) return false;
  const secret = getAdminSessionSecret();
  if (!secret) return false;

  const parts = token.split('.');
  if (parts.length !== 3) return false;
  const [timestampStr, random, signature] = parts;
  const timestamp = parseInt(timestampStr, 10);
  if (isNaN(timestamp)) return false;

  // Sesión válida durante 24 horas
  if (Date.now() - timestamp > 24 * 60 * 60 * 1000) return false;

  const expectedSignature = crypto
    .createHmac('sha256', secret)
    .update(`${timestampStr}.${random}`)
    .digest('hex');

  try {
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expectedSignature);
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

function requireAdminAuth(req: Request, res: Response, next: NextFunction) {
  const secret = getAdminSessionSecret();
  if (!secret) {
    return res.status(500).json({
      success: false,
      error: 'ADMIN_SESSION_SECRET no configurada en las variables de entorno del servidor.',
    });
  }

  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : (req.headers['x-admin-token'] as string);

  if (!verifyAdminToken(token)) {
    return res.status(401).json({
      success: false,
      error: 'No autorizado. Se requiere sesión de administrador válida.',
    });
  }
  next();
}

// ==============================================================================
// 3. RUTAS DE AUTENTICACIÓN ADMIN
// ==============================================================================

// Login de administrador con PIN
app.post('/api/admin/login', limitarFrecuencia('admin-login', 8, 10 * 60 * 1000), (req, res) => {
  const adminPin = getAdminPin();
  if (!adminPin) {
    return res.status(500).json({
      success: false,
      error: 'ADMIN_PIN no configurado en las variables de entorno del servidor.',
    });
  }

  const sessionSecret = getAdminSessionSecret();
  if (!sessionSecret) {
    return res.status(500).json({
      success: false,
      error: 'ADMIN_SESSION_SECRET no configurada en las variables de entorno del servidor.',
    });
  }

  const { pin } = req.body;
  if (!pin) {
    return res.status(400).json({ success: false, error: 'PIN requerido' });
  }

  const expectedNormalized = normalizePin(adminPin);
  const inputNormalized = normalizePin(pin);

  const expectedBuf = Buffer.from(expectedNormalized);
  const inputBuf = Buffer.from(inputNormalized);

  const isValid =
    expectedBuf.length === inputBuf.length &&
    crypto.timingSafeEqual(expectedBuf, inputBuf);

  if (isValid) {
    const token = generateAdminToken();
    if (!token) {
      return res.status(500).json({ success: false, error: 'Error al generar token de sesión.' });
    }
    return res.json({
      success: true,
      token,
      expiresIn: 86400,
    });
  }

  return res.status(401).json({
    success: false,
    error: 'PIN de fotógrafo administrador incorrecto.',
  });
});

// Verificación de token activo
app.get('/api/admin/verify', (req, res) => {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith('Bearer ')
    ? authHeader.substring(7)
    : (req.headers['x-admin-token'] as string);

  const valid = verifyAdminToken(token);
  return res.json({ valid });
});

// ==============================================================================
// 4. RUTAS ADMINISTRATIVAS PROTEGIDAS (SUPABASE SERVICE ROLE)
// ==============================================================================

// Guarda valores de configuración pública del sitio (hoy: números de WhatsApp de contacto).
// Antes el panel de admin escribía esto directo desde el navegador contra Supabase con la
// clave anónima (pública, embebida igual en el bundle), protegido solo por una política de
// RLS que en los hechos decía "permitir a cualquiera" (for all using (true) with check (true))
// sin pedir ningún login — cualquiera que supiera el nombre de la tabla podía reescribir el
// WhatsApp de contacto del sitio sin pasar nunca por el panel. Ahora el guardado pasa por acá,
// protegido con sesión de admin, y la política pública de escritura se cierra en Supabase (la
// lectura pública de esta tabla se mantiene, la necesita el sitio para mostrar el WhatsApp).
// Ver auditoría 2026-09-09.
app.post('/api/admin/configuracion', requireAdminAuth, async (req, res) => {
  try {
    const { registros } = req.body || {};
    if (!Array.isArray(registros) || registros.length === 0) {
      return res.status(400).json({ success: false, error: 'Se requiere un array "registros" con al menos un elemento.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const filas = registros
      .filter((r: any) => r && typeof r.clave === 'string' && r.clave.trim())
      .map((r: any) => ({
        clave: String(r.clave).trim(),
        valor: r.valor === undefined || r.valor === null ? '' : String(r.valor),
        datos_extra: r.datos_extra && typeof r.datos_extra === 'object' ? r.datos_extra : {},
        updated_at: new Date().toISOString(),
      }));

    if (filas.length === 0) {
      return res.status(400).json({ success: false, error: 'Ningún registro válido para guardar.' });
    }

    const { error } = await supabase.from('configuracion').upsert(filas, { onConflict: 'clave' });
    if (error) throw error;

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al guardar configuración' });
  }
});

// Auditoría 2026-09 (bug reportado por Pablo): la pestaña "Nómina 2026" mostraba "(1000)"
// aunque el colegio ya tenía 1314 alumnos cargados. Causa: Supabase/PostgREST limita cada
// consulta a un máximo de filas por respuesta (1000 por defecto) aunque no se pida un
// `.limit()` explícito — una sola consulta nunca devuelve más filas que ese tope, sin importar
// cuántas haya en la tabla. Este helper pagina la consulta pidiendo de a 1000 filas hasta
// traerlas todas, para que ningún endpoint dependa de la configuración de "Max Rows" del
// proyecto en Supabase. `construirConsulta` arma la consulta base (columnas, filtros, orden)
// y recibe el rango de filas a pedir en cada vuelta.
async function traerTodasLasFilas<T>(
  construirConsulta: (desde: number, hasta: number) => any
): Promise<T[]> {
  const TAMANO_PAGINA = 1000;
  const filas: T[] = [];
  let desde = 0;
  while (true) {
    const { data, error } = await construirConsulta(desde, desde + TAMANO_PAGINA - 1);
    if (error) throw error;
    const pagina: T[] = data || [];
    filas.push(...pagina);
    if (pagina.length < TAMANO_PAGINA) break;
    desde += TAMANO_PAGINA;
  }
  return filas;
}

// Nómina real de alumnos (tabla 'alumnos', cargada por el importador de padrón). Antes la
// pestaña "Nómina 2026" del panel mostraba una lista vieja, escrita a mano en el código
// (src/data/alumnosData.ts, 211 alumnos de una sola sala de nivel inicial) que no tenía nada
// que ver con los padrones reales que se van cargando por colegio. Se agrega este endpoint
// para que el panel muestre la nómina real de Supabase en vez de esa lista fija.
app.get('/api/admin/alumnos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId } = req.query;

    const alumnos = await traerTodasLasFilas((desde, hasta) => {
      let builder = supabase
        .from('alumnos')
        .select('id, nombre, grado, division, turno, colegio_id, numero_lista, dni, origen')
        .order('grado', { ascending: true })
        .order('division', { ascending: true })
        .order('numero_lista', { ascending: true, nullsFirst: false })
        .range(desde, hasta);
      if (typeof colegioId === 'string' && colegioId) {
        builder = builder.eq('colegio_id', colegioId);
      }
      return builder;
    });

    return res.json({ success: true, alumnos });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener la nómina de alumnos' });
  }
});

// Normaliza un nombre para poder comparar "Juan Pérez" con "juan   perez," (sin acentos,
// mayúsculas, comas/puntos ni espacios de más) — mismo criterio de limpieza que ya se usa
// para los códigos de curso más arriba en este archivo.
function normalizarNombreComparable(nombre: unknown): string {
  return String(nombre || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// La nómina suele cargarse como "Apellido, Nombre" mientras que la familia tipea su propio
// pedido como "Nombre Apellido" (o en cualquier otro orden) — para no perder esos casos, esta
// clave alternativa ordena alfabéticamente las palabras del nombre, así "García María José" y
// "María José García" quedan con la misma clave sin importar el orden en que se escribieron.
function normalizarNombrePorPalabras(nombre: unknown): string {
  return normalizarNombreComparable(nombre)
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ');
}

// Estado de pagos de un colegio/curso puntual: cruza la nómina real de alumnos (tabla
// 'alumnos') contra los pedidos ya registrados para ese mismo colegio_id (tabla 'pedidos'),
// para poder ver de un vistazo quién ya pagó y quién todavía falta — pensado para cursos
// puntuales (ej. actos de egresados) donde el organizador se compromete a una tarifa total
// fija por todo el curso, y hay que ver cuánto falta para llegar a esa meta.
// No hay una columna "alumno_id" confiable en pedidos (no se completa al crear el pedido),
// así que el cruce se hace por nombre normalizado — puede fallar si el nombre cargado en el
// pedido no coincide textualmente con el de la nómina (ej. errores de tipeo de la familia).
app.get('/api/admin/colegios/:colegioId/estado-pagos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId } = req.params;
    if (!colegioId) {
      return res.status(400).json({ success: false, error: 'Falta el colegioId' });
    }

    // Mismo bug que en "Nómina 2026": sin paginar, Supabase/PostgREST corta cada consulta en
    // 1000 filas aunque el colegio tenga más alumnos o pedidos cargados (ver `traerTodasLasFilas`).
    const [alumnos, pedidos] = await Promise.all([
      traerTodasLasFilas<any>((desde, hasta) =>
        supabase
          .from('alumnos')
          .select('id, nombre, grado, division, turno, numero_lista')
          .eq('colegio_id', colegioId)
          .order('grado', { ascending: true })
          .order('division', { ascending: true })
          .order('numero_lista', { ascending: true, nullsFirst: false })
          .range(desde, hasta)
      ),
      traerTodasLasFilas<any>((desde, hasta) =>
        supabase
          .from('pedidos')
          .select('id, alumno_nombre, alumno_numero_lista, estado, total, kit_nombre, metodo_pago, created_at')
          .eq('colegio_id', colegioId)
          .range(desde, hasta)
      ),
    ]);

    // Un pedido cuenta como "pagado" a los fines de este listado si Mercado Pago (o el admin
    // a mano) ya lo confirmó, o si ya se entregó (lo cual implica que se cobró antes).
    const ESTADOS_PAGADOS = new Set(['pagado', 'entregado']);

    // Agrupa los pedidos de este colegio por nombre de alumno normalizado. Si un mismo
    // alumno tiene más de un pedido, se prioriza el pagado (o el más reciente, si hay varios
    // pagados o ninguno lo está) para no perder de vista los otros pedidos.
    // Dos mapas: uno por la clave exacta ("garcia maria jose") y otro por las mismas palabras
    // pero ordenadas alfabéticamente ("garcia jose maria"), para poder emparejar igual aunque
    // la nómina diga "Apellido, Nombre" y la familia haya tipeado "Nombre Apellido".
    const pedidosPorNombreExacto = new Map<string, typeof pedidos>();
    const pedidosPorPalabras = new Map<string, typeof pedidos>();
    for (const p of pedidos) {
      const claveExacta = normalizarNombreComparable(p.alumno_nombre);
      if (!claveExacta) continue;
      if (!pedidosPorNombreExacto.has(claveExacta)) pedidosPorNombreExacto.set(claveExacta, []);
      pedidosPorNombreExacto.get(claveExacta)!.push(p);

      const clavePalabras = normalizarNombrePorPalabras(p.alumno_nombre);
      if (!pedidosPorPalabras.has(clavePalabras)) pedidosPorPalabras.set(clavePalabras, []);
      pedidosPorPalabras.get(clavePalabras)!.push(p);
    }

    const nombresDeLaNomina = new Set(alumnos.map((a) => normalizarNombreComparable(a.nombre)));
    const nombresDeLaNominaPorPalabras = new Set(alumnos.map((a) => normalizarNombrePorPalabras(a.nombre)));

    const alumnosConEstado = alumnos.map((a) => {
      const claveExacta = normalizarNombreComparable(a.nombre);
      const clavePalabras = normalizarNombrePorPalabras(a.nombre);
      const pedidosDelAlumno =
        pedidosPorNombreExacto.get(claveExacta) || pedidosPorPalabras.get(clavePalabras) || [];
      const pedidoPagado = pedidosDelAlumno.find((p) => ESTADOS_PAGADOS.has(p.estado));
      const pedidoElegido = pedidoPagado || pedidosDelAlumno[pedidosDelAlumno.length - 1] || null;
      return {
        id: a.id,
        nombre: a.nombre,
        grado: a.grado,
        division: a.division,
        turno: a.turno,
        numeroLista: a.numero_lista,
        pagado: !!pedidoPagado,
        pedido: pedidoElegido
          ? {
              id: pedidoElegido.id,
              estado: pedidoElegido.estado,
              total: Number(pedidoElegido.total) || 0,
              kitNombre: pedidoElegido.kit_nombre,
              metodoPago: pedidoElegido.metodo_pago,
              fecha: pedidoElegido.created_at,
            }
          : null,
        otrosPedidos: pedidosDelAlumno.length > 1 ? pedidosDelAlumno.length - 1 : 0,
      };
    });

    // Pedidos de este colegio cuyo nombre de alumno no matchea con nadie de la nómina cargada
    // (typo, alumno que ya no está en la nómina, etc.) — se muestran aparte para que el admin
    // los pueda revisar a mano en vez de perderlos silenciosamente.
    const pedidosSinAlumnoEnNomina = pedidos
      .filter((p) => {
        const claveExacta = normalizarNombreComparable(p.alumno_nombre);
        const clavePalabras = normalizarNombrePorPalabras(p.alumno_nombre);
        return claveExacta && !nombresDeLaNomina.has(claveExacta) && !nombresDeLaNominaPorPalabras.has(clavePalabras);
      })
      .map((p) => ({
        id: p.id,
        alumnoNombre: p.alumno_nombre,
        estado: p.estado,
        total: Number(p.total) || 0,
        kitNombre: p.kit_nombre,
        fecha: p.created_at,
      }));

    const totalAlumnos = alumnos.length;
    const alumnosPagados = alumnosConEstado.filter((a) => a.pagado).length;
    const totalRecaudado =
      alumnosConEstado.reduce((acc, a) => acc + (a.pagado ? a.pedido!.total : 0), 0) +
      pedidosSinAlumnoEnNomina.reduce((acc, p) => acc + (ESTADOS_PAGADOS.has(p.estado) ? p.total : 0), 0);

    return res.json({
      success: true,
      alumnos: alumnosConEstado,
      pedidosSinAlumnoEnNomina,
      resumen: {
        totalAlumnos,
        alumnosPagados,
        alumnosFaltantes: totalAlumnos - alumnosPagados,
        totalRecaudado,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener el estado de pagos del colegio' });
  }
});

// Importa alumnos a la nómina real (tabla 'alumnos') para un colegio puntual. No existía
// ninguna forma de cargar esta tabla desde el panel — se cargaba a mano, directo en Supabase.
// Pensado para pegar la lista tal cual sale de copiar un rango de Excel (número de lista +
// nombre separados por tab), una tanda por cada sección (grado/turno/división) del colegio.
app.post('/api/admin/alumnos/importar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { colegioId, filas } = req.body || {};
    if (!colegioId || typeof colegioId !== 'string') {
      return res.status(400).json({ success: false, error: 'Falta indicar el colegio' });
    }
    if (!Array.isArray(filas) || filas.length === 0) {
      return res.status(400).json({ success: false, error: 'No se recibieron filas para importar' });
    }
    if (filas.length > 500) {
      return res.status(400).json({ success: false, error: 'Demasiadas filas en un solo lote (máximo 500)' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const acotar = (valor: unknown, maxLen: number): string => String(valor ?? '').trim().slice(0, maxLen);

    const filasNormalizadas = filas
      .map((f: any) => ({
        colegio_id: colegioId,
        nombre: acotar(f.nombre, 200),
        grado: acotar(f.grado, 60),
        division: acotar(f.division, 60),
        turno: f.turno ? acotar(f.turno, 60) : null,
        numero_lista: Number.isFinite(Number(f.numeroLista)) ? Math.floor(Number(f.numeroLista)) : null,
        dni: f.dni ? acotar(f.dni, 30) : null,
        origen: 'importado_panel_admin',
      }))
      .filter((f: any) => f.nombre && f.grado && f.division);

    if (filasNormalizadas.length === 0) {
      return res.status(400).json({ success: false, error: 'Ninguna fila tiene los datos mínimos (nombre, grado y división)' });
    }

    const { data, error } = await supabase.from('alumnos').insert(filasNormalizadas).select('id');
    if (error) throw error;

    return res.json({
      success: true,
      importados: data?.length || 0,
      descartados: filas.length - filasNormalizadas.length,
    });
  } catch (err: any) {
    console.error('Error al importar alumnos:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al importar alumnos' });
  }
});

// Elimina un alumno puntual de la nómina (ej. para corregir un import duplicado o mal cargado).
app.delete('/api/admin/alumnos/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { error } = await supabase.from('alumnos').delete().eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar el alumno' });
  }
});

// Obtener todas las familias con datos de contacto (restringido al admin)
app.get('/api/admin/familias', requireAdminAuth, async (req, res) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { data, error } = await supabase.from('familias').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, familias: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener familias' });
  }
});

// Obtener todos los pedidos
app.get('/api/admin/pedidos', requireAdminAuth, async (req, res) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    // Auditoría 2026-09-09 (revisión a fondo): se suma el join con "familias" (nombre, whatsapp,
    // email) para que el panel pueda mostrar los datos del tutor sin depender de que el pedido
    // haya quedado además guardado en el localStorage del navegador de esa familia.
    const { data, error } = await supabase
      .from('pedidos')
      .select('*, pedido_fotos(*), familias(nombre, whatsapp, email)')
      .order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, pedidos: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener pedidos' });
  }
});

// Actualizar estado de pedido (Pago o Entrega)
app.post('/api/admin/pedidos/:id/estado', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estadoPago, estadoEntrega } = req.body;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    // OJO: la tabla "pedidos" solo tiene UNA columna de estado ("estado": pendiente_pago |
    // pagado | entregado | cancelado) — no existen columnas separadas "estado_pago" ni
    // "estado_entrega". Antes este endpoint escribía en esas dos columnas inexistentes: como
    // Postgres rechaza el UPDATE completo si cualquiera de las columnas no existe, este botón
    // del panel (marcar pedido pagado/entregado a mano, pensado sobre todo para pagos en
    // efectivo) nunca guardaba nada en Supabase, aunque sí quedara guardado en el localStorage
    // del navegador del admin. Se mapea todo al único estado real. Ver auditoría 2026-09-09.
    let nuevoEstado: string | undefined;
    if (estadoEntrega === 'entregado') {
      nuevoEstado = 'entregado';
    } else if (estadoPago === 'aprobado' || estadoPago === 'pagado') {
      nuevoEstado = 'pagado';
    } else if (estadoPago === 'rechazado' || estadoPago === 'cancelado') {
      nuevoEstado = 'cancelado';
    } else if (estadoPago === 'pendiente') {
      nuevoEstado = 'pendiente_pago';
    }

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (nuevoEstado) {
      updates.estado = nuevoEstado;
    }

    if (Object.keys(updates).length === 1) {
      // Llegó un estado intermedio que hoy no tiene columna propia en la base (ej: estados de
      // laboratorio internos como "laboratorio_listo") — no hay nada real para persistir acá,
      // así que no se hace ningún UPDATE. El panel sigue funcionando con su propio localStorage
      // para esa granularidad interna.
      return res.json({
        success: true,
        pedido: null,
        warning: 'Estado intermedio no persistido en Supabase (sin columna propia para esto).',
      });
    }

    const { data, error } = await supabase.from('pedidos').update(updates).eq('id', id).select();
    if (error) throw error;

    return res.json({ success: true, pedido: data?.[0] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al actualizar pedido' });
  }
});

// Eliminar pedido protegido
app.delete('/api/admin/pedidos/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado' });
    }

    await supabase.from('pedido_fotos').delete().eq('pedido_id', id);
    const { error } = await supabase.from('pedidos').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar pedido' });
  }
});

// Registrar en Supabase las fotos que el admin ya subió a Storage (queda visible al instante para las familias)
app.post('/api/admin/fotos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { fotos } = req.body || {};
    if (!Array.isArray(fotos) || fotos.length === 0) {
      return res.status(400).json({ success: false, error: 'No se recibieron fotos para registrar' });
    }
    if (fotos.length > 500) {
      return res.status(400).json({ success: false, error: 'Demasiadas fotos en un solo lote (máximo 500)' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const filas = fotos
      .map((f: any) => {
        const grado = String(f.grado || '').trim();
        const turno = String(f.turno || '').trim();
        const division = String(f.division || '').trim();
        return {
          colegio_id: f.colegioId ? String(f.colegioId) : null,
          categoria: f.categoria,
          grado: grado || null,
          turno: turno || null,
          division: division || null,
          codigo_curso: grado && turno ? determinarCodigoCursoServidor(grado, turno, division) : null,
          storage_path: f.storagePathHD || '',
          // thumb_path: miniatura chica y sin marca de agua (grilla de la galería).
          // preview_path: copia con la marca de agua quemada en los píxeles (vista ampliada).
          thumb_path: f.storagePathThumb || f.storagePathWeb || null,
          preview_path: f.storagePathWeb || null,
          alumno_nombre: f.alumnoNombre || null,
        };
      })
      .filter((f: any) => f.storage_path && f.categoria && f.codigo_curso);

    if (filas.length === 0) {
      return res.status(400).json({ success: false, error: 'Ninguna foto tiene los datos mínimos (ruta, categoría, grado y turno)' });
    }

    const { data, error } = await supabase.from('fotos').insert(filas).select();
    if (error) throw error;

    return res.json({ success: true, registradas: data?.length || 0 });
  } catch (err: any) {
    console.error('Error al registrar fotos:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al registrar las fotos' });
  }
});

// Migración: genera la miniatura chica y limpia (sin marca de agua) para fotos que se
// subieron ANTES de que existiera esa miniatura propia (su thumb_path todavía apunta a la
// misma copia con marca de agua que preview_path). Se procesa de a un lote chico por
// llamada para no exceder el tiempo máximo de una función serverless; el panel de admin
// la llama en bucle hasta que "restantes" da 0.
app.post('/api/admin/fotos/regenerar-miniaturas', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const limite = Math.min(Math.max(parseInt(String(req.body?.limite || '12'), 10) || 12, 1), 30);

    // .eq()/.or() de PostgREST no permite comparar dos columnas entre sí, así que se trae
    // el universo de fotos y se filtran en el servidor las que todavía no tienen miniatura propia.
    const { data: todas, error: errorSelect } = await supabase
      .from('fotos')
      .select('id, storage_path, thumb_path, preview_path')
      .order('created_at', { ascending: true });
    if (errorSelect) throw errorSelect;

    const candidatas = (todas || []).filter((f: any) => !f.thumb_path || f.thumb_path === f.preview_path);
    const lote = candidatas.slice(0, limite);

    let procesadas = 0;
    let fallidas = 0;

    for (const fila of lote) {
      try {
        const { data: archivo, error: errorDescarga } = await supabase.storage
          .from('fotos-hd')
          .download(fila.storage_path);
        if (errorDescarga || !archivo) throw errorDescarga || new Error('No se pudo descargar el original');

        const buffer = Buffer.from(await archivo.arrayBuffer());
        const miniaturaBuffer = await sharp(buffer)
          .resize(500, 500, { fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 82 })
          .toBuffer();

        const nombreArchivo = fila.storage_path.split('/').pop() || `${fila.id}.jpg`;
        const nombreBase = nombreArchivo.replace(/\.[^./]+$/, '');
        const carpeta = fila.storage_path.replace(/\/originales\/[^/]+$/, '/miniaturas');
        const pathThumb = `${carpeta}/${nombreBase}.jpg`;

        const { error: errorSubida } = await supabase.storage
          .from('fotos-web')
          .upload(pathThumb, miniaturaBuffer, { contentType: 'image/jpeg', upsert: true });
        if (errorSubida) throw errorSubida;

        const { data: urlData } = supabase.storage.from('fotos-web').getPublicUrl(pathThumb);
        // "?v=..." para evitar que el navegador siga mostrando la miniatura vieja cacheada
        // de esta misma URL (el archivo se sube con upsert:true, pisando el anterior).
        const urlConVersion = `${urlData.publicUrl}?v=${Date.now()}`;

        const { error: errorUpdate } = await supabase
          .from('fotos')
          .update({ thumb_path: urlConVersion })
          .eq('id', fila.id);
        if (errorUpdate) throw errorUpdate;

        procesadas++;
      } catch (errFila) {
        console.error(`Error al regenerar miniatura de la foto ${fila.id}:`, errFila);
        fallidas++;
      }
    }

    const restantes = Math.max(candidatas.length - lote.length, 0);
    return res.json({ success: true, procesadas, fallidas, restantes });
  } catch (err: any) {
    console.error('Error al regenerar miniaturas:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al regenerar las miniaturas' });
  }
});

// Tipografía incrustada para la marca de agua generada en el servidor. El entorno serverless
// de Vercel no trae tipografías del sistema instaladas, así que "sans-serif" no existe ahí:
// sharp (que usa librsvg para dibujar el SVG) terminaba dibujando cada letra como un
// cuadradito vacío en vez de texto real. Por eso la marca de agua de las fotos migradas se
// veía como una rayita casi invisible sin importar cuánto se subiera la opacidad — el texto
// nunca se estaba dibujando. La solución es incrustar la tipografía directamente en el SVG
// (subconjunto de DejaVu Sans Bold con sólo las letras/acentos/el punto que usa el texto de
// la marca de agua, ~6 KB en base64) para no depender de que el servidor tenga fuentes.
const FUENTE_MARCA_AGUA_BASE64 =
  'AAEAAAAOAIAAAwBgR0RFRgBMAD0AABBkAAAAHEdQT1NEdkx1AAAQgAAAACBHU1VCJ6Q/wwAAEKAAAACWT1MvMmslck8AAA+MAAAAVmNtYXABlAE9AAAP5AAAAExnYXNwAAcABwAAEFgAAAAMZ2x5ZuKLhtQAAADsAAAMomhlYWQoakw8AAAONAAAADZoaGVhDq8HrgAAD2gAAAAkaG10eFfvD8cAAA5sAAAA/GxvY2FwjnQWAAANsAAAAIRtYXhwAIEDywAADZAAAAAgbmFtZQAGAAAAABAwAAAABnBvc3T/2wBaAAAQOAAAACAAAgAKAAAGJwXVAAcACgAAASEDIQEhASEBIQMERv2mX/59AikBywIp/n39qAGZzAEQ/vAF1forAiUCUgAAAwC8AAAFiQXVAAgAEQAgAAABMjY1NCYrARETMjY1NCYrAREBHgEVFAQpAREhIAQVFAYDElteXlvV4nR1dHXiAkh8iP7c/tb9gQJCATcBF2YDk1BOTVH+xP1zYmNhYf55Ahkkwo3Y1AXVvM9tmQABAGb/4wVcBfAAGQAAJQ4BIyAAERAAITIWFxEuASMiAhUUEjMyNjcFXGrmff6L/kwBtAF1feZqa9BzzuzsznPQa1I3OAGhAWUBZgGhODf+y0lE/vjo5/74REkAAAIAvAAABjkF1QAIABcAAAERMzI2NTQmIwEhIAQXFhIVFAIHBgQpAQI9iuz5+O399QGWAVQBTXdpZmZpeP6w/rD+agSy/HHq397oASNhdGX++Kep/vdldGEAAAEAvAAABOEF1QALAAATIREhESERIREhESG8BA/9cgJn/ZkCpPvbBdX+3f7q/t3+qv7dAAABALwAAATLBdUACQAAEyERIREhESERIbwED/1yAmf9mf5/BdX+3f7q/t39hwAAAQBm/+MF+gXwAB0AACUGBCMgABEQACEyBBcRLgEjIgIVFBIzMjY3ESMRIQX6kP7Kpf6L/kwBvAGClQEReX33fOb58N08ZynrAlhvRkYBoQFlAWkBnjg3/stHRv7/7+3+/g8QASIBAgABALwAAAX2BdUACwAAEyERIREhESERIREhvAGBAjgBgf5//cj+fwXV/ccCOforAnn9hwAAAQC8AAACPQXVAAMAABMhESG8AYH+fwXV+isAAAH/jf5mAj0F1QALAAATIREQACEjETMyNjW8AYH+0f7NTjx4ewXV+rz+6f7sASOGggAAAQC8AAAGcQXVAAoAABMhEQEhCQEhAREhvAGBAisBv/0xAxn+Hv2u/n8F1f3fAiH9PfzuAkz9tAABALwAAAThBdUABQAAEyERIREhvAGBAqT72wXV+07+3QAAAQC8AAAHOQXVAAwAABMhCQEhESERASMBESG8AeoBVAFWAen+lP6o9P6o/pMF1fzhAx/6KwRE/NsDJfu8AAABALwAAAX2BdUACQAAEyEBESERIQERIbwBrgIfAW3+Uv3h/pMF1fwABAD6KwQA/AAAAAIAZv/jBmYF8AALABcAAAEiAhUUEjMyEjU0AgMgABEQACEgABEQAANmsMLCsLHCwrEBaAGY/mj+mP6Z/mcBmQTZ/vzs6/78AQTr7AEEARf+ZP6V/pb+ZAGcAWoBawGcAAIAvAAABYkF1QAKABMAABMhIAQVFAQhIxEhAREzMjY1NCYjvAJ/AR0BMf7P/uP+/n8BgdVwenpwBdX96uv9/foEvv5fbWRkbAAAAgBm/tUGZgXwAA8AGwAABSMgABEQACEgABEUAgcBIQEiAhUUFjMyEjU0AgOPHv6P/mYBmQFnAWsBldfKAS3+kf7jsMK+tLHCwhsBmAFsAWsBnP5o/pH8/pRc/rAGBP787PD/AQTr7AEEAAIAvAAABgAF1QAIABwAAAEyNjU0JisBGQIhESEgBBUUBgceARcTIQMuASMC33lpaXmi/n8CTAEnAROPkE99QNH+ZrY3cV4DP1pnZlj+gf72/csF1cbWlL4tEn+B/lgBc3BSAAABAJP/4wUtBfAAJwAAAREuASMiBhUUFh8BHgEVFAQhIiQnERYEMzI2NTQmLwEuATU0JCEyBATLe+poioRZdaT50v7b/tOO/uKPjwELfH6GW4iV4M8BIAEOewEEBab+xDc4TFA8QxghMsy89/E2NQFFTE1UTkZMHiEw0rLf8CUAAAEACgAABWoF1QAHAAATIREhESERIQoFYP4R/n/+EAXV/t37TgSyAAABALz/4wXDBdUAEQAAEyERFBYzMjY1ESEREAAhIAARvAGBeYmKeQGB/sL+uv67/sIF1fyBuZ+fuQN//IH+w/7KATYBPQAAAQAKAAAGJwXVAAYAABMhCQEhASEKAYMBjAGLAYP91/41BdX7sgRO+isAAQA9AAAIkwXVAAwAABMhCQEhCQEhASEJASE9AXEBAgEAAXMBAAECAW7+oP5E/vH+9P5EBdX7wwQ9+8MEPforBG/7kQABACcAAAYCBdUACwAACQEhCQEhCQEhCQEhA/wCBv5v/qP+pv5tAgb+DgGSAUcBRgGUAvr9BgH+/gIC+gLb/h8B4QAB/+wAAAXfBdUACAAAAyEJASEBESERFAGlAVQBVAGm/cf+fwXV/ewCFPyg/YsCdQABAFwAAAVxBdUACQAAEyEVASERITUBIXME5/zfAzj66wMh/PYF1en8N/7d6QPJAAABANECBgI5A4kAAwAAEyERIdEBaP6YA4n+fQAAAQEG/m8CywAAABMAACEeARUUBiMiJi8BHgEzMjY1NCYnAlo6N3t/MGY0ATJTITpBKy0+ai9fWw0NmBAPLigaUjz//wAKAAAGJwdrEiYAAgAAEAcAPwUAAXX//wAKAAAGJwdrEiYAAgAAEAcAPQUAAXX//wAKAAAGJwdrEiYAAgAAEAcAQAUYAXX//wAKAAAGJwdzEiYAAgAAEAcAPgUYAXv//wAKAAAGJwdrEiYAAgAAEAcAPAUSAXUAAwAKAAAGJwdtABIAHgAhAAAJASEDIQMhAS4BNTQ2MzIWFRQGJRQWMzI2NTQmIyIGAyEDBAgCH/59Xv2mX/59Ah8XFqd2dKgW/ndNNjZNTjU2TUoBmcwFuPpIARD+8AW4IksrdaiodS9MezZNTTY2TU37nwJSAAIAAAAACBkF1QADABMAAAkBIREBIREhESERIREhESERIQMhA3v/AAF5/n0Fkf1zAmb9mgKk+9v+EpP+jQTV/Z4CYgEA/t3+6v7d/qr+3QFe/qIA//8AZv5vBVwF8BImAAQAABAHAB0BcwAA//8AvAAABOEHaxImAAYAABAHAD8EtAF1//8AvAAABOEHaxImAAYAABAHAD0EtAF1//8AvAAABOEHaxImAAYAABAHAEAEtAF1//8AvAAABOEHaxImAAYAABAHADwEtAF1//8AFgAAAj0HaxImAAoAABAHAD8DZAF1//8AvAAAArIHaxImAAoAABAHAD0DZAF1//8AAwAAAvUHaxImAAoAABAHAEADfAF1//8AQQAAArcHaxImAAoAABAHADwDfAF1AAIAIQAABkwF1QAMAB8AAAERMxEjETMyNjU0JiMBISAEFxYSFRQCBwYEKQERIxEzAlDr64ns+fjt/fYBlQFVAUx4aGdnaHn+sP6w/muurgSy/r/+/P626t/e6AEjYXRl/vinqf73ZXRhAm0BBAD//wC8AAAF9gdtEiYADwAAEAcAPgU1AXX//wBm/+MGZgdrEiYAEAAAEAcAPwVOAXX//wBm/+MGZgdrEiYAEAAAEAcAPQVOAXX//wBm/+MGZgdrEiYAEAAAEAcAQAVOAXX//wBm/+MGZgdtEiYAEAAAEAcAPgVnAXX//wBm/+MGZgdrEiYAEAAAEAcAPAVmAXUAAQEAACkFtATbAAsAAAkCBwkBJwkBNwkBBbT+TgGyqP5O/k6oAbL+TqgBsgGyBDP+Tv5QqAGw/lCoAbABsqj+TgGyAAADAC3/tgaWBh8ACQATACsAAAEeATMyEjU0Ji8BLgEjIgIVFBYXAS4BNRAAITIWFzcXBx4BFRAAISImJwcnAlw0g1Oxwg8QTTOCUrDCDg7+6kpKAZkBZ5r4ZsdxyU1M/mj+mJn/ZspxAXM+OwEE60R1MZM6Of787EBxLv7qZPqXAWsBnEtNx3PHY/+a/pb+ZE9Py3H//wC8/+MFwwdrEiYAFgAAEAcAPwUnAXX//wC8/+MFwwdrEiYAFgAAEAcAPQUnAXX//wC8/+MFwwdrEiYAFgAAEAcAQAVAAXX//wC8/+MFwwdrEiYAFgAAEAcAPAVAAXX////sAAAF3wdrEiYAGgAAEAcAPQTNAXUAAvzFBQD/OwX2AAMABwAAATMVIyUzFSP8xevrAYvr6wX29vb2AAAB/W0E7v9OBfYAAwAAASEBI/4zARv+48QF9v74AAAB/KQE7v9cBfgAIwAAAScmJyYjIgYdASM0NjU0NjMyFh8BHgEzMjY1MxQGFRQGIyIm/gI4AwctHCAoiwJrVyVKJzsVJxAlJ4sCa1cmRgUfIwIEGjwyBgUUBWqCGRgnDg88OQYUBWqBFgAAAfyyBO7+kwX2AAMAAAETIwH9zcbE/uMF9v74AQgAAfyHBO7/eQX2AAYAAAEhEyMnByP9ZgE037LHx7IF9v74oaEAAAABAAAAQQNOACsAeAAMAAEAAAAAAAAAAAAAAAAACAAEAAAAAAAAAB4AVQCDALAAygDhARUBLwE9AVYBcgGDAaIBuwHrAhACRQJ3ArcCywLuAwMDJQNGA14DdgOEA6UDsQO9A8kD1QPhBBwERgRSBF4EagR2BIIEjgSaBKYEsgTpBPUFAQUNBRkFJQUxBVMFnQWpBbUFwQXNBdkF7AX7BjAGPwZRAAEAAAACXrjw86/mXw889QAfCAAAAAAA4PrROQAAAADg+tE593L8rg/NCWcAAQAIAAIAAAAAAAAEzQBmAskAAAYxAAoGGQC8Bd8AZgakALwFdwC8BXcAvAaRAGYGsgC8AvoAvAL6/40GMwC8BRkAvAf2ALwGsgC8Bs0AZgXdALwGzQBmBikAvAXDAJMFdQAKBn8AvAYxAAoI0wA9BisAJwXL/+wFzQBcAwoA0QQAAQYGMQAKBjEACgYxAAoGMQAKBjEACgYxAAoIrgAABd8AZgV3ALwFdwC8BXcAvAV3ALwC+gAWAvoAvAL6AAMC+gBBBrQAIQayALwGzQBmBs0AZgbNAGYGzQBmBs0AZga0AQAGzQAtBn8AvAZ/ALwGfwC8Bn8AvAXL/+wAAPzF/W38pPyy/IcAAQAAB23+HQAAECH3cvkyD80AAQAAAAAAAAAAAAAAAAAAAD0AAQSVArwABQAABTMFmQAAAR4FMwWZAAAD1wBmAhIAAAILCAMDBgQCAgQAAAADAAAAAAAAAAAAAAAAUGZFZAAgACAA3QYU/hQBmgdtAeMAAAABAAAAAAAAAAAAAgAAAAMAAAAUAAMAAQAAABQABAA4AAAACgAIAAIAAgAgAFoAtwDd//8AAAAgAEEAtwDA////4f/B/2X/XgABAAAAAAAAAAAAAAAAAAAABgAAAAMAAAAAAAD/2ABaAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAACAAgAAv//AAMAAQAAAAwAAAAAAAAAAgACAAEAHAABAB4AOwABAAEAAAAKABwAHgABREZMVAAIAAQAAAAA//8AAAAAAAAAAQAAAAoAkgCUABRERkxUAHphcmFiAIRhcm1uAIRicmFpAIRjYW5zAIRjaGVyAIRjeXJsAIRnZW9yAIRncmVrAIRoYW5pAIRoZWJyAIRrYW5hAIRsYW8gAIRsYXRuAIRtYXRoAIRua28gAIRydW5yAIR0Zm5nAIR0aGFpAIQABAAAAAD//wAAAAAAAAAAAAAAAA==';

// Genera un SVG con el texto de la marca de agua repetido en diagonal — visible y legible,
// sin la densidad exagerada de la versión original, para componerlo sobre la foto con sharp.
// Incrusta la tipografía en el propio SVG (ver comentario arriba) para que se dibuje igual
// sin importar si el servidor tiene fuentes instaladas.
function generarSvgMarcaDeAgua(ancho: number, alto: number): string {
  // El texto anterior ("MUESTRA RETRATO ESCOLAR · FOTOGRAFÍA ESCOLAR") medía más ancho que
  // el espacio entre repeticiones (stepX), así que cada copia se superponía con la
  // siguiente y el resultado se veía como si hubiera dos marcas de agua pisándose. Ahora el
  // texto es más corto y stepX se calcula a partir de su ancho real en esta tipografía
  // (medido una sola vez con fontTools contra el subset embebido: 17.2407... em), con un
  // margen — así nunca se pisan entre sí. Además, las filas se alternan medio paso para
  // rellenar mejor el espacio, como una marca de agua de banco de fotos.
  const texto = 'MUESTRA · RETRATO ESCOLAR';
  const ANCHO_TEXTO_EM = 17.24072265625;
  const fontSize = Math.max(14, Math.round(ancho * 0.032));
  const anchoTexto = ANCHO_TEXTO_EM * fontSize;
  const stepX = anchoTexto * 1.25;
  const stepY = alto * 0.26;
  const anchoVirtual = ancho * 2.2;
  const altoVirtual = alto * 2.2;
  const textos: string[] = [];
  let fila = 0;
  for (let y = -altoVirtual / 2; y < altoVirtual / 2; y += stepY) {
    const offsetFila = fila % 2 === 0 ? 0 : stepX / 2;
    for (let x = -anchoVirtual / 2 + offsetFila; x < anchoVirtual / 2; x += stepX) {
      textos.push(
        `<text x="${x}" y="${y}" font-family="MarcaAguaRE" font-weight="bold" font-size="${fontSize}" fill="white" fill-opacity="0.6" stroke="black" stroke-opacity="0.5" stroke-width="1.2" text-anchor="middle">${texto}</text>`
      );
    }
    fila++;
  }
  return `<svg width="${ancho}" height="${alto}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <style type="text/css">
        @font-face {
          font-family: 'MarcaAguaRE';
          src: url(data:font/ttf;base64,${FUENTE_MARCA_AGUA_BASE64}) format('truetype');
        }
      </style>
    </defs>
    <g transform="translate(${ancho / 2}, ${alto / 2}) rotate(-25)">
      ${textos.join('\n')}
    </g>
  </svg>`;
}

// Migración: re-genera la copia "ampliada" (con marca de agua quemada en los píxeles) de
// fotos que ya estaban subidas, usando la nueva marca más liviana y espaciada — a partir
// del original guardado, sin que el fotógrafo tenga que volver a subir nada. Se procesa de
// a un lote chico por llamada, igual que la migración de miniaturas.
app.post('/api/admin/fotos/regenerar-marca-agua', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const limite = Math.min(Math.max(parseInt(String(req.body?.limite || '8'), 10) || 8, 1), 20);
    const offset = Math.max(parseInt(String(req.body?.offset || '0'), 10) || 0, 0);

    const { data: todas, error: errorSelect } = await supabase
      .from('fotos')
      .select('id, storage_path')
      .order('created_at', { ascending: true });
    if (errorSelect) throw errorSelect;

    const universo = todas || [];
    const lote = universo.slice(offset, offset + limite);

    let procesadas = 0;
    let fallidas = 0;

    for (const fila of lote) {
      try {
        const { data: archivo, error: errorDescarga } = await supabase.storage
          .from('fotos-hd')
          .download(fila.storage_path);
        if (errorDescarga || !archivo) throw errorDescarga || new Error('No se pudo descargar el original');

        const buffer = Buffer.from(await archivo.arrayBuffer());
        const MAX_DIMENSION = 1600;
        const metadata = await sharp(buffer).metadata();
        let anchoDestino = metadata.width || MAX_DIMENSION;
        let altoDestino = metadata.height || Math.round(MAX_DIMENSION * 0.75);
        if (anchoDestino > MAX_DIMENSION || altoDestino > MAX_DIMENSION) {
          const escala = MAX_DIMENSION / Math.max(anchoDestino, altoDestino);
          anchoDestino = Math.round(anchoDestino * escala);
          altoDestino = Math.round(altoDestino * escala);
        }

        const baseResized = await sharp(buffer).resize(anchoDestino, altoDestino, { fit: 'fill' }).toBuffer();
        const svgMarcaAgua = await sharp(Buffer.from(generarSvgMarcaDeAgua(anchoDestino, altoDestino))).png().toBuffer();

        const ampliadaBuffer = await sharp(baseResized)
          .composite([{ input: svgMarcaAgua }])
          .jpeg({ quality: 85 })
          .toBuffer();

        const nombreArchivo = fila.storage_path.split('/').pop() || `${fila.id}.jpg`;
        const nombreBase = nombreArchivo.replace(/\.[^./]+$/, '');
        const carpeta = fila.storage_path.replace(/\/originales\/[^/]+$/, '/muestras-v2');
        const pathAmpliada = `${carpeta}/${nombreBase}.jpg`;

        const { error: errorSubida } = await supabase.storage
          .from('fotos-web')
          .upload(pathAmpliada, ampliadaBuffer, { contentType: 'image/jpeg', upsert: true });
        if (errorSubida) throw errorSubida;

        const { data: urlData } = supabase.storage.from('fotos-web').getPublicUrl(pathAmpliada);
        // "?v=..." para evitar que el navegador siga mostrando la versión vieja cacheada de
        // esta misma URL (el archivo se sube con upsert:true, pisando el anterior) — esto fue
        // justamente lo que hizo pensar que el arreglo de la marca de agua no se aplicaba.
        const urlConVersion = `${urlData.publicUrl}?v=${Date.now()}`;

        const { error: errorUpdate } = await supabase
          .from('fotos')
          .update({ preview_path: urlConVersion })
          .eq('id', fila.id);
        if (errorUpdate) throw errorUpdate;

        procesadas++;
      } catch (errFila) {
        console.error(`Error al regenerar marca de agua de la foto ${fila.id}:`, errFila);
        fallidas++;
      }
    }

    const restantes = Math.max(universo.length - (offset + lote.length), 0);
    return res.json({ success: true, procesadas, fallidas, restantes, siguienteOffset: offset + lote.length });
  } catch (err: any) {
    console.error('Error al regenerar marca de agua:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al regenerar la marca de agua' });
  }
});

// Panel admin: lista las fotos activas de un curso puntual (grado+turno+división), para revisar o borrar
app.get('/api/admin/fotos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { grado, turno, division, colegioId } = req.query as Record<string, string | undefined>;

    let builder = supabase.from('fotos').select('*').order('created_at', { ascending: false });
    if (grado && turno) {
      builder = builder.eq('codigo_curso', determinarCodigoCursoServidor(grado, turno, division || ''));
    }
    if (colegioId) {
      builder = builder.eq('colegio_id', colegioId);
    }

    const { data, error } = await builder;
    if (error) throw error;
    return res.json({ success: true, fotos: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener las fotos' });
  }
});

// Eliminar foto protegida
app.delete('/api/admin/fotos/:id', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado' });
    }

    const { error } = await supabase.from('fotos').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar foto' });
  }
});

// Vacía por completo el catálogo de fotos (se usa junto con el botón "Limpiar Supabase" que ya vacía los buckets)
app.delete('/api/admin/fotos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado' });
    }
    const { error } = await supabase.from('fotos').delete().not('id', 'is', null);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al limpiar el catálogo de fotos' });
  }
});

// ==============================================================================
// 4B. STORAGE DE FOTOS — SUBIDA/BORRADO PROTEGIDOS (auditoría 2026-09-09)
// ==============================================================================
// Antes de esto, el panel de admin subía y borraba archivos en los buckets 'fotos-web' y
// 'fotos-hd' escribiendo directo desde el navegador con la clave anónima (pública, la misma
// que cualquiera puede leer del bundle del sitio). La única barrera era el PIN de admin en la
// interfaz — pero eso no protege nada del lado de la base: las políticas de RLS de
// storage.objects para esos buckets decían literalmente "permitir a cualquiera, sin login,
// subir/actualizar/borrar" (roles anon/authenticated, sin ninguna condición real). Además el
// bucket 'fotos-hd' (las fotos originales de alta resolución, el producto pago) tenía una
// política de LECTURA pública para el rol anon: cualquiera podía descargar TODAS las fotos
// originales gratis, sin comprar nada. Combinado con el permiso de borrado público, cualquier
// visitante también podía borrar TODAS las fotos del negocio (web y HD) de forma permanente,
// sin que quedara ninguna copia — el peor escenario posible para una empresa de fotografía.
// Ver auditoría 2026-09-09.
//
// La solución: estas operaciones ahora pasan siempre por acá (con sesión de admin) y usan la
// Service Role Key del servidor, que no necesita ninguna política pública en RLS. Las subidas
// grandes de fotos (pueden ser decenas de MB) no conviene mandarlas dentro de un JSON al
// servidor (los límites de tamaño de request de Vercel son bastante más chicos que eso) —así
// que para subir, el servidor solo genera una "signed upload URL" de un solo uso (con permiso
// ya verificado), y el navegador sube el archivo directo a Supabase Storage con esa URL. La
// política pública de INSERT/UPDATE/DELETE/SELECT en los buckets se cierra por completo del
// lado de Supabase — ver migración aplicada en la auditoría.

const BUCKETS_FOTOS_PERMITIDOS = new Set(['fotos-web', 'fotos-hd']);

// Genera una URL de subida firmada y de un solo uso para un archivo puntual. El navegador la
// usa para subir el archivo directo a Storage (client.storage.from(bucket).uploadToSignedUrl),
// sin necesitar ningún permiso público de escritura en el bucket.
app.post('/api/admin/storage/signed-upload-url', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { bucket, path: rutaArchivo } = req.body || {};
    if (!BUCKETS_FOTOS_PERMITIDOS.has(bucket)) {
      return res.status(400).json({ success: false, error: 'Bucket no permitido' });
    }
    if (!rutaArchivo || typeof rutaArchivo !== 'string') {
      return res.status(400).json({ success: false, error: 'Falta la ruta del archivo' });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { data, error } = await supabase.storage.from(bucket).createSignedUploadUrl(rutaArchivo, { upsert: true } as any);
    if (error) throw error;
    return res.json({ success: true, signedUrl: data.signedUrl, token: data.token, path: data.path });
  } catch (err: any) {
    console.error('Error al generar URL de subida firmada:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al generar URL de subida' });
  }
});

// Borra archivos puntuales de un bucket (usado al eliminar una foto individual del panel).
app.post('/api/admin/storage/eliminar-archivos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { bucket, paths } = req.body || {};
    if (!BUCKETS_FOTOS_PERMITIDOS.has(bucket)) {
      return res.status(400).json({ success: false, error: 'Bucket no permitido' });
    }
    if (!Array.isArray(paths) || paths.length === 0) {
      return res.json({ success: true, eliminados: 0 });
    }
    const rutasValidas = paths.filter((p: any) => typeof p === 'string' && p.trim()).slice(0, 200);
    if (rutasValidas.length === 0) {
      return res.json({ success: true, eliminados: 0 });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { error } = await supabase.storage.from(bucket).remove(rutasValidas);
    if (error) throw error;
    return res.json({ success: true, eliminados: rutasValidas.length });
  } catch (err: any) {
    console.error('Error al eliminar archivos de storage:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar archivos' });
  }
});

// Vacía por completo un bucket (botón "Limpiar Supabase" del panel, antes de subir un lote nuevo).
app.post('/api/admin/storage/limpiar-bucket', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { bucket, prefix } = req.body || {};
    if (!BUCKETS_FOTOS_PERMITIDOS.has(bucket)) {
      return res.status(400).json({ success: false, error: 'Bucket no permitido' });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const prefijo = typeof prefix === 'string' ? prefix : '';

    let eliminados = 0;
    // Se pagina por si hay más de 100 archivos (límite por defecto de list()); tope defensivo
    // de 200 vueltas (20.000 archivos) para nunca quedar en un loop infinito.
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      const { data: archivos, error: errorList } = await supabase.storage.from(bucket).list(prefijo, { limit: 100 });
      if (errorList) throw errorList;
      if (!archivos || archivos.length === 0) break;

      const rutas = archivos.filter((f: any) => f.id).map((f: any) => (prefijo ? `${prefijo}/${f.name}` : f.name));
      if (rutas.length === 0) break;

      const { error: errorRemove } = await supabase.storage.from(bucket).remove(rutas);
      if (errorRemove) throw errorRemove;
      eliminados += rutas.length;

      if (archivos.length < 100) break;
    }

    return res.json({ success: true, eliminados });
  } catch (err: any) {
    console.error('Error al limpiar bucket de storage:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al limpiar el bucket' });
  }
});

// Auditoría 2026-09-09 (revisión a fondo): endpoint puntual de una sola vez para borrar dos
// buckets de Storage detectados como huérfanos (ningún código de la app los usa) — 'fotos'
// (público, vacío) y 'photos' (privado, con 4 archivos viejos de prueba). Se usa una lista
// separada de BUCKETS_FOTOS_PERMITIDOS (que son los buckets operativos reales) a propósito, para
// que este endpoint nunca pueda llegar a borrar 'fotos-web' o 'fotos-hd' por error. Se puede
// borrar este endpoint del código una vez usado.
const BUCKETS_HUERFANOS_BORRABLES = new Set(['fotos', 'photos']);
app.post('/api/admin/storage/borrar-bucket-huerfano', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { bucket } = req.body || {};
    if (!BUCKETS_HUERFANOS_BORRABLES.has(bucket)) {
      return res.status(400).json({ success: false, error: 'Ese bucket no está en la lista de buckets huérfanos permitidos para borrar.' });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    let eliminados = 0;
    for (let vuelta = 0; vuelta < 200; vuelta++) {
      const { data: archivos, error: errorList } = await supabase.storage.from(bucket).list('', { limit: 100 });
      if (errorList) throw errorList;
      if (!archivos || archivos.length === 0) break;
      const rutas = archivos.filter((f: any) => f.id).map((f: any) => f.name);
      if (rutas.length === 0) break;
      const { error: errorRemove } = await supabase.storage.from(bucket).remove(rutas);
      if (errorRemove) throw errorRemove;
      eliminados += rutas.length;
      if (archivos.length < 100) break;
    }

    const { error: errorDeleteBucket } = await supabase.storage.deleteBucket(bucket);
    if (errorDeleteBucket) throw errorDeleteBucket;

    return res.json({ success: true, bucket, archivosEliminados: eliminados });
  } catch (err: any) {
    console.error('Error al borrar bucket huérfano:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al borrar el bucket' });
  }
});

// ==============================================================================
// 4C. CIERRE DE TEMPORADA ("Cerrar año") — 2026-09-09
// ==============================================================================
// Antes de esto, el único botón de limpieza ("Limpiar Supabase", en la pestaña de carga de
// fotos) sólo vaciaba los buckets de storage y la tabla `fotos`. Nunca tocaba `alumnos`,
// `familias`, `pedidos`, `pedido_fotos`, `inscripciones`, `padres_autorizados`,
// `codigos_seccion` ni `solicitudes_codigo` — así que no había forma real de arrancar una
// temporada nueva sin dejar pegados los alumnos/pedidos/inscripciones del año anterior.
//
// Este cierre de año SIEMPRE conserva la tabla `colegios` (el colegio en sí no se borra,
// sólo los datos de LA TEMPORADA de ese colegio: alumnos, familias, pedidos, fotos,
// inscripciones, códigos). Se puede aplicar a un colegio puntual, o mandar colegioId="todos"
// para vaciar la temporada completa de todos los colegios de una sola vez (útil hoy, que
// sólo hay uno cargado; pensado para cuando haya varios). Es DESTRUCTIVO e IRREVERSIBLE:
//   1. GET /resumen nunca borra nada — sólo cuenta cuántas filas se verían afectadas, para
//      que el panel se lo muestre al fotógrafo antes de que decida.
//   2. POST /ejecutar exige una frase de confirmación exacta (el nombre real del colegio,
//      verificado del lado del servidor, nunca lo que mande el navegador) — así un clic
//      accidental o un bug del cliente nunca puede disparar el borrado solo.

async function idsDeColegioParaCierre(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  colegioId: string
) {
  const todos = colegioId === 'todos';

  const familiasQuery = supabase.from('familias').select('id');
  const { data: familias, error: errF } = todos
    ? await familiasQuery
    : await familiasQuery.eq('colegio_id', colegioId);
  if (errF) throw errF;

  const alumnosQuery = supabase.from('alumnos').select('id');
  const { data: alumnos, error: errA } = todos
    ? await alumnosQuery
    : await alumnosQuery.eq('colegio_id', colegioId);
  if (errA) throw errA;

  const familiaIds: string[] = (familias || []).map((f: any) => f.id);
  const alumnoIds: string[] = (alumnos || []).map((a: any) => a.id);

  let fotosQuery = supabase.from('fotos').select('id, storage_path, thumb_path, preview_path');
  if (!todos) {
    const filtros = [`colegio_id.eq.${colegioId}`];
    if (alumnoIds.length > 0) filtros.push(`alumno_id.in.(${alumnoIds.join(',')})`);
    fotosQuery = fotosQuery.or(filtros.join(','));
  }
  const { data: fotosData, error: errFo } = await fotosQuery;
  if (errFo) throw errFo;
  const fotos = (fotosData || []) as { id: string; storage_path: string | null; thumb_path: string | null; preview_path: string | null }[];

  let pedidosQuery = supabase.from('pedidos').select('id');
  if (!todos) {
    const filtros: string[] = [];
    if (familiaIds.length > 0) filtros.push(`familia_id.in.(${familiaIds.join(',')})`);
    if (alumnoIds.length > 0) filtros.push(`alumno_id.in.(${alumnoIds.join(',')})`);
    if (filtros.length === 0) {
      // Sin familias ni alumnos en este colegio: no puede haber ningún pedido que le pertenezca.
      pedidosQuery = pedidosQuery.eq('id', '00000000-0000-0000-0000-000000000000');
    } else {
      pedidosQuery = pedidosQuery.or(filtros.join(','));
    }
  }
  const { data: pedidosData, error: errP } = await pedidosQuery;
  if (errP) throw errP;

  return { familiaIds, alumnoIds, fotos, pedidoIds: (pedidosData || []).map((p: any) => p.id) };
}

// Las miniaturas/vistas ampliadas (thumb_path/preview_path) se guardan como URL pública
// completa (bucket 'fotos-web'); storage_path (HD) se guarda como ruta relativa dentro de
// 'fotos-hd'. Esto extrae la ruta relativa real dentro del bucket para poder borrar el
// archivo físico, sea cual sea el formato en el que haya quedado guardado.
function extraerPathStorageParaCierre(valor: string | null, bucket: string): string | null {
  if (!valor) return null;
  const marcador = `/object/public/${bucket}/`;
  const idx = valor.indexOf(marcador);
  if (idx >= 0) return valor.substring(idx + marcador.length);
  return valor.startsWith('http') ? null : valor;
}

app.get('/api/admin/cerrar-anio/resumen', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const colegioId = (req.query.colegioId as string) || '';
    if (!colegioId) {
      return res.status(400).json({ success: false, error: 'Falta colegioId (o "todos")' });
    }

    let nombreColegio = 'Todos los colegios';
    if (colegioId !== 'todos') {
      const { data: colegio, error: errC } = await supabase
        .from('colegios')
        .select('nombre')
        .eq('id', colegioId)
        .single();
      if (errC || !colegio) {
        return res.status(404).json({ success: false, error: 'Colegio no encontrado' });
      }
      nombreColegio = colegio.nombre;
    }

    const { familiaIds, alumnoIds, fotos, pedidoIds } = await idsDeColegioParaCierre(supabase, colegioId);

    const contarPorColegio = async (tabla: string) => {
      let q = supabase.from(tabla).select('id', { count: 'exact', head: true });
      if (colegioId !== 'todos') q = q.eq('colegio_id', colegioId);
      const { count, error } = await q;
      if (error) throw error;
      return count || 0;
    };

    const [inscripciones, padresAutorizados, codigosSeccion, solicitudesCodigo] = await Promise.all([
      contarPorColegio('inscripciones'),
      contarPorColegio('padres_autorizados'),
      contarPorColegio('codigos_seccion'),
      contarPorColegio('solicitudes_codigo'),
    ]);

    let pedidoFotos = 0;
    if (pedidoIds.length > 0 || fotos.length > 0) {
      const filtros: string[] = [];
      if (pedidoIds.length > 0) filtros.push(`pedido_id.in.(${pedidoIds.join(',')})`);
      if (fotos.length > 0) filtros.push(`foto_id.in.(${fotos.map((f) => f.id).join(',')})`);
      const { count, error } = await supabase
        .from('pedido_fotos')
        .select('id', { count: 'exact', head: true })
        .or(filtros.join(','));
      if (error) throw error;
      pedidoFotos = count || 0;
    }

    return res.json({
      success: true,
      colegioNombre: nombreColegio,
      resumen: {
        familias: familiaIds.length,
        alumnos: alumnoIds.length,
        fotos: fotos.length,
        pedidos: pedidoIds.length,
        pedidoFotos,
        inscripciones,
        padresAutorizados,
        codigosSeccion,
        solicitudesCodigo,
      },
    });
  } catch (err: any) {
    console.error('Error al armar el resumen de cierre de año:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al armar el resumen' });
  }
});

app.post('/api/admin/cerrar-anio/ejecutar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId, confirmacion } = req.body || {};
    if (!colegioId || typeof colegioId !== 'string') {
      return res.status(400).json({ success: false, error: 'Falta colegioId (o "todos")' });
    }
    if (typeof confirmacion !== 'string' || !confirmacion.trim()) {
      return res.status(400).json({ success: false, error: 'Falta la frase de confirmación' });
    }

    const normalizar = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

    let fraseEsperada: string;
    if (colegioId === 'todos') {
      fraseEsperada = 'cerrar todos los colegios';
    } else {
      const { data: colegio, error: errC } = await supabase
        .from('colegios')
        .select('nombre')
        .eq('id', colegioId)
        .single();
      if (errC || !colegio) {
        return res.status(404).json({ success: false, error: 'Colegio no encontrado' });
      }
      fraseEsperada = `cerrar ${colegio.nombre}`;
    }

    if (normalizar(confirmacion) !== normalizar(fraseEsperada)) {
      return res.status(400).json({
        success: false,
        error: `La frase de confirmación no coincide. Tenés que escribir exactamente: "${fraseEsperada.toUpperCase()}"`,
      });
    }

    const { familiaIds, alumnoIds, fotos, pedidoIds } = await idsDeColegioParaCierre(supabase, colegioId);
    const fotoIds = fotos.map((f) => f.id);

    // 1) pedido_fotos (depende de pedidos y fotos)
    if (pedidoIds.length > 0 || fotoIds.length > 0) {
      const filtros: string[] = [];
      if (pedidoIds.length > 0) filtros.push(`pedido_id.in.(${pedidoIds.join(',')})`);
      if (fotoIds.length > 0) filtros.push(`foto_id.in.(${fotoIds.join(',')})`);
      const { error } = await supabase.from('pedido_fotos').delete().or(filtros.join(','));
      if (error) throw error;
    }

    // 2) pedidos
    if (pedidoIds.length > 0) {
      const { error } = await supabase.from('pedidos').delete().in('id', pedidoIds);
      if (error) throw error;
    }

    // 3) archivos físicos en storage de las fotos que se van a borrar. Best-effort: si el
    // borrado físico falla no frenamos el cierre de año (los registros igual se limpian);
    // los errores quedan listados en la respuesta para que se puedan revisar a mano.
    const erroresStorage: string[] = [];
    const rutasHD = fotos.map((f) => f.storage_path).filter((p): p is string => !!p);
    const rutasWeb = fotos
      .flatMap((f) => [
        extraerPathStorageParaCierre(f.thumb_path, 'fotos-web'),
        extraerPathStorageParaCierre(f.preview_path, 'fotos-web'),
      ])
      .filter((p): p is string => !!p);
    for (const [bucket, rutas] of [
      ['fotos-hd', rutasHD],
      ['fotos-web', rutasWeb],
    ] as const) {
      for (let i = 0; i < rutas.length; i += 200) {
        const lote = rutas.slice(i, i + 200);
        if (lote.length === 0) continue;
        const { error } = await supabase.storage.from(bucket).remove(lote);
        if (error) erroresStorage.push(`${bucket}: ${error.message}`);
      }
    }

    // 4) fotos
    if (fotoIds.length > 0) {
      const { error } = await supabase.from('fotos').delete().in('id', fotoIds);
      if (error) throw error;
    }

    // 5) alumnos
    if (alumnoIds.length > 0) {
      const { error } = await supabase.from('alumnos').delete().in('id', alumnoIds);
      if (error) throw error;
    }

    // 6) familias
    if (familiaIds.length > 0) {
      const { error } = await supabase.from('familias').delete().in('id', familiaIds);
      if (error) throw error;
    }

    // 7-11) el resto de las tablas de temporada, scopeadas por colegio (o todas si es "todos").
    // Igual que en /api/admin/fotos (DELETE), .not('id','is',null) es el filtro "matchea todo"
    // que exige el cliente de Supabase para no permitir un delete() totalmente sin condición.
    const borrarPorColegio = async (tabla: string) => {
      const q = supabase.from(tabla).delete();
      const { error } = colegioId === 'todos' ? await q.not('id', 'is', null) : await q.eq('colegio_id', colegioId);
      if (error) throw error;
    };
    await borrarPorColegio('eventos');
    await borrarPorColegio('inscripciones');
    await borrarPorColegio('padres_autorizados');
    await borrarPorColegio('codigos_seccion');
    await borrarPorColegio('solicitudes_codigo');

    return res.json({
      success: true,
      borrados: {
        familias: familiaIds.length,
        alumnos: alumnoIds.length,
        fotos: fotoIds.length,
        pedidos: pedidoIds.length,
      },
      erroresStorage: erroresStorage.length > 0 ? erroresStorage : undefined,
    });
  } catch (err: any) {
    console.error('Error al ejecutar el cierre de año:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al cerrar el año' });
  }
});

// Galería pública: fotos reales de un curso puntual, para el portal de familias.
// SEGURIDAD: esta ruta es pública (sin sesión), así que la única puerta de entrada es el
// código secreto de la sección (`codigo_seccion`, ver `codigos_seccion` más arriba). Antes
// esta ruta aceptaba directamente grado/turno/división —datos públicos, visibles en un
// combo del sitio— y devolvía las fotos reales sin pedir ningún código: cualquiera podía
// ver las fotos de cualquier curso con sólo elegir las opciones del desplegable. Ahora el
// grado/turno/división salen del código validado, nunca de lo que mande el navegador.
app.get('/api/fotos', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.query as Record<string, string | undefined>;
    if (!codigo || !codigo.trim()) {
      return res.status(401).json({ success: false, error: 'Falta el código de acceso para ver esta galería' });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const seccion = await buscarSeccionPorCodigoSecreto(supabase, codigo);
    if (!seccion) {
      return res.status(401).json({ success: false, error: 'Código de acceso incorrecto o vencido' });
    }

    const codigoCurso = determinarCodigoCursoServidor(seccion.grado, seccion.turno, seccion.division);
    // Auditoría 2026-09-09 (revisión a fondo): antes esto era select('*'), que además de las
    // columnas que la galería pública necesita (categoria, alumno_nombre, grado, division,
    // preview_path, thumb_path) devolvía también storage_path — la ruta interna dentro del
    // bucket privado 'fotos-hd' (las fotos originales, el producto pago). Ese path por sí solo
    // no alcanza para descargar el archivo (el bucket es privado, hace falta una URL firmada
    // que este endpoint nunca genera), pero no hay ningún motivo para exponerlo en una
    // respuesta pública: se acota a las columnas que la vista previa realmente usa.
    const { data, error } = await supabase
      .from('fotos')
      .select('id, categoria, alumno_nombre, grado, division, preview_path, thumb_path, created_at')
      .eq('colegio_id', seccion.colegioId)
      .eq('codigo_curso', codigoCurso)
      .order('created_at', { ascending: true });
    if (error) throw error;

    return res.json({
      success: true,
      fotos: data || [],
      seccion: { colegioId: seccion.colegioId, grado: seccion.grado, turno: seccion.turno, division: seccion.division }
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener la galería' });
  }
});

// ==============================================================================
// 4A. COLEGIOS: PERFIL DE CADA COLEGIO (GRADOS, DIVISIONES, TURNOS, CÓDIGO DE ACCESO)
// ==============================================================================

const GRADOS_POR_DEFECTO_COLEGIO = [
  'Sala 3 años', 'Sala 4 años', 'Sala 5 años',
  '1° grado', '2° grado', '3° grado', '4° grado', '5° grado', '6° grado', '7° grado',
  '1° año', '2° año', '3° año', '4° año', '5° año', '6° año',
];
const DIVISIONES_POR_DEFECTO_COLEGIO = ['A', 'B', 'C', 'Jornada Extendida'];
const TURNOS_POR_DEFECTO_COLEGIO = ['Mañana', 'Tarde', 'Jornada Extendida / Completa'];

function generarSlugColegio(nombre: string): string {
  return String(nombre || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function mapearColegioSupabase(row: any) {
  return {
    id: row.id,
    slug: row.slug,
    nombre: row.nombre,
    localidad: row.localidad || 'Buenos Aires',
    zona: row.zona || 'CABA',
    eventoActual: row.evento_actual || 'Temporada Oficial Retratos y Fotos Escolares 2026',
    grados: Array.isArray(row.grados) && row.grados.length > 0 ? row.grados : GRADOS_POR_DEFECTO_COLEGIO,
    divisiones: Array.isArray(row.divisiones) && row.divisiones.length > 0 ? row.divisiones : DIVISIONES_POR_DEFECTO_COLEGIO,
    turnos: Array.isArray(row.turnos) && row.turnos.length > 0 ? row.turnos : TURNOS_POR_DEFECTO_COLEGIO,
    codigoAcceso: row.codigo_acceso || '',
    whatsappContacto: row.whatsapp_contacto || undefined,
  };
}

// Lista pública de colegios: la usan el registro de familias, el portal y la búsqueda del sitio.
// No requiere autenticación porque hace falta ANTES de que una familia se identifique.
app.get('/api/colegios', async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    // Solo colegios marcados como públicos: excluye el colegio interno "Colegio Demo — Infocus"
    // que usa el módulo de eventos/kits y que no debe aparecer como opción para las familias.
    const { data, error } = await supabase
      .from('colegios')
      .select('*')
      .eq('activo_publico', true)
      .order('nombre', { ascending: true });
    if (error) throw error;
    return res.json({ success: true, colegios: (data || []).map(mapearColegioSupabase) });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener los colegios' });
  }
});

app.post('/api/admin/colegios', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { nombre, localidad, zona, codigoAcceso, whatsappContacto, grados, divisiones, turnos, eventoActual } = req.body || {};
    if (!nombre || !String(nombre).trim()) {
      return res.status(400).json({ success: false, error: 'Falta el nombre de la institución' });
    }
    if (!codigoAcceso || !String(codigoAcceso).trim()) {
      return res.status(400).json({ success: false, error: 'Falta el código de acceso para las familias' });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const row = {
      slug: generarSlugColegio(nombre),
      nombre: String(nombre).trim(),
      localidad: (localidad || 'Buenos Aires').toString().trim(),
      zona: zona || 'CABA',
      evento_actual: (eventoActual || 'Temporada Oficial Retratos y Fotos Escolares 2026').toString().trim(),
      codigo_acceso: String(codigoAcceso).trim().toUpperCase(),
      whatsapp_contacto: whatsappContacto ? String(whatsappContacto).replace(/\D/g, '') : null,
      grados: Array.isArray(grados) && grados.length > 0 ? grados : GRADOS_POR_DEFECTO_COLEGIO,
      divisiones: Array.isArray(divisiones) && divisiones.length > 0 ? divisiones : DIVISIONES_POR_DEFECTO_COLEGIO,
      turnos: Array.isArray(turnos) && turnos.length > 0 ? turnos : TURNOS_POR_DEFECTO_COLEGIO,
    };

    const { data, error } = await supabase.from('colegios').insert(row).select().single();
    if (error) throw error;
    return res.json({ success: true, colegio: mapearColegioSupabase(data) });
  } catch (err: any) {
    console.error('Error al crear colegio:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al crear el colegio' });
  }
});

app.put('/api/admin/colegios/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { nombre, localidad, zona, codigoAcceso, whatsappContacto, grados, divisiones, turnos, eventoActual } = req.body || {};
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const cambios: Record<string, any> = { updated_at: new Date().toISOString() };
    if (nombre !== undefined) {
      cambios.nombre = String(nombre).trim();
      cambios.slug = generarSlugColegio(nombre);
    }
    if (localidad !== undefined) cambios.localidad = String(localidad).trim();
    if (zona !== undefined) cambios.zona = zona;
    if (codigoAcceso !== undefined) cambios.codigo_acceso = String(codigoAcceso).trim().toUpperCase();
    if (whatsappContacto !== undefined) {
      cambios.whatsapp_contacto = whatsappContacto ? String(whatsappContacto).replace(/\D/g, '') : null;
    }
    if (eventoActual !== undefined) cambios.evento_actual = String(eventoActual).trim();
    if (Array.isArray(grados)) cambios.grados = grados;
    if (Array.isArray(divisiones)) cambios.divisiones = divisiones;
    if (Array.isArray(turnos)) cambios.turnos = turnos;

    const { data, error } = await supabase.from('colegios').update(cambios).eq('id', id).select().single();
    if (error) throw error;
    return res.json({ success: true, colegio: mapearColegioSupabase(data) });
  } catch (err: any) {
    console.error('Error al actualizar colegio:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al actualizar el colegio' });
  }
});

app.delete('/api/admin/colegios/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { error } = await supabase.from('colegios').delete().eq('id', id);
    if (error) {
      if (String((error as any).code) === '23503') {
        return res.status(409).json({
          success: false,
          error: 'No se puede eliminar: este colegio ya tiene familias, eventos o pedidos asociados.',
        });
      }
      throw error;
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('Error al eliminar colegio:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar el colegio' });
  }
});

// Panel admin: devuelve el token secreto de carga de padrón de cada colegio (nunca se expone en /api/colegios,
// que es público). Se usa para armar el link que el fotógrafo comparte con la secretaría del colegio.
app.get('/api/admin/colegios/padron-links', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { data, error } = await supabase.from('colegios').select('id, codigo_padron');
    if (error) throw error;

    const tokens: Record<string, string> = {};
    for (const row of data || []) {
      if (row.codigo_padron) tokens[row.id] = row.codigo_padron;
    }
    return res.json({ success: true, tokens });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener los links de padrón' });
  }
});

// Panel admin: regenera el token secreto de un colegio (por si el link se filtró o hay que invalidarlo)
app.post('/api/admin/colegios/:id/regenerar-padron', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const nuevoToken = crypto.randomBytes(5).toString('hex').toUpperCase();
    const { data, error } = await supabase
      .from('colegios')
      .update({ codigo_padron: nuevoToken, updated_at: new Date().toISOString() })
      .eq('id', id)
      .select('id, codigo_padron')
      .single();
    if (error) throw error;
    return res.json({ success: true, codigoPadron: data.codigo_padron });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al regenerar el token' });
  }
});

// ==============================================================================
// 4B. INSCRIPCIONES: VALIDACIÓN AUTOMÁTICA CONTRA PADRÓN Y GESTIÓN ADMIN
// ==============================================================================

// Determina el código de curso sugerido según sala/turno/división (mismo criterio usado en el frontend)
// IMPORTANTE: mantener esta función en sincro con `determinarCodigoParaInscripcion` en
// src/services/inscripcionesService.ts (misma lógica, una para el servidor y otra para
// mostrarle al instante un código sugerido a la familia en el navegador).
function determinarCodigoCursoServidor(grado: string, turno: string, division: string): string {
  const g = (grado || '').toLowerCase();
  const t = (turno || '').toLowerCase();
  const d = (division || '').toLowerCase();
  const esJornadaExtendida = t.includes('jornada') || t.includes('extendida') || d.includes('jornada') || d.includes('extendida');

  // Nivel inicial (jardín): "Sala 3/4/5 años" — se mantienen los mismos códigos de
  // siempre (SALA-3TM, SALA-4A, etc.) para no romper los cursos de nivel inicial que
  // ya tienen fotos cargadas con ellos.
  if (g.includes('sala')) {
    if (g.includes('3')) {
      if (esJornadaExtendida) return 'SALA-3JE';
      if (t.includes('tarde') || d.includes('b')) return 'SALA-3TT';
      return 'SALA-3TM';
    }
    if (g.includes('4')) {
      if (esJornadaExtendida) return 'SALA-4JE';
      if (d.includes('c')) return 'SALA-4C';
      if (t.includes('tarde') || d.includes('b')) return 'SALA-4TT';
      return 'SALA-4A';
    }
    if (g.includes('5')) {
      if (esJornadaExtendida) return 'SALA-5JE';
      if (d.includes('c')) return 'SALA-5C';
      if (t.includes('tarde') || d.includes('b')) return 'SALA-5B';
      return 'SALA-5A';
    }
  }

  const turnoAbrev = esJornadaExtendida ? 'JE' : (t.includes('tarde') ? 'TT' : 'TM');

  // Abreviatura de la división (ej: "División C" -> "C", "Jornada Extendida" -> "JO"),
  // para diferenciar divisiones dentro del mismo grado y turno.
  const divisionAbrev = d
    .replace(/divisi[oó]n/g, '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]/g, '')
    .toUpperCase()
    .slice(0, 2) || 'X';

  // Primaria: "1° grado" a "7° grado" (o variantes equivalentes que digan "grado").
  const matchGrado = g.match(/(\d+)\s*°?\s*grado/);
  if (matchGrado) {
    return `GRADO${matchGrado[1]}-${divisionAbrev}${turnoAbrev}`;
  }

  // Secundaria: "1° año" a "6° año".
  const matchAnio = g.match(/(\d+)\s*°?\s*a[ñn]o/);
  if (matchAnio) {
    return `ANIO${matchAnio[1]}-${divisionAbrev}${turnoAbrev}`;
  }

  // Cualquier otro texto de grado no contemplado arriba (colegio con nomenclatura propia):
  // se arma un código determinístico a partir del texto real, para que nunca choque por
  // accidente con el curso de otra sala/grado/año. Antes, cualquier grado no reconocido
  // devolvía siempre 'SALA-3TM' de memoria, y por eso terminaba mostrando las mismas
  // fotos que "Sala 3 años, Turno Mañana" sin importar qué grado/turno/división se eligiera.
  const gradoSlug = g
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 12) || 'CURSO';
  return `${gradoSlug}-${divisionAbrev}${turnoAbrev}`;
}

function normalizarTelefonoServidor(tel: string): string {
  return (tel || '').replace(/\D/g, '');
}

/** Enmascara un email para mostrarlo en una respuesta pública sin revelarlo completo (ej: "ju***@gmail.com") */
function enmascararEmailServidor(email: string): string {
  const [usuario, dominio] = String(email || '').split('@');
  if (!usuario || !dominio) return '';
  const visible = usuario.slice(0, Math.min(2, usuario.length));
  return `${visible}${'*'.repeat(Math.max(3, usuario.length - visible.length))}@${dominio}`;
}

// ==============================================================================
// CÓDIGOS DE SECCIÓN: el código real y secreto que necesita una familia para ver
// las fotos de un curso puntual (colegio + grado + turno + división).
//
// IMPORTANTE — por qué existe esto: `determinarCodigoCursoServidor` de arriba es
// una FÓRMULA pública y determinística (mismo texto de grado/turno/división →
// siempre el mismo código). Sirve para ETIQUETAR internamente las fotos en la
// tabla `fotos`, pero nunca debe tratarse como un secreto: cualquiera que mire
// el código fuente del sitio (es un repo público) o simplemente elija las
// opciones del combo de grado/turno/división puede reconstruirlo exacto sin
// haber recibido nunca un código real. Por eso `/api/fotos` YA NO usa esa
// fórmula como control de acceso: exige y valida el código guardado acá, en
// `codigos_seccion`, que es un valor aleatorio generado por el servidor (o
// elegido a mano por el fotógrafo) y jamás derivable a partir del grado, turno
// o división. Esta tabla no tiene ninguna policy de lectura pública en Supabase:
// sólo el servidor (Service Role Key) puede consultarla.
function generarCodigoSecretoSeccion(): string {
  // Alfabeto sin 0/O/1/I para que no se confundan al leerlo o dictarlo por WhatsApp.
  const alfabeto = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let codigo = '';
  for (let i = 0; i < 8; i++) {
    codigo += alfabeto[crypto.randomInt(alfabeto.length)];
  }
  return `${codigo.slice(0, 4)}-${codigo.slice(4, 8)}`;
}

function normalizarCodigoSeccion(codigo: string): string {
  return String(codigo || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

/**
 * Devuelve el código secreto ya asignado a esta sección (colegio+grado+turno+división)
 * si ya existe, o crea uno nuevo si es la primera vez. Todas las familias de la misma
 * sección terminan compartiendo el mismo código (así funciona hoy: un código por curso,
 * para todo el grupo de WhatsApp de esa sección), pero ese código nunca se puede adivinar
 * desde afuera. Si se pasa `candidatoPreferido` (por ejemplo, un código que el fotógrafo
 * escribió a mano, o uno pre-cargado en el padrón), se usa como valor inicial siempre que
 * no esté ya en uso por otra sección distinta.
 */
async function obtenerOCrearCodigoSeccion(
  supabase: any,
  colegioId: string,
  grado: string,
  turno: string,
  division: string,
  candidatoPreferido?: string | null
): Promise<string> {
  const cid = String(colegioId || '').trim();
  const g = String(grado || '').trim();
  const t = String(turno || '').trim();
  const d = String(division || '').trim();

  const { data: existente } = await supabase
    .from('codigos_seccion')
    .select('codigo_secreto')
    .eq('colegio_id', cid)
    .eq('grado', g)
    .eq('turno', t)
    .eq('division', d)
    .maybeSingle();
  if (existente?.codigo_secreto) {
    return existente.codigo_secreto;
  }

  let candidato = String(candidatoPreferido || '').trim().toUpperCase();
  if (candidato) {
    const { data: enUso } = await supabase
      .from('codigos_seccion')
      .select('id')
      .eq('codigo_secreto', candidato)
      .maybeSingle();
    if (enUso) {
      // Ese código ya pertenece a otra sección distinta: se descarta y se genera uno nuevo,
      // en vez de dejar que dos secciones distintas terminen compartiendo el mismo código.
      candidato = '';
    }
  }
  if (!candidato) {
    candidato = generarCodigoSecretoSeccion();
  }

  const { data: creado, error } = await supabase
    .from('codigos_seccion')
    .insert({ colegio_id: cid, grado: g, turno: t, division: d, codigo_secreto: candidato })
    .select('codigo_secreto')
    .single();

  if (error) {
    // Posible carrera (dos aprobaciones casi simultáneas para la misma sección): releer
    // en vez de fallar, ya que probablemente alguien más ya la creó un instante antes.
    const { data: relectura } = await supabase
      .from('codigos_seccion')
      .select('codigo_secreto')
      .eq('colegio_id', cid)
      .eq('grado', g)
      .eq('turno', t)
      .eq('division', d)
      .maybeSingle();
    if (relectura?.codigo_secreto) return relectura.codigo_secreto;
    throw error;
  }

  return creado.codigo_secreto;
}

/** Busca a qué sección (colegio+grado+turno+división) pertenece un código secreto ingresado. */
async function buscarSeccionPorCodigoSecreto(
  supabase: any,
  codigoIngresado: string
): Promise<{ colegioId: string; grado: string; turno: string; division: string } | null> {
  const limpio = normalizarCodigoSeccion(codigoIngresado);
  if (!limpio) return null;

  const { data } = await supabase.from('codigos_seccion').select('colegio_id, grado, turno, division, codigo_secreto');
  if (!Array.isArray(data)) return null;

  const match = data.find((row: any) => normalizarCodigoSeccion(row.codigo_secreto) === limpio);
  if (!match) return null;

  return { colegioId: match.colegio_id, grado: match.grado, turno: match.turno, division: match.division };
}

// ==============================================================================
// 4D. ADMINISTRACIÓN DE CÓDIGOS REALES DE SECCIÓN — 2026-09-09
// ==============================================================================
// La pestaña "Códigos & Difusión WhatsApp" del panel usaba códigos INVENTADOS, guardados
// solo en el navegador (localStorage) y editables a mano — nunca tenían nada que ver con el
// código secreto real de `codigos_seccion` (el que de verdad valida `/api/fotos` para dejar
// entrar a una familia). Es decir que un colegio o una familia podían recibir por WhatsApp un
// código que no funcionaba en el sitio. Estas rutas permiten al panel leer y gestionar los
// códigos REALES para poder armar la difusión con el código que de verdad funciona.

// Lista los códigos reales ya asignados a las secciones de un colegio (para mostrarlos en el panel).
app.get('/api/admin/codigos-seccion', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId } = req.query as Record<string, string | undefined>;
    if (!colegioId) {
      return res.status(400).json({ success: false, error: 'Falta colegioId' });
    }
    const { data, error } = await supabase
      .from('codigos_seccion')
      .select('grado, turno, division, codigo_secreto')
      .eq('colegio_id', colegioId);
    if (error) throw error;
    return res.json({ success: true, codigos: data || [] });
  } catch (err: any) {
    console.error('Error al listar códigos de sección:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al listar los códigos' });
  }
});

// Se asegura de que una sección tenga un código real asignado — si ya tiene uno, lo devuelve
// tal cual (no lo pisa); si no tiene, crea uno nuevo aleatorio. Así el panel puede mostrar
// (o generar por primera vez) el código real de cada curso sin esperar a que una familia lo
// dispare sola al inscribirse.
app.post('/api/admin/codigos-seccion/asegurar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId, grado, turno, division } = req.body || {};
    if (!colegioId || !grado || !turno) {
      return res.status(400).json({ success: false, error: 'Faltan colegioId, grado o turno' });
    }
    const codigo = await obtenerOCrearCodigoSeccion(supabase, colegioId, grado, turno, division || '');
    return res.json({ success: true, codigo });
  } catch (err: any) {
    console.error('Error al asegurar código de sección:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al asegurar el código' });
  }
});

// Genera un código nuevo (aleatorio) para una sección, reemplazando el anterior si existía —
// el código viejo deja de funcionar. Igual que `obtenerOCrearCodigoSeccion` pero forzando
// siempre un valor nuevo, con reintentos por si el azar generara uno ya usado (prácticamente
// imposible con el alfabeto de 8 caracteres, pero más vale prevenir).
app.post('/api/admin/codigos-seccion/regenerar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId, grado, turno, division } = req.body || {};
    if (!colegioId || !grado || !turno) {
      return res.status(400).json({ success: false, error: 'Faltan colegioId, grado o turno' });
    }
    const cid = String(colegioId).trim();
    const g = String(grado).trim();
    const t = String(turno).trim();
    const d = String(division || '').trim();

    let nuevoCodigo = '';
    for (let intento = 0; intento < 5; intento++) {
      const candidato = generarCodigoSecretoSeccion();
      const { data: enUso } = await supabase
        .from('codigos_seccion')
        .select('id')
        .eq('codigo_secreto', candidato)
        .maybeSingle();
      if (!enUso) {
        nuevoCodigo = candidato;
        break;
      }
    }
    if (!nuevoCodigo) {
      return res.status(500).json({ success: false, error: 'No se pudo generar un código único, probá de nuevo.' });
    }

    const { data: existente } = await supabase
      .from('codigos_seccion')
      .select('id')
      .eq('colegio_id', cid)
      .eq('grado', g)
      .eq('turno', t)
      .eq('division', d)
      .maybeSingle();

    if (existente?.id) {
      const { error } = await supabase.from('codigos_seccion').update({ codigo_secreto: nuevoCodigo }).eq('id', existente.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('codigos_seccion')
        .insert({ colegio_id: cid, grado: g, turno: t, division: d, codigo_secreto: nuevoCodigo });
      if (error) throw error;
    }

    return res.json({ success: true, codigo: nuevoCodigo });
  } catch (err: any) {
    console.error('Error al regenerar código de sección:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al regenerar el código' });
  }
});

// Fija a mano el código real de una sección (por ejemplo, uno más fácil de leer para una
// escuela puntual). Rechaza el pedido si ese código ya pertenece a otra sección distinta,
// para nunca dejar dos secciones compartiendo sin querer el mismo código de acceso.
app.post('/api/admin/codigos-seccion/actualizar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { colegioId, grado, turno, division, nuevoCodigo } = req.body || {};
    if (!colegioId || !grado || !turno || !nuevoCodigo) {
      return res.status(400).json({ success: false, error: 'Faltan colegioId, grado, turno o el nuevo código' });
    }
    const cid = String(colegioId).trim();
    const g = String(grado).trim();
    const t = String(turno).trim();
    const d = String(division || '').trim();
    const codigoNormalizado = normalizarCodigoSeccion(nuevoCodigo);
    if (codigoNormalizado.length < 4) {
      return res.status(400).json({ success: false, error: 'El código tiene que tener al menos 4 caracteres.' });
    }

    const { data: existente } = await supabase
      .from('codigos_seccion')
      .select('id')
      .eq('colegio_id', cid)
      .eq('grado', g)
      .eq('turno', t)
      .eq('division', d)
      .maybeSingle();

    const { data: enUsoPorOtra } = await supabase
      .from('codigos_seccion')
      .select('id')
      .eq('codigo_secreto', codigoNormalizado)
      .maybeSingle();
    if (enUsoPorOtra?.id && enUsoPorOtra.id !== existente?.id) {
      return res.status(409).json({ success: false, error: 'Ese código ya lo está usando otra sección. Elegí uno distinto.' });
    }

    if (existente?.id) {
      const { error } = await supabase.from('codigos_seccion').update({ codigo_secreto: codigoNormalizado }).eq('id', existente.id);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from('codigos_seccion')
        .insert({ colegio_id: cid, grado: g, turno: t, division: d, codigo_secreto: codigoNormalizado });
      if (error) throw error;
    }

    return res.json({ success: true, codigo: codigoNormalizado });
  } catch (err: any) {
    console.error('Error al actualizar código de sección:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al actualizar el código' });
  }
});

// Inscripción pública: valida contra el padrón autorizado del colegio y asigna código al instante si coincide.
// Todo el acceso a `padres_autorizados` e `inscripciones` pasa exclusivamente por acá, del lado del servidor
// (con la Service Role Key) — el navegador nunca consulta esas tablas directamente.
app.post('/api/inscripciones/validar', async (req: Request, res: Response) => {
  try {
    const {
      colegioId,
      colegioNombre,
      padreNombre,
      telefonoWhatsApp,
      email,
      alumnoNombre,
      alumnoApellido,
      alumnoDni,
      grado,
      division,
      turno,
      solicitaFotoHermanos,
      hermanos
    } = req.body || {};

    if (!padreNombre || !alumnoNombre || !colegioId || !telefonoWhatsApp || !email) {
      return res.status(400).json({ success: false, error: 'Faltan datos obligatorios para la inscripción' });
    }
    const alumnoDniLimpio = String(alumnoDni || '').replace(/\D/g, '');
    if (alumnoDniLimpio.length < 6 || alumnoDniLimpio.length > 9) {
      return res.status(400).json({ success: false, error: 'El DNI del alumno/a no es válido' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const telDigits = normalizarTelefonoServidor(telefonoWhatsApp);
    const telUltimos = telDigits.length >= 8 ? telDigits.slice(-8) : telDigits;
    const cleanEmail = String(email || '').trim().toLowerCase();

    let matchPadre: any = null;
    try {
      const { data: candidatos, error: errAuth } = await supabase
        .from('padres_autorizados')
        .select('*')
        .eq('colegio_id', colegioId)
        .eq('usado', false);

      if (!errAuth && Array.isArray(candidatos)) {
        matchPadre = candidatos.find((p: any) => {
          if (cleanEmail && p.email && String(p.email).trim().toLowerCase() === cleanEmail) return true;
          if (telDigits) {
            const pTel = normalizarTelefonoServidor(p.telefono || '');
            if (pTel && (pTel === telDigits || (telUltimos.length >= 8 && pTel.endsWith(telUltimos)))) return true;
          }
          return false;
        }) || null;
      }
    } catch (e) {
      console.warn('Advertencia al consultar padres_autorizados:', e);
    }

    // Buscar si esta misma familia (mismo colegio + mismo WhatsApp o email) ya tiene una
    // inscripción cargada, para actualizarla en vez de crear un duplicado (por ejemplo, cuando
    // la familia usa "Modificar datos de inscripción" y vuelve a enviar el formulario).
    let inscripcionExistente: any = null;
    try {
      const { data: existentes, error: errExistentes } = await supabase
        .from('inscripciones')
        .select('*')
        .eq('colegio_id', colegioId)
        .neq('estado', 'rechazado');

      if (!errExistentes && Array.isArray(existentes)) {
        inscripcionExistente = existentes.find((i: any) => {
          if (cleanEmail && i.email && String(i.email).trim().toLowerCase() === cleanEmail) return true;
          if (telDigits) {
            const iTel = normalizarTelefonoServidor(i.telefono_whatsapp || '');
            if (iTel && (iTel === telDigits || (telUltimos.length >= 8 && iTel.endsWith(telUltimos)))) return true;
          }
          return false;
        }) || null;
      }
    } catch (e) {
      console.warn('Advertencia al buscar inscripción existente:', e);
    }

    const now = new Date();
    const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    // Si la familia ya estaba aceptada (con código asignado), mantenemos su estado y código:
    // sólo actualizamos sus datos de contacto/curso, nunca le hacemos perder el acceso ya otorgado.
    let estado: 'aceptado' | 'pendiente' = inscripcionExistente?.estado === 'aceptado' ? 'aceptado' : 'pendiente';
    let codigoAcceso: string | null = inscripcionExistente?.estado === 'aceptado'
      ? (inscripcionExistente.codigo_asignado || null)
      : null;

    // Curso que efectivamente se aprueba: si hay una fila autorizada en `padres_autorizados`
    // que ya trae su propio grado/turno/división cargados (por ejemplo, subidos junto con el
    // padrón oficial del colegio), ese es el curso que manda — nunca lo que haya tipeado quien
    // completa el formulario. Auditoría 2026-09-09 (revisión a fondo): antes se usaba siempre
    // grado/turno/división del body de la petición pública para generar el código real de
    // sección, incluso cuando la aprobación automática venía por `matchPadre` — es decir que
    // alguien con acceso al link de padrón de una familia (colegio_id + código) podía
    // autoinscribirse con su propio contacto y pedir el código real de CUALQUIER grado/turno/
    // división que quisiera, no sólo el que le corresponde, y así ver las fotos de cursos
    // ajenos. Si la fila autorizada no tiene su propio grado/turno/división cargados (padrones
    // viejos, sin esos datos), se sigue aceptando lo que mande el formulario como antes.
    const gradoAprobado = (matchPadre?.grado && String(matchPadre.grado).trim()) || grado;
    const turnoAprobado = (matchPadre?.turno && String(matchPadre.turno).trim()) || turno;
    const divisionAprobada = (matchPadre?.division && String(matchPadre.division).trim()) || division;

    // Auditoría 2026-09-09 (revisión a fondo, hallazgo reportado por Pablo): hasta acá, con sólo
    // escribir el número de WhatsApp (o el email) de CUALQUIER fila del padrón oficial en este
    // formulario público — un dato que de ninguna manera es secreto, lo puede tener cualquier
    // compañero de curso, un grupo de WhatsApp del colegio, etc. — se aprobaba la inscripción al
    // instante y el código de acceso real se devolvía directo en la respuesta de esta misma
    // petición, visible para quien la hizo, sin importar si esa persona era realmente el padre o
    // no. Es decir: el número de teléfono de un padre funcionaba como si fuera su contraseña.
    // Ahora, para aprobar automáticamente, además de encontrar la coincidencia en el padrón hace
    // falta un email cargado en esa fila (el que subió el colegio, nunca el que haya tipeado
    // quien completa el formulario) — el código se manda SOLO por correo a esa dirección, y
    // nunca viaja en la respuesta de esta petición. Así, aunque alguien conozca o adivine el
    // teléfono de un padre, no puede ver el código: sólo quien tiene acceso a esa casilla de
    // correo puede. Si la fila del padrón no tiene email cargado, no se puede entregar el código
    // de forma segura por acá — la inscripción queda "pendiente" para que el fotógrafo la revise
    // y envíe el código a mano desde el panel, en vez de exponerlo.
    let emailEnviado = false;
    let emailDestinoNotificacion: string | null = null;
    if (estado !== 'aceptado' && matchPadre) {
      const emailOficialPadron = matchPadre.email ? String(matchPadre.email).trim().toLowerCase() : '';
      if (emailOficialPadron && emailOficialPadron.includes('@')) {
        estado = 'aceptado';
        // El código real de la sección es el que la familia va a usar para ver las fotos —
        // nunca la fórmula pública determinarCodigoCursoServidor (ver codigos_seccion arriba).
        codigoAcceso = await obtenerOCrearCodigoSeccion(supabase, colegioId, gradoAprobado, turnoAprobado, divisionAprobada, matchPadre.codigo_asignado);
        emailDestinoNotificacion = emailOficialPadron;
        try {
          const resultadoEnvio = await enviarCorreoCodigoAcceso({
            to: emailOficialPadron,
            padreNombre: (matchPadre.nombre && String(matchPadre.nombre).trim()) || String(padreNombre).trim(),
            colegioNombre: String(colegioNombre || 'Colegio').trim(),
            codigo: codigoAcceso,
            alumnos: [{
              nombre: String(alumnoNombre).trim(),
              apellido: String(alumnoApellido || '').trim(),
              grado: gradoAprobado,
              division: divisionAprobada,
              turno: turnoAprobado,
            }],
            solicitaFotoHermanos: Boolean(solicitaFotoHermanos || (hermanos && hermanos.length > 0)),
          });
          emailEnviado = Boolean(resultadoEnvio.success);
        } catch (e) {
          console.warn('No se pudo enviar el email de código de acceso automático:', e);
        }
      }
      // Si la fila del padrón no tiene email cargado, la inscripción queda "pendiente" (no se
      // aprueba automáticamente) — ver comentario de auditoría arriba.
    } else if (estado === 'aceptado' && inscripcionExistente?.email && codigoAcceso) {
      // Reenvío: la familia ya estaba aprobada y volvió a completar el formulario (por ejemplo,
      // porque no encontró el correo original). Se reenvía SIEMPRE al email que ya estaba
      // guardado en la inscripción (el que se validó en su momento contra el padrón) — nunca al
      // que haya tipeado ahora, por la misma razón de seguridad de arriba.
      try {
        const resultadoReenvio = await enviarCorreoCodigoAcceso({
          to: String(inscripcionExistente.email).trim().toLowerCase(),
          padreNombre: String(inscripcionExistente.padre_nombre || padreNombre).trim(),
          colegioNombre: String(colegioNombre || 'Colegio').trim(),
          codigo: codigoAcceso,
          alumnos: [{
            nombre: String(alumnoNombre).trim(),
            apellido: String(alumnoApellido || '').trim(),
            grado: gradoAprobado,
            division: divisionAprobada,
            turno: turnoAprobado,
          }],
          solicitaFotoHermanos: Boolean(solicitaFotoHermanos || (hermanos && hermanos.length > 0)),
        });
        emailEnviado = Boolean(resultadoReenvio.success);
        if (emailEnviado) emailDestinoNotificacion = String(inscripcionExistente.email).trim().toLowerCase();
      } catch (e) {
        console.warn('No se pudo reenviar el email de código de acceso:', e);
      }
    }

    // El contacto que queda guardado para una inscripción APROBADA es siempre uno ya validado —
    // el del padrón oficial (matchPadre) si se acaba de aprobar recién, o el que ya estaba
    // guardado de una aprobación anterior — NUNCA lo que haya tipeado quien completó el
    // formulario esta vez. Es "pegajoso" a propósito: si no, alguien podría volver a mandar el
    // mismo formulario con el teléfono real de una familia YA aprobada (así matchea contra su
    // inscripción existente) pero con SU PROPIO email, y ese email reemplazaría al real —
    // dejando el reenvío manual futuro desde el panel apuntando a la casilla del atacante. Para
    // una inscripción que sigue "pendiente" sí se guarda el contacto tal como lo escribió la
    // persona, porque ahí no se aprueba ni se entrega ningún código automáticamente — el
    // fotógrafo revisa a mano antes de aprobar.
    const emailGuardado = estado === 'aceptado'
      ? (matchPadre?.email ? String(matchPadre.email).trim().toLowerCase() : (inscripcionExistente?.email || cleanEmail))
      : cleanEmail;
    const telefonoGuardado = estado === 'aceptado'
      ? (matchPadre?.telefono ? String(matchPadre.telefono).trim() : (inscripcionExistente?.telefono_whatsapp || String(telefonoWhatsApp).trim()))
      : String(telefonoWhatsApp).trim();

    const inscripcionRow: Record<string, any> = {
      padre_nombre: String(padreNombre).trim(),
      telefono_whatsapp: telefonoGuardado,
      email: emailGuardado,
      alumno_nombre: String(alumnoNombre).trim(),
      alumno_apellido: String(alumnoApellido || '').trim(),
      alumno_dni: alumnoDniLimpio,
      turno: String((estado === 'aceptado' ? turnoAprobado : turno) || 'Mañana').trim(),
      grado: String((estado === 'aceptado' ? gradoAprobado : grado) || 'Sala 3 años').trim(),
      division: String((estado === 'aceptado' ? divisionAprobada : division) || 'A').trim(),
      colegio_id: colegioId,
      colegio_nombre: String(colegioNombre || 'Colegio').trim(),
      estado,
      codigo_asignado: codigoAcceso,
      codigo_familiar: codigoAcceso,
      solicita_foto_hermanos: Boolean(solicitaFotoHermanos || (hermanos && hermanos.length > 0)),
      hermanos: hermanos || [],
      fecha_inscripcion: inscripcionExistente?.fecha_inscripcion || fechaStr,
      fecha_aprobacion: estado === 'aceptado' ? (inscripcionExistente?.fecha_aprobacion || fechaStr) : null,
      notificacion_whatsapp_enviada: inscripcionExistente ? Boolean(inscripcionExistente.notificacion_whatsapp_enviada) : false,
      notificacion_email_enviada: emailEnviado || (inscripcionExistente ? Boolean(inscripcionExistente.notificacion_email_enviada) : false),
    };

    let resultadoFila: any = null;
    let errGuardar: any = null;

    if (inscripcionExistente?.id) {
      const { data: actualizada, error } = await supabase
        .from('inscripciones')
        .update(inscripcionRow)
        .eq('id', inscripcionExistente.id)
        .select()
        .single();
      resultadoFila = actualizada;
      errGuardar = error;
    } else {
      const { data: creada, error } = await supabase
        .from('inscripciones')
        .insert(inscripcionRow)
        .select()
        .single();
      resultadoFila = creada;
      errGuardar = error;
    }

    if (errGuardar) throw errGuardar;

    if (matchPadre && matchPadre.id && estado === 'aceptado') {
      await supabase
        .from('padres_autorizados')
        .update({ usado: true, updated_at: new Date().toISOString() })
        .eq('id', matchPadre.id);
    }

    // Auditoría 2026-09-09 (revisión a fondo): el código de acceso real YA NO viaja en esta
    // respuesta — ver comentario de auditoría más arriba. El frontend debe indicarle a la
    // familia que revise su correo (o que espere la revisión manual del fotógrafo), nunca
    // mostrar un código en pantalla en este flujo automático. Ojo: no alcanza con sacar
    // `codigoAcceso` del nivel superior de la respuesta — `resultadoFila` es la fila cruda de
    // Supabase e incluye igual las columnas `codigo_asignado`/`codigo_familiar`, así que hay
    // que sacarlas explícitamente antes de devolverla, si no el mismo código se sigue filtrando
    // por esta otra puerta.
    const { codigo_asignado: _codigoAsignadoOculto, codigo_familiar: _codigoFamiliarOculto, ...inscripcionSinCodigo } = resultadoFila || {};
    return res.json({
      success: true,
      estado,
      emailEnviado,
      emailDestino: emailEnviado ? emailDestinoNotificacion : null,
      inscripcion: inscripcionSinCodigo,
    });
  } catch (err: any) {
    console.error('Error al validar inscripción:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error interno al procesar inscripción' });
  }
});

// Recuperar mi inscripción por código, teléfono o email (público). Devuelve como máximo UN
// registro propio — nunca la tabla completa — y usa siempre comparaciones exactas/parametrizadas
// (nada de interpolar el texto del usuario en un filtro .or() crudo, que sería explotable).
//
// Auditoría 2026-09-09 (revisión a fondo, hallazgo reportado por Pablo): "cualquier persona,
// poniendo el número de teléfono de alguno de los empadronados, puede acceder al código". Esta
// era exactamente la puerta: esta ruta (usada tanto por la pestaña "Ya me inscribí" como por el
// cuadro de "ingresar código" para ver las fotos) buscaba por teléfono O email y, si encontraba
// una familia YA aprobada, devolvía la fila completa —con `codigo_asignado` incluido— a quien
// sea que haya escrito ese teléfono, sin ninguna prueba de que esa persona fuera realmente el
// padre/madre. El teléfono de un padre empadronado no es un secreto: lo puede tener cualquier
// compañero de curso. Ahora: si lo que se escribió ES el código real (coincide exacto contra
// `codigo_asignado`/`codigo_familiar`), quien lo escribió ya demostró tenerlo — se devuelve la
// familia completa. Si lo que se escribió es un teléfono o un email y esa familia todavía está
// "pendiente" (no tiene código asignado), no hay ningún secreto que proteger todavía, así que se
// puede informar el estado igual. Pero si esa familia YA tiene un código asignado, esta ruta
// nunca lo devuelve por acá: como mucho reenvía el código al correo de confianza YA guardado
// (nunca a uno nuevo) y responde sin datos de la familia.
app.post('/api/inscripciones/buscar', limitarFrecuencia('inscripciones-buscar', 15, 10 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { query } = req.body || {};
    const q = String(query || '').trim();
    if (q.length < 3) {
      return res.status(400).json({ success: false, error: 'Ingresá tu código, teléfono o email.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const qUpper = q.toUpperCase();
    const qEmail = q.toLowerCase();
    const qTel = normalizarTelefonoServidor(q);

    // Paso 1: ¿lo que se escribió ES el código real? Coincidencia exacta = prueba de posesión.
    let encontrada: any = null;
    const tryEqCodigo = async (column: string, value: string) => {
      if (encontrada || !value) return;
      const { data } = await supabase.from('inscripciones').select('*').eq(column, value).limit(1);
      if (data && data.length > 0) encontrada = data[0];
    };
    await tryEqCodigo('codigo_asignado', qUpper);
    await tryEqCodigo('codigo_familiar', qUpper);

    if (encontrada) {
      return res.json({ success: true, inscripcion: encontrada });
    }

    // Paso 2: no era el código. Buscar por contacto (teléfono o email) — ver auditoría arriba,
    // el resultado de esta búsqueda NUNCA puede filtrar un código ya asignado.
    let porContacto: any = null;
    if (qEmail.includes('@')) {
      const { data } = await supabase.from('inscripciones').select('*').eq('email', qEmail).limit(1);
      if (data && data.length > 0) porContacto = data[0];
    }
    // Auditoría 2026-09-09: antes esto buscaba con ilike '%qTel%' aceptando desde 6 dígitos
    // sueltos en cualquier parte del teléfono guardado — eso es fuerza-bruteable (basta con
    // probar secuencias de 6 dígitos) y podía traer coincidencias parciales casuales de OTRA
    // familia. Ahora exige el teléfono completo (mínimo 8 dígitos) y sólo lo compara, ya
    // normalizado, contra el final exacto del teléfono guardado — no contra cualquier subcadena.
    if (!porContacto && qTel.length >= 8) {
      const sufijo = qTel.slice(-8);
      const { data } = await supabase.from('inscripciones').select('*').ilike('telefono_whatsapp', `%${sufijo}`).limit(5);
      if (data && data.length > 0) {
        porContacto = data.find((i: any) => normalizarTelefonoServidor(i.telefono_whatsapp || '').endsWith(qTel.length >= 10 ? qTel : sufijo)) || null;
      }
    }

    if (!porContacto) {
      return res.json({ success: false });
    }

    if (porContacto.estado !== 'aceptado' || !porContacto.codigo_asignado) {
      // Todavía no tiene código asignado: no hay nada que proteger, se informa el estado tal cual.
      return res.json({ success: true, inscripcion: porContacto });
    }

    // Ya tiene código asignado: por acá nunca se devuelve. Se reenvía al correo de confianza que
    // ya estaba guardado (el validado en su momento contra el padrón, nunca uno nuevo) y se
    // responde sin ningún dato de la familia — sólo si se pudo reenviar y a qué correo (parcial).
    let emailReenviado = false;
    const emailConfianza = porContacto.email ? String(porContacto.email).trim().toLowerCase() : '';
    if (emailConfianza && emailConfianza.includes('@')) {
      try {
        const resultadoReenvio = await enviarCorreoCodigoAcceso({
          to: emailConfianza,
          padreNombre: String(porContacto.padre_nombre || '').trim() || 'Familia',
          colegioNombre: String(porContacto.colegio_nombre || 'Colegio').trim(),
          codigo: porContacto.codigo_asignado,
          alumnos: [{
            nombre: String(porContacto.alumno_nombre || '').trim(),
            apellido: String(porContacto.alumno_apellido || '').trim(),
            grado: porContacto.grado,
            division: porContacto.division,
            turno: porContacto.turno,
          }],
          solicitaFotoHermanos: Boolean(porContacto.solicita_foto_hermanos),
        });
        emailReenviado = Boolean(resultadoReenvio.success);
      } catch (e) {
        console.warn('No se pudo reenviar el código de acceso desde /api/inscripciones/buscar:', e);
      }
    }

    return res.json({
      success: false,
      yaRegistrado: true,
      emailReenviado,
      emailDestino: emailReenviado ? enmascararEmailServidor(emailConfianza) : null,
    });
  } catch (err: any) {
    console.error('Error al buscar inscripción:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al buscar la inscripción' });
  }
});

// --- Rutas de administración de inscripciones y padrón (protegidas con requireAdminAuth) ---

app.get('/api/admin/inscripciones', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { data, error } = await supabase.from('inscripciones').select('*').order('created_at', { ascending: false });
    if (error) throw error;
    return res.json({ success: true, inscripciones: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener inscripciones' });
  }
});

app.post('/api/admin/inscripciones/:id/aprobar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { codigo } = req.body || {};
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const { data: existente, error: errGet } = await supabase.from('inscripciones').select('*').eq('id', id).single();
    if (errGet || !existente) {
      return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });
    }

    // El código final SIEMPRE es el código real y secreto de esa sección (colegio+grado+turno+
    // división) guardado en `codigos_seccion` — nunca la fórmula pública. Si la sección ya
    // tenía un código asignado (por ejemplo, otra familia del mismo curso ya fue aprobada antes),
    // se reutiliza ese mismo código para todos; si es la primera vez, se usa lo que haya escrito
    // el fotógrafo (o el código previo de esta inscripción) como sugerencia, y si no, se genera
    // uno nuevo al azar.
    const codigoFinal = await obtenerOCrearCodigoSeccion(
      supabase,
      existente.colegio_id,
      existente.grado,
      existente.turno,
      existente.division,
      codigo || existente.codigo_asignado
    );

    const now = new Date();
    const fechaStr = `${String(now.getDate()).padStart(2, '0')}/${String(now.getMonth() + 1).padStart(2, '0')}/${now.getFullYear()} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;

    const { data, error } = await supabase
      .from('inscripciones')
      .update({
        estado: 'aceptado',
        codigo_asignado: codigoFinal,
        codigo_familiar: codigoFinal,
        fecha_aprobacion: fechaStr,
        updated_at: new Date().toISOString(),
      })
      .eq('id', id)
      .select()
      .single();

    if (error) throw error;

    return res.json({ success: true, inscripcion: data, codigo: codigoFinal });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al aprobar inscripción' });
  }
});

// Envía por email (de verdad, vía Resend) el Código de Acceso a una familia ya aprobada.
// Se llama justo después de aprobar, o para reintentar el envío si falló la primera vez.
app.post('/api/admin/inscripciones/:id/enviar-email', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const { data: existente, error: errGet } = await supabase.from('inscripciones').select('*').eq('id', id).single();
    if (errGet || !existente) {
      return res.status(404).json({ success: false, error: 'Inscripción no encontrada' });
    }
    if (!existente.codigo_asignado) {
      return res.status(400).json({ success: false, error: 'Esta inscripción todavía no tiene un código asignado. Aprobala primero.' });
    }
    if (!existente.email) {
      return res.status(400).json({ success: false, error: 'Esta familia no cargó un email.' });
    }

    const alumnos = [
      { nombre: existente.alumno_nombre, apellido: existente.alumno_apellido || '', grado: existente.grado, division: existente.division, turno: existente.turno },
      ...(Array.isArray(existente.hermanos) ? existente.hermanos : []).map((h: any) => ({
        nombre: h.alumnoNombre, apellido: h.alumnoApellido || '', grado: h.grado, division: h.division, turno: h.turno,
      })),
    ];

    const resultado = await enviarCorreoCodigoAcceso({
      to: existente.email,
      padreNombre: existente.padre_nombre,
      colegioNombre: existente.colegio_nombre,
      codigo: existente.codigo_asignado,
      alumnos,
      solicitaFotoHermanos: Boolean(existente.solicita_foto_hermanos),
    });

    if (!resultado.success) {
      return res.status(502).json({ success: false, error: resultado.error || 'No se pudo enviar el email' });
    }

    await supabase
      .from('inscripciones')
      .update({ notificacion_email_enviada: true, updated_at: new Date().toISOString() })
      .eq('id', id);

    return res.json({ success: true, messageId: resultado.messageId });
  } catch (err: any) {
    console.error('Error al enviar email de código de acceso:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al enviar el email' });
  }
});

app.post('/api/admin/inscripciones/:id/rechazar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { data, error } = await supabase
      .from('inscripciones')
      .update({ estado: 'rechazado', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return res.json({ success: true, inscripcion: data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al rechazar inscripción' });
  }
});

app.get('/api/admin/padron', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const colegioId = req.query.colegioId as string | undefined;
    let builder = supabase.from('padres_autorizados').select('*').order('created_at', { ascending: false });
    if (colegioId) {
      builder = builder.eq('colegio_id', colegioId);
    }
    const { data, error } = await builder;
    if (error) throw error;
    return res.json({ success: true, padron: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener el padrón' });
  }
});

// Importar filas del padrón (ya parseadas desde el Excel/CSV en el navegador con la librería xlsx)
app.post('/api/admin/padron/importar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { filas, colegioId } = req.body || {};
    if (!Array.isArray(filas) || filas.length === 0) {
      return res.status(400).json({ success: false, error: 'No se recibieron filas para importar' });
    }
    if (filas.length > 2000) {
      return res.status(400).json({ success: false, error: 'Demasiadas filas en un solo lote (máximo 2000)' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const filasNormalizadas = filas
      .map((f: any) => ({
        colegio_id: f.colegioId || f.colegio_id || colegioId,
        nombre: String(f.nombre || '').trim(),
        telefono: f.telefono ? String(f.telefono).trim() : null,
        email: f.email ? String(f.email).trim().toLowerCase() : null,
        alumno_nombre: f.alumnoNombre || f.alumno_nombre || null,
        grado: f.grado || null,
        division: f.division || null,
        turno: f.turno || null,
        codigo_asignado: String(f.codigoAsignado || f.codigo_asignado || '').trim().toUpperCase() || null,
      }))
      .filter((f: any) => f.colegio_id && f.nombre && (f.telefono || f.email));

    if (filasNormalizadas.length === 0) {
      return res.status(400).json({ success: false, error: 'Ninguna fila tiene los datos mínimos (colegio, nombre y teléfono o email)' });
    }

    const { data, error } = await supabase.from('padres_autorizados').insert(filasNormalizadas).select();
    if (error) throw error;

    return res.json({
      success: true,
      importados: data?.length || 0,
      descartados: filas.length - filasNormalizadas.length,
    });
  } catch (err: any) {
    console.error('Error al importar padrón:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al importar el padrón' });
  }
});

app.delete('/api/admin/padron/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { error } = await supabase.from('padres_autorizados').delete().eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar del padrón' });
  }
});

// ==============================================================================
// 4C. PADRÓN — AUTOCARGA POR LA INSTITUCIÓN (sin login, protegido por token secreto)
// Usada por la página estática /padron.html: el colegio recibe un link con su propio
// código secreto (generado en 4A) y pega ahí la lista de familias autorizadas, que se
// guarda directo en `padres_autorizados`. Nunca se expone el token en /api/colegios.
// ==============================================================================

async function validarTokenPadronInstitucion(colegioId: string, codigo: string) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { ok: false as const, status: 500, error: 'Supabase no configurado en el servidor' };
  }
  if (!colegioId || !codigo || !String(codigo).trim()) {
    return { ok: false as const, status: 400, error: 'Falta el código de acceso al padrón' };
  }
  const { data: colegio, error } = await supabase
    .from('colegios')
    .select('id, nombre, codigo_padron')
    .eq('id', colegioId)
    .single();

  if (error || !colegio || !colegio.codigo_padron) {
    return { ok: false as const, status: 404, error: 'Link no válido' };
  }
  if (String(codigo).trim().toUpperCase() !== String(colegio.codigo_padron).trim().toUpperCase()) {
    return { ok: false as const, status: 403, error: 'El código de este link no es correcto' };
  }
  return { ok: true as const, supabase, colegio };
}

// Resuelve el colegio únicamente por su código de padrón (10 caracteres, ya es único de por
// sí), sin necesitar el UUID del colegio en la URL. Es lo que permite el link corto
// /padron.html?c=CODIGO en vez de .../padron.html?colegio=<uuid>&codigo=<codigo>.
async function resolverColegioPorCodigoPadron(codigo: string) {
  const supabase = getServerSupabase();
  if (!supabase) {
    return { ok: false as const, status: 500, error: 'Supabase no configurado en el servidor' };
  }
  const codigoLimpio = String(codigo || '').trim().toUpperCase();
  if (!codigoLimpio) {
    return { ok: false as const, status: 400, error: 'Falta el código del link' };
  }
  const { data: colegio, error } = await supabase
    .from('colegios')
    .select('id, nombre, codigo_padron')
    .eq('codigo_padron', codigoLimpio)
    .maybeSingle();

  if (error || !colegio) {
    return { ok: false as const, status: 404, error: 'Link no válido' };
  }
  return { ok: true as const, supabase, colegio };
}

// Normaliza las filas recibidas, descarta inválidas/duplicadas del mismo envío, filtra las
// que ya estaban cargadas para ese colegio y guarda el resto en padres_autorizados. Usada
// tanto por la ruta vieja (colegio + código en la URL) como por la ruta corta (solo código).
async function procesarCargaPadron(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  colegioId: string,
  filas: any,
  res: Response
) {
  if (!Array.isArray(filas) || filas.length === 0) {
    return res.status(400).json({ success: false, error: 'No se recibieron filas para cargar' });
  }
  if (filas.length > 2000) {
    return res.status(400).json({ success: false, error: 'Demasiadas filas en un solo envío (máximo 2000)' });
  }

  const vistas = new Set<string>();
  const filasNormalizadas = filas
    .map((f: any) => {
      const nombre = String(f.nombre || '').trim();
      const email = f.email ? String(f.email).trim().toLowerCase() : '';
      const telefono = f.telefono ? normalizarTelefonoServidor(String(f.telefono)) : '';
      return { nombre, email: email || null, telefono: telefono || null };
    })
    .filter((f: any) => f.nombre && (f.telefono || f.email))
    .filter((f: any) => {
      // Descarta duplicados dentro del mismo envío
      const clave = f.email || f.telefono;
      if (vistas.has(clave)) return false;
      vistas.add(clave);
      return true;
    });

  const invalidas = filas.length - filasNormalizadas.length;

  if (filasNormalizadas.length === 0) {
    return res.status(400).json({ success: false, error: 'Ninguna fila tiene los datos mínimos (nombre y al menos email o teléfono)' });
  }

  // Evitar duplicados contra lo que ya está cargado para este colegio
  const { data: existentes } = await supabase
    .from('padres_autorizados')
    .select('email, telefono')
    .eq('colegio_id', colegioId);

  const emailsExistentes = new Set((existentes || []).map((r: any) => (r.email || '').toLowerCase()).filter(Boolean));
  const telefonosExistentes = new Set((existentes || []).map((r: any) => normalizarTelefonoServidor(r.telefono || '')).filter(Boolean));

  const filasNuevas = filasNormalizadas.filter((f: any) => {
    if (f.email && emailsExistentes.has(f.email)) return false;
    if (f.telefono && telefonosExistentes.has(f.telefono)) return false;
    return true;
  });
  const duplicadas = filasNormalizadas.length - filasNuevas.length;

  if (filasNuevas.length === 0) {
    return res.json({ success: true, agregados: 0, duplicados: duplicadas, invalidas });
  }

  const { data, error } = await supabase
    .from('padres_autorizados')
    .insert(filasNuevas.map((f: any) => ({ colegio_id: colegioId, nombre: f.nombre, email: f.email, telefono: f.telefono })))
    .select();
  if (error) throw error;

  return res.json({ success: true, agregados: data?.length || 0, duplicados: duplicadas, invalidas });
}

// Valida el link (colegioId + código) y devuelve el nombre del colegio para mostrar en la página
app.get('/api/padron/institucion/:colegioId', async (req: Request, res: Response) => {
  const { colegioId } = req.params;
  const codigo = String(req.query.codigo || '');
  const resultado = await validarTokenPadronInstitucion(colegioId, codigo);
  if (!resultado.ok) {
    return res.status(resultado.status).json({ success: false, error: resultado.error });
  }
  return res.json({ success: true, colegioNombre: resultado.colegio.nombre });
});

// Recibe los datos que cada padre/madre/tutor/a carga desde padron.html (una fila,
// la suya propia) y los guarda en padres_autorizados, evitando duplicados (por
// teléfono o email) contra lo ya cargado para ese colegio. Acepta también varias
// filas de una vez por si en el futuro se vuelve a usar una carga masiva.
app.post('/api/padron/institucion/:colegioId', async (req: Request, res: Response) => {
  try {
    const { colegioId } = req.params;
    const { codigo, filas } = req.body || {};

    const resultado = await validarTokenPadronInstitucion(colegioId, codigo);
    if (!resultado.ok) {
      return res.status(resultado.status).json({ success: false, error: resultado.error });
    }
    return await procesarCargaPadron(resultado.supabase, resultado.colegio.id, filas, res);
  } catch (err: any) {
    console.error('Error al cargar padrón desde la institución:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al guardar los datos' });
  }
});

// Versión de link corto: el mismo flujo de arriba, pero identificando el colegio solo por
// su código de padrón (sin el UUID en la URL) — así el link que se comparte con cada familia
// es bastante más corto: /padron.html?c=CODIGO en vez de .../padron.html?colegio=<uuid>&codigo=<codigo>.
app.get('/api/padron/link/:codigo', async (req: Request, res: Response) => {
  const { codigo } = req.params;
  const resultado = await resolverColegioPorCodigoPadron(codigo);
  if (!resultado.ok) {
    return res.status(resultado.status).json({ success: false, error: resultado.error });
  }
  return res.json({ success: true, colegioNombre: resultado.colegio.nombre });
});

app.post('/api/padron/link/:codigo', async (req: Request, res: Response) => {
  try {
    const { codigo } = req.params;
    const { filas } = req.body || {};
    const resultado = await resolverColegioPorCodigoPadron(codigo);
    if (!resultado.ok) {
      return res.status(resultado.status).json({ success: false, error: resultado.error });
    }
    return await procesarCargaPadron(resultado.supabase, resultado.colegio.id, filas, res);
  } catch (err: any) {
    console.error('Error al cargar padrón desde la institución (link corto):', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al guardar los datos' });
  }
});

// ==============================================================================
// 4D. SOLICITUDES DE CÓDIGO DE CURSO (reemplaza el botón "Solicitar por WhatsApp")
// Una familia que no encuentra su código deja sus datos acá en vez de escribirle
// directo al fotógrafo por WhatsApp; queda listado en el panel admin para que lo
// atienda cuando pueda, sin flood de mensajes individuales.
// ==============================================================================

// Envío público: cualquier familia puede dejar su solicitud, sin login
app.post('/api/solicitudes-codigo', limitarFrecuencia('solicitudes-codigo', 10, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { nombreSolicitante, contacto, alumnoNombre, colegioId, colegioNombre, grado, division, turno, mensaje } = req.body || {};

    const nombre = String(nombreSolicitante || '').trim();
    const contactoLimpio = String(contacto || '').trim();
    if (!nombre || !contactoLimpio) {
      return res.status(400).json({ success: false, error: 'Faltan tu nombre y un WhatsApp o email de contacto' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const { data, error } = await supabase
      .from('solicitudes_codigo')
      .insert({
        nombre_solicitante: nombre,
        contacto: contactoLimpio,
        alumno_nombre: alumnoNombre ? String(alumnoNombre).trim() : null,
        colegio_id: colegioId || null,
        colegio_nombre: colegioNombre || null,
        grado: grado || null,
        division: division || null,
        turno: turno || null,
        mensaje: mensaje ? String(mensaje).trim().slice(0, 500) : null,
      })
      .select()
      .single();
    if (error) throw error;

    return res.json({ success: true, solicitud: data });
  } catch (err: any) {
    console.error('Error al guardar solicitud de código:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al enviar la solicitud' });
  }
});

// Listado para el panel admin (por defecto solo las pendientes, o todas con ?estado=todas)
app.get('/api/admin/solicitudes-codigo', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const estado = req.query.estado as string | undefined;
    let builder = supabase.from('solicitudes_codigo').select('*').order('created_at', { ascending: false });
    if (estado && estado !== 'todas') {
      builder = builder.eq('estado', estado);
    }
    const { data, error } = await builder;
    if (error) throw error;
    return res.json({ success: true, solicitudes: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener las solicitudes' });
  }
});

// Marca una solicitud como atendida (ya se le envió el código por fuera del panel)
app.post('/api/admin/solicitudes-codigo/:id/atender', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { data, error } = await supabase
      .from('solicitudes_codigo')
      .update({ estado: 'atendido', updated_at: new Date().toISOString() })
      .eq('id', id)
      .select();
    if (error) throw error;
    return res.json({ success: true, solicitud: data?.[0] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al actualizar la solicitud' });
  }
});

app.delete('/api/admin/solicitudes-codigo/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { error } = await supabase.from('solicitudes_codigo').delete().eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar la solicitud' });
  }
});

// ==============================================================================
// 5. HELPER PARA ENVÍO DE EMAIL CON RESEND
// ==============================================================================

// Auditoría 2026-09-09 (revisión a fondo): los dos correos de abajo arman el HTML pegando
// directo strings que vienen de un formulario público (nombre del padre/tutor, nombre del
// alumno, del colegio, del kit, etc.), sin sacarles los caracteres especiales de HTML. Alguien
// podía escribir en su nombre algo como `<a href="...">` y ese link (o cualquier otro HTML)
// terminaba insertado tal cual dentro de un correo real, con la marca de Retrato Escolar, que
// se le manda a una familia — la puerta de entrada clásica para un correo de phishing con
// apariencia legítima. Se escapan todos los valores que vienen de afuera antes de insertarlos.
function escapeHtml(valor: unknown): string {
  return String(valor ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

interface DatosCorreoFotosHD {
  to: string;
  tutorNombre?: string;
  alumnoNombre?: string;
  colegioNombre?: string;
  cursoCodigo?: string;
  pedidoId?: string;
  kitNombre?: string;
  total?: number;
  linkDescargaHD?: string;
  whatsappContacto?: string;
  esImpreso?: boolean;
}

async function enviarCorreoFotosHD(datos: DatosCorreoFotosHD) {
  const {
    to,
    tutorNombre,
    alumnoNombre,
    colegioNombre,
    cursoCodigo,
    pedidoId,
    kitNombre,
    total,
    linkDescargaHD,
    whatsappContacto,
    esImpreso,
  } = datos;

  if (!to || !to.includes('@')) {
    return { success: false, error: 'Email de destino inválido' };
  }

  const resend = getResendClient();
  if (!resend) {
    return {
      success: false,
      warning: 'RESEND_API_KEY no está configurada.',
      simulated: true,
      previewLink: linkDescargaHD,
    };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>';
  // Escapados porque van directo dentro del HTML del correo (ver escapeHtml arriba) — el
  // asunto del correo (más abajo) usa las variables sin escapar, que ahí no hace falta.
  const nombreDestinatario = escapeHtml(tutorNombre?.trim() || 'Familia');
  const nombreAlumnoStr = escapeHtml(alumnoNombre?.trim() || 'el alumno/a');
  const colegioStr = escapeHtml(colegioNombre?.trim() || 'la institución');
  const kitNombreStr = escapeHtml(kitNombre?.trim() || 'Kit Escolar');
  const pedidoIdStr = escapeHtml(pedidoId?.trim() || 'IFS-2026');
  const cursoCodigoStr = escapeHtml(cursoCodigo?.trim() || '2026');
  const whatsappContactoStr = whatsappContacto ? escapeHtml(whatsappContacto) : '';
  // IMPORTANTE: ya no se inventa un link cuando no se pasa uno explícito. Antes se armaba acá
  // mismo una URL con el patrón "/object/public/fotos-hd/..." que apuntaba a un archivo que
  // nunca existe (el bucket es privado y, además, hoy no hay ningún proceso que genere un .zip
  // por pedido) — el botón de descarga se mostraba siempre, aunque no hubiera nada real para
  // descargar. Ahora, sin un link real, el correo se manda igual (con el comprobante) pero sin
  // ese botón, en vez de mandar uno que siempre da error.
  const enlaceHD = linkDescargaHD && linkDescargaHD.trim() ? linkDescargaHD.trim() : null;

  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tus fotos en Alta Resolución - ${nombreAlumnoStr}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 600px; margin: 24px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <div style="background-color: #0f172a; padding: 32px 24px; text-align: center; border-bottom: 3px solid #f59e0b;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #f59e0b; text-transform: uppercase; margin-bottom: 6px;">
        RETRATO ESCOLAR • EDICIÓN 2026
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">
        ¡Tus Fotografías en Alta Resolución ya están listas!
      </h1>
      <p style="color: #94a3b8; font-size: 13px; margin: 6px 0 0 0;">
        ${colegioStr} • Curso: ${cursoCodigoStr}
      </p>
    </div>

    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; line-height: 1.6; margin-top: 0;">
        Hola <strong>${nombreDestinatario}</strong>,
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Confirmamos con éxito el pedido de las fotografías escolares de <strong>${nombreAlumnoStr}</strong>. 
        A continuación tienes acceso directo a tus archivos digitales en calidad original de imprenta (300 DPI, Ultra HD y sin marcas de agua).
      </p>

      ${enlaceHD ? `
      <div style="margin: 28px 0; text-align: center;">
        <a href="${enlaceHD}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.35);">
          ⬇️ Descargar Fotos en Alta Resolución (HD)
        </a>
        <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
          Formato original (.ZIP / JPEG 300 DPI) listo para imprimir o guardar
        </div>
      </div>
      ` : `
      <div style="margin: 24px 0; padding: 14px 16px; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; text-align: center; font-size: 13px; color: #475569;">
        En breve te enviaremos por este mismo medio el enlace para descargar tus fotos en alta resolución.
      </div>
      `}

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 24px 0;">
        <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 12px;">
          Resumen de tu Pedido
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b;">N° de Pedido:</td>
            <td style="padding: 6px 0; font-weight: 700; text-align: right; font-family: monospace; color: #0f172a;">${pedidoIdStr}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Alumno/a:</td>
            <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #0f172a;">${nombreAlumnoStr}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Kit Seleccionado:</td>
            <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #0f172a;">${kitNombreStr}</td>
          </tr>
          ${total ? `
          <tr style="border-top: 1px dashed #cbd5e1;">
            <td style="padding: 8px 0 0 0; font-weight: 700; color: #0f172a;">Total Abonado:</td>
            <td style="padding: 8px 0 0 0; font-weight: 800; text-align: right; color: #059669; font-size: 15px;">$${Number(total).toLocaleString('es-AR')} ARS</td>
          </tr>
          ` : ''}
        </table>
      </div>

      ${esImpreso ? `
      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 14px 16px; margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 700; color: #92400e; margin-bottom: 4px;">
          📦 Entrega de Material Impreso:
        </div>
        <div style="font-size: 12px; color: #78350f; line-height: 1.5;">
          Tu kit incluye las fotos reveladas en papel fotográfico profesional y carpeta institucional. Serán enviadas directamente al colegio para ser entregadas en mano en el plazo informado.
        </div>
      </div>
      ` : ''}

      <div style="font-size: 12px; color: #64748b; line-height: 1.6; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        <p style="margin: 0 0 8px 0;">
          💡 <strong>Recomendación:</strong> Guarda una copia de las fotos en tu Google Drive o en tu computadora para conservarlas siempre con su máxima calidad.
        </p>
        ${whatsappContactoStr ? `
        <p style="margin: 0;">
          ¿Tienes alguna duda con la descarga? Puedes contactar directamente a nuestro equipo por WhatsApp al <strong>+${whatsappContactoStr}</strong>.
        </p>
        ` : ''}
      </div>
    </div>

    <div style="background-color: #f1f5f9; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0;">
      © 2026 Retrato Escolar • Fotografía Escolar Profesional<br>
      <a href="https://retratoescolar.com.ar" style="color: #d97706; text-decoration: none; font-weight: 600;">retratoescolar.com.ar</a>
    </div>
  </div>
</body>
</html>
  `;

  const data = await resend.emails.send({
    from: fromEmail,
    to: [to],
    subject: `📸 Tus fotos en Alta Resolución - ${nombreAlumnoStr} (${colegioStr})`,
    html: htmlContent,
  });

  return {
    success: true,
    messageId: data.data?.id,
    from: fromEmail,
    to,
  };
}

interface DatosCorreoCodigoAcceso {
  to: string;
  padreNombre: string;
  colegioNombre: string;
  codigo: string;
  alumnos: { nombre: string; apellido: string; grado: string; division: string; turno: string }[];
  solicitaFotoHermanos?: boolean;
}

/** Envía por email el Código de Acceso a una familia recién aprobada (panel admin -> Inscriptos -> Aceptar y Enviar) */
async function enviarCorreoCodigoAcceso(datos: DatosCorreoCodigoAcceso) {
  const { to, padreNombre, colegioNombre, codigo, alumnos, solicitaFotoHermanos } = datos;

  if (!to || !to.includes('@')) {
    return { success: false, error: 'Email de destino inválido' };
  }

  const resend = getResendClient();
  if (!resend) {
    return { success: false, error: 'RESEND_API_KEY no está configurada en el servidor.' };
  }

  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>';
  // Escapados porque van directo dentro del HTML del correo (ver escapeHtml arriba) — vienen
  // del formulario público de inscripción, así que no se puede confiar en que no traigan HTML.
  const nombreDestinatario = escapeHtml(padreNombre?.trim() || 'Familia');
  const colegioStr = escapeHtml(colegioNombre?.trim() || 'la institución');

  const listaHijosHtml = alumnos
    .map(
      (a) =>
        `<li style="margin-bottom:4px;">${escapeHtml(a.nombre)} ${escapeHtml(a.apellido)} — ${escapeHtml(a.grado)} "${escapeHtml(a.division)}", Turno ${escapeHtml(a.turno)}</li>`
    )
    .join('');

  const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tu Código de Acceso - Retrato Escolar</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 600px; margin: 24px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    <div style="background-color: #0f172a; padding: 32px 24px; text-align: center; border-bottom: 3px solid #f59e0b;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #f59e0b; text-transform: uppercase; margin-bottom: 6px;">
        RETRATO ESCOLAR • EDICIÓN 2026
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">
        ¡Tu inscripción fue validada!
      </h1>
      <p style="color: #94a3b8; font-size: 13px; margin: 6px 0 0 0;">${colegioStr}</p>
    </div>
    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; line-height: 1.6; margin-top: 0;">Hola <strong>${nombreDestinatario}</strong>,</p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Le confirmamos que su registro familiar para el ciclo escolar 2026 en <strong>${colegioStr}</strong> ha sido validado con éxito.
      </p>
      <p style="font-size: 13px; font-weight: 700; color: #0f172a; margin-bottom: 6px;">Alumnos vinculados a su cuenta familiar:</p>
      <ul style="font-size: 13px; color: #334155; padding-left: 20px; margin-top: 0;">${listaHijosHtml}</ul>
      ${solicitaFotoHermanos ? '<p style="font-size:12px;color:#334155;">✓ Foto de hermanos juntos: Solicitada y programada</p>' : ''}
      <div style="margin: 24px 0; text-align: center; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 18px;">
        <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #92400e; margin-bottom: 6px;">
          Su Código de Acceso
        </div>
        <div style="font-size: 26px; font-weight: 800; color: #0f172a; font-family: monospace; letter-spacing: 2px;">
          ${codigo}
        </div>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #334155;">Con este único código podrá:</p>
      <ol style="font-size: 13px; color: #334155; padding-left: 20px;">
        <li>Ingresar a retratoescolar.com.ar</li>
        <li>Ver las galerías individuales y grupales de todos sus hijos sin usar códigos diferentes</li>
        <li>Seleccionar las fotos favoritas y armar un pedido consolidado en un solo pago</li>
      </ol>
      <div style="font-size: 12px; color: #64748b; line-height: 1.6; border-top: 1px solid #e2e8f0; padding-top: 16px; margin-top: 16px;">
        Para cualquier consulta, nuestro equipo fotográfico está a su entera disposición.
      </div>
    </div>
    <div style="background-color: #f1f5f9; padding: 18px 24px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0;">
      © 2026 Retrato Escolar • Fotografía Escolar Profesional<br>
      <a href="https://retratoescolar.com.ar" style="color: #d97706; text-decoration: none; font-weight: 600;">retratoescolar.com.ar</a>
    </div>
  </div>
</body>
</html>
  `;

  const data = await resend.emails.send({
    from: fromEmail,
    to: [to],
    subject: `Retrato Escolar: Tu Código de Acceso (${codigo}) - ${colegioStr}`,
    html: htmlContent,
  });

  return { success: true, messageId: data.data?.id, from: fromEmail, to };
}

// ==============================================================================
// 6. RUTAS RESEND (ESTADO, ENVÍO DIRECTO Y TEST)
// ==============================================================================

// Auditoría 2026-09-09 (revisión a fondo): esta ruta no pedía sesión y devolvía un fragmento
// real de la RESEND_API_KEY (primeros 6 + últimos 4 caracteres) a cualquier visitante. Enmascarado
// o no, no hay ningún motivo para exponer parte de una clave de servidor a todo internet — pasa
// a exigir sesión de administrador, igual que el resto de los diagnósticos del panel.
app.get(['/api/resend/status', '/resend/status'], requireAdminAuth, (req, res) => {
  const apiKey = process.env.RESEND_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>';

  res.json({
    configured: isConfigured,
    fromEmail,
    maskedKey: isConfigured ? `${apiKey!.substring(0, 6)}...${apiKey!.slice(-4)}` : null,
    domain: 'retratoescolar.com.ar',
  });
});

// SEGURIDAD: antes esta ruta no pedía ningún tipo de sesión — cualquiera podía hacer que el
// dominio verificado de Resend mandara un correo con el texto y el link que quisiera a
// cualquier casilla. Ahora exige la misma sesión de administrador que el resto del panel.
app.post(['/api/enviar-fotos-hd', '/enviar-fotos-hd'], requireAdminAuth, async (req, res) => {
  try {
    const resultado = await enviarCorreoFotosHD(req.body);
    if (!resultado.success && resultado.error) {
      return res.status(400).json(resultado);
    }
    return res.json(resultado);
  } catch (error: any) {
    console.error('[Resend] Error al enviar email:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error inesperado al enviar el correo mediante Resend',
    });
  }
});

// SEGURIDAD: es una herramienta de diagnóstico para el fotógrafo (probar que el dominio de
// Resend funciona), no algo que deba poder disparar cualquier visitante sin sesión.
app.post(['/api/resend/test', '/resend/test'], requireAdminAuth, async (req, res) => {
  try {
    const { to } = req.body;
    if (!to || !to.includes('@')) {
      return res.status(400).json({ success: false, error: 'Email de destino inválido' });
    }

    const resend = getResendClient();
    if (!resend) {
      return res.status(400).json({
        success: false,
        error: 'No se detectó RESEND_API_KEY en las variables de entorno. Configúrala en Settings o en .env.',
      });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>';

    const data = await resend.emails.send({
      from: fromEmail,
      to: [to],
      subject: '✅ Prueba de conexión con Resend - Retrato Escolar',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 20px auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #0f172a; margin-top: 0;">¡Conexión con Resend exitosa!</h2>
          <p style="color: #334155; font-size: 14px;">
            Este es un correo de prueba enviado desde tu dominio <strong>retratoescolar.com.ar</strong> utilizando la API de Resend.
          </p>
          <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; padding: 12px; border-radius: 8px; color: #065f46; font-size: 13px; margin: 16px 0;">
            ✓ Remitente: <strong>${fromEmail}</strong><br>
            ✓ Destino: <strong>${to}</strong><br>
            ✓ Sistema: Retrato Escolar 2026
          </div>
          <p style="font-size: 12px; color: #64748b;">
            Tus clientes recibirán sus enlaces HD y comprobantes automáticamente a través de este canal.
          </p>
        </div>
      `,
    });

    return res.json({
      success: true,
      messageId: data.data?.id,
      from: fromEmail,
    });
  } catch (error: any) {
    console.error('[Resend Test] Error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error al enviar email de prueba',
    });
  }
});

// ==============================================================================
// 7. INTEGRACIÓN MERCADO PAGO CHECKOUT PRO Y WEBHOOKS
// ==============================================================================

// Precios oficiales de cada kit (deben coincidir siempre con src/data/colegiosData.ts —
// KITS_DISPONIBLES). Es la fuente de verdad del lado del servidor: antes el monto a cobrar
// (unit_price) se armaba directamente con el "total" que mandaba el navegador, sin volver a
// calcularlo acá. Cualquiera podía interceptar el pedido a este endpoint (sin login, es la
// creación de la preferencia de pago) y cambiar "total" a $1 antes de que Mercado Pago generara
// el link de cobro — el pago hubiera sido válido por ese monto. Ver auditoría 2026-09-09.
const PRECIOS_KITS: Record<string, number> = {
  'kit-clasico': 30000,
  'kit-digital': 15000,
  'kit-evento-suelto': 5000,
};
const PRECIO_CARPETA_EXTRA = 15000;
const MAX_CARPETAS_EXTRA = 20; // tope defensivo, no hay caso de uso real por encima de esto

// Única función que calcula lo que se cobra por un pedido — la usan tanto la creación de la
// preferencia de Mercado Pago como el registro del pedido en la base (ver auditoría
// 2026-09-09, punto de gestión "un solo lugar de verdad para los precios"). Devuelve null si
// el kit no se reconoce.
function calcularTotalPedido(kitId: string, carpetasExtras: unknown): number | null {
  const precioBaseKit = PRECIOS_KITS[kitId];
  if (precioBaseKit === undefined) return null;
  const extrasValidados = Math.min(
    MAX_CARPETAS_EXTRA,
    Math.max(0, Math.floor(Number(carpetasExtras) || 0))
  );
  return precioBaseKit + extrasValidados * PRECIO_CARPETA_EXTRA;
}

// Crear preferencia de pago en Mercado Pago
app.post('/api/mercadopago/crear-preferencia', limitarFrecuencia('crear-preferencia', 20, 10 * 60 * 1000), async (req, res) => {
  try {
    const {
      pedidoId,
      kitId,
      kitNombre,
      alumnoNombre,
      colegioNombre,
      carpetasExtras,
      tutorNombre,
      tutorEmail,
      tutorTelefono,
    } = req.body;

    // El monto a cobrar SIEMPRE se calcula acá, del lado del servidor — nunca se usa el
    // "total" que pueda mandar el cliente, aunque venga en el body.
    const totalCalculado = calcularTotalPedido(kitId, carpetasExtras);
    if (totalCalculado === null) {
      return res.status(400).json({
        success: false,
        error: 'Kit no reconocido. No se puede calcular el precio a cobrar.',
      });
    }

    const mpConfig = getMercadoPagoConfig();
    if (!mpConfig) {
      return res.status(200).json({
        success: false,
        notConfigured: true,
        error: 'MERCADOPAGO_ACCESS_TOKEN no está configurada en las variables de entorno del servidor.',
      });
    }

    // Mercado Pago exige que "back_urls.success" sea una URL https válida cuando se usa
    // "auto_return" — si no, devuelve el error engañoso "auto_return invalid. back_url.success
    // must be defined" aunque la URL sí esté definida. En producción (fuera de localhost)
    // forzamos https siempre, sin depender de que el proxy haya informado bien el protocolo.
    const hostDetectado = req.get('host') || '';
    const esLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostDetectado);
    const protocoloFinal = esLocal ? req.protocol : 'https';
    const appUrl = (process.env.APP_URL || `${protocoloFinal}://${hostDetectado}`).replace(/\/+$/, '');
    const preference = new Preference(mpConfig);

    const preferenceData = {
      body: {
        items: [
          {
            id: pedidoId || `PED-${Date.now()}`,
            title: `Retrato Escolar 2026 - ${kitNombre || 'Kit Fotográfico'} (${alumnoNombre || 'Alumno'})`,
            description: `Fotos escolares para ${alumnoNombre} en ${colegioNombre}`,
            quantity: 1,
            unit_price: totalCalculado,
            currency_id: 'ARS',
          },
        ],
        payer: {
          name: tutorNombre || 'Familia',
          email: tutorEmail && tutorEmail.includes('@') ? tutorEmail : 'pagos@retratoescolar.com.ar',
          phone: {
            number: tutorTelefono || '',
          },
        },
        back_urls: {
          success: `${appUrl}/?mp_status=approved&pedido_id=${pedidoId}`,
          failure: `${appUrl}/?mp_status=rejected&pedido_id=${pedidoId}`,
          pending: `${appUrl}/?mp_status=pending&pedido_id=${pedidoId}`,
        },
        auto_return: 'approved',
        external_reference: pedidoId,
        notification_url: `${appUrl}/api/mercadopago/webhook`,
        statement_descriptor: 'RETRATO ESCOLAR',
      },
    };

    const result = await preference.create(preferenceData);

    return res.json({
      success: true,
      preferenceId: result.id,
      initPoint: result.init_point,
      sandboxInitPoint: result.sandbox_init_point,
    });
  } catch (error: any) {
    console.error('[Mercado Pago Preference Error]:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error al crear la preferencia de pago en Mercado Pago',
    });
  }
});

// Registra un pedido nuevo (lo llama el Portal de Familias al iniciar el checkout, antes de
// pagar). Auditoría 2026-09-09: antes esto lo hacía el NAVEGADOR directo contra Supabase con la
// clave anónima (insertando en 'familias' y 'pedidos'), y esas dos tablas tenían políticas de
// RLS que decían "permitir INSERT a cualquiera, sin ninguna condición" (with_check: true, para
// los roles anon/authenticated e incluso para "public"). Además 'familias' tenía una política
// de SELECT igual de abierta ("familias_select_public_temporal", sin ningún filtro) que dejaba
// leer el nombre y WhatsApp de TODAS las familias a cualquiera. En conjunto, cualquiera podía:
// (1) leer el listado completo de clientes (nombre + WhatsApp) sin ningún login, y (2) insertar
// pedidos falsos directo contra la API de Supabase (sin pasar por este sitio ni por Mercado
// Pago), con cualquier "total" o "estado" que quisiera — incluyendo "pagado". El PIN de admin
// del panel nunca protegió nada de esto, porque el navegador de CUALQUIER visitante ya tenía
// todo lo que hacía falta (la clave anónima pública) para escribir directo. Ahora esto pasa
// por acá: el total se recalcula siempre del lado del servidor (nunca se confía en un total
// mandado por el cliente) y el pedido SIEMPRE nace en estado "pendiente_pago" — ningún cliente
// puede crear un pedido ya marcado como pagado. Las políticas públicas de escritura/lectura de
// 'familias' y 'pedidos' se cerraron del lado de Supabase (ver migración de la auditoría).
app.post('/api/pedidos/crear', limitarFrecuencia('pedidos-crear', 20, 10 * 60 * 1000), async (req, res) => {
  try {
    const {
      pedidoId, kitId, carpetasExtras, tutorNombre, tutorTelefono, metodoPago,
      // Auditoría 2026-09-09 (revisión a fondo): campos nuevos para que el pedido quede
      // completo en Supabase (quién, de qué colegio/curso, qué fotos, email del tutor) y deje
      // de depender únicamente del localStorage del navegador de la familia. Son datos
      // descriptivos para poder cumplir el pedido — igual que tutorNombre/tutorTelefono ya
      // aceptados acá desde antes, se guardan tal como los manda el navegador (acotados en
      // longitud); el monto a cobrar sigue siendo SIEMPRE el que calcula el servidor arriba,
      // nunca un valor recibido del cliente.
      pedidoFriendlyId, tutorEmail, colegioId, colegioNombre, cursoCodigo, grado, division, turno,
      alumnoNombre, alumnoNumeroLista, codigoAlumno, kitNombre, fotosSeleccionadas, copiasExtras,
      linkDescargaHD,
    } = req.body || {};

    const totalCalculado = calcularTotalPedido(kitId, carpetasExtras);
    if (totalCalculado === null) {
      return res.status(400).json({ success: false, error: 'Kit no reconocido. No se puede registrar el pedido.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    // Recorta cualquier texto libre recibido a una longitud razonable, para que un campo
    // desbordado no pueda usarse para llenar la base de datos de basura.
    const acotar = (valor: unknown, maxLen: number): string => String(valor ?? '').trim().slice(0, maxLen);
    // Sólo acepta objetos planos chicos (no arrays, no anidados demasiado grandes) para las
    // columnas jsonb — si viene otra cosa, se guarda un objeto vacío en vez de fallar el pedido.
    const acotarJson = (valor: unknown): Record<string, any> => {
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
      const entradas = Object.entries(valor as Record<string, any>).slice(0, 20);
      const limpio: Record<string, any> = {};
      for (const [clave, val] of entradas) {
        if (typeof val === 'string') limpio[clave] = val.slice(0, 200);
        else if (typeof val === 'number' && Number.isFinite(val)) limpio[clave] = val;
        else if (typeof val === 'boolean') limpio[clave] = val;
      }
      return limpio;
    };

    let familiaId: string | null = null;
    const nombreTutor = String(tutorNombre || '').trim();
    const telefonoTutor = String(tutorTelefono || '').trim();
    const emailTutor = acotar(tutorEmail, 200);
    if (nombreTutor || telefonoTutor || emailTutor) {
      // OJO: familias.colegio_id es un uuid que referencia a la tabla "colegios" (un modelo de
      // datos más viejo, que hoy ni se usa) — NO tiene nada que ver con el "colegioId" (texto
      // libre / slug) que maneja el resto de la app (fotos.colegio_id, alumnos.colegio_id,
      // inscripciones.colegio_id son todos texto). Mandar ese valor acá rompería el INSERT
      // completo (Postgres rechaza un uuid inválido), así que no se toca esa columna: el
      // colegio del pedido se guarda en su lugar en pedidos.colegio_id / colegio_nombre (texto).
      const { data: famData, error: famError } = await supabase
        .from('familias')
        .insert({
          nombre: (nombreTutor || 'Familia').slice(0, 200),
          whatsapp: telefonoTutor.slice(0, 40),
          email: emailTutor.includes('@') ? emailTutor : null,
        })
        .select('id')
        .single();
      if (!famError && famData) familiaId = famData.id;
    }

    const tipoKit = kitId === 'kit-digital' ? 'solo_digital' : 'impreso_digital';
    const extrasValidados = Math.min(MAX_CARPETAS_EXTRA, Math.max(0, Math.floor(Number(carpetasExtras) || 0)));
    const metodosValidos = ['mercadopago', 'transferencia', 'efectivo'];
    const metodoPagoValido = metodosValidos.includes(metodoPago) ? metodoPago : 'mercadopago';

    const filaPedido: Record<string, any> = {
      familia_id: familiaId,
      tipo_kit: tipoKit,
      // Nace SIEMPRE en pendiente_pago — nunca se acepta un "estado" mandado por el cliente.
      // Sólo el webhook de Mercado Pago o el panel de admin (con sesión) lo pueden pasar a
      // "pagado". Ver comentario de auditoría arriba de este endpoint.
      estado: 'pendiente_pago',
      total: totalCalculado,
      carpetas_impresas: extrasValidados + 1,
      metodo_pago: metodoPagoValido,
      pedido_friendly_id: acotar(pedidoFriendlyId, 40) || null,
      colegio_id: acotar(colegioId, 100) || null,
      colegio_nombre: acotar(colegioNombre, 200) || null,
      curso_codigo: acotar(cursoCodigo, 60) || null,
      grado: acotar(grado, 60) || null,
      division: acotar(division, 60) || null,
      turno: acotar(turno, 60) || null,
      alumno_nombre: acotar(alumnoNombre, 200) || null,
      alumno_numero_lista: Number.isFinite(Number(alumnoNumeroLista)) ? Math.floor(Number(alumnoNumeroLista)) : null,
      codigo_alumno: acotar(codigoAlumno, 200) || null,
      kit_nombre: acotar(kitNombre, 120) || null,
      fotos_seleccionadas: acotarJson(fotosSeleccionadas),
      copias_extras: acotarJson(copiasExtras),
      link_descarga_hd: acotar(linkDescargaHD, 500) || null,
    };
    // Se respeta el UUID generado en el navegador (para poder correlacionarlo con el tracking
    // local y con Mercado Pago vía external_reference) sólo si tiene forma de UUID válido.
    if (typeof pedidoId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(pedidoId)) {
      filaPedido.id = pedidoId;
    }

    const { data: pedidoCreado, error: errorPedido } = await supabase
      .from('pedidos')
      .insert(filaPedido)
      .select('id')
      .single();
    if (errorPedido) throw errorPedido;

    return res.json({ success: true, pedidoId: pedidoCreado.id, total: totalCalculado });
  } catch (err: any) {
    console.error('Error al registrar pedido:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al registrar el pedido' });
  }
});

// Webhook de Mercado Pago
app.post(['/api/mercadopago/webhook', '/mercadopago/webhook'], async (req, res) => {
  try {
    const mpConfig = getMercadoPagoConfig();
    if (!mpConfig) {
      console.warn('[Mercado Pago Webhook] Notificación recibida pero MERCADOPAGO_ACCESS_TOKEN no está configurada.');
      return res.status(200).send('OK');
    }

    const topic = req.query.topic || req.body?.type || req.body?.topic;
    const paymentId = req.query.id || req.body?.data?.id || req.query['data.id'];

    console.log(`[Mercado Pago Webhook] Notificación recibida: topic=${topic}, paymentId=${paymentId}`);

    // Verificación de firma del webhook de Mercado Pago si se configuró MERCADOPAGO_WEBHOOK_SECRET
    const webhookSecret = process.env.MERCADOPAGO_WEBHOOK_SECRET;
    if (webhookSecret && webhookSecret.trim()) {
      const xSignature = req.headers['x-signature'] as string;
      const xRequestId = req.headers['x-request-id'] as string;
      if (xSignature) {
        const parts = xSignature.split(',');
        let ts = '';
        let hash = '';
        for (const part of parts) {
          const [k, v] = part.split('=');
          if (k && k.trim() === 'ts') ts = (v || '').trim();
          if (k && k.trim() === 'v1') hash = (v || '').trim();
        }
        if (ts && hash) {
          const manifest = `id:${paymentId};request-id:${xRequestId || ''};ts:${ts};`;
          const expectedHash = crypto
            .createHmac('sha256', webhookSecret.trim())
            .update(manifest)
            .digest('hex');
          // Antes esto solo dejaba un warning en el log y SEGUÍA procesando la notificación
          // igual. El impacto real de una firma inválida era acotado (después igual se
          // reconsulta el pago directo contra la API de Mercado Pago con el access token
          // propio, así que no se puede "inventar" un pago aprobado), pero no hay motivo para
          // aceptar una notificación que dice no venir de Mercado Pago: se rechaza.
          if (hash !== expectedHash) {
            console.warn('[Mercado Pago Webhook] Firma x-signature inválida — notificación rechazada.');
            return res.status(401).send('Invalid signature');
          }
        }
      }
    }

    if ((topic === 'payment' || req.body?.action?.includes('payment')) && paymentId) {
      const payment = new Payment(mpConfig);
      const paymentInfo = await payment.get({ id: String(paymentId) });

      console.log(`[Mercado Pago Webhook] Estado de pago: ${paymentInfo.status}, Ref: ${paymentInfo.external_reference}`);

      const pedidoId = paymentInfo.external_reference;
      const supabase = getServerSupabase();

      if (paymentInfo.status === 'approved') {
        if (pedidoId) {
          let orderData: any = null;

          if (supabase) {
            // Actualizar el pedido en Supabase.
            // OJO: la tabla "pedidos" solo tiene las columnas id, familia_id, evento_id,
            // alumno_id, tipo_kit, estado, total, mp_preference_id, mp_payment_id,
            // created_at, updated_at, carpetas_impresas, metodo_pago (más las columnas de
            // fulfillment agregadas en la auditoría 2026-09-09: colegio_id, colegio_nombre,
            // curso_codigo, grado, division, turno, alumno_nombre, etc. — ver esa migración).
            // Antes este update() escribía en "estado_pago" y "mercadopago_payment_id", que NO
            // existen en la tabla real — Postgres rechazaba el update completo (columna
            // inexistente) y el pedido JAMÁS se marcaba como pagado en Supabase, aunque Mercado
            // Pago sí hubiera aprobado el cobro. Se corrige a los nombres reales de columna.
            const { data, error } = await supabase
              .from('pedidos')
              .update({
                estado: 'pagado',
                mp_payment_id: String(paymentId),
                // Se guarda el monto que realmente cobró Mercado Pago (no el que se haya
                // calculado o mandado antes), para que "total" en la base siempre refleje la
                // plata que efectivamente entró — ver auditoría 2026-09-09.
                total: paymentInfo.transaction_amount ?? undefined,
                updated_at: new Date().toISOString(),
              })
              .eq('id', pedidoId)
              .select('*, familias(nombre, whatsapp, email)');

            if (error) {
              console.error('[Mercado Pago Webhook] Error al actualizar pedido en Supabase:', error);
            } else if (data && data.length > 0) {
              orderData = data[0];
            }
          }

          // Disparar email automático con el comprobante. Desde la auditoría 2026-09-09, el
          // pedido ya guarda alumno_nombre / colegio_nombre / curso_codigo / kit_nombre (ver
          // migración de esa fecha), así que el correo puede mostrar los datos reales del
          // pedido en vez de los genéricos "tu hijo/a" / "tu colegio" de antes. Se sigue
          // omitiendo el link de descarga en este correo automático: no existe (todavía) ningún
          // proceso que genere y suba un .zip por pedido a "fotos-hd" (se confirmó revisando el
          // storage: ahí solo hay las fotos originales sueltas por curso), así que cualquier
          // link armado acá apuntaría a un archivo inexistente — el envío manual de las fotos
          // HD se sigue haciendo como hasta ahora desde el panel.
          // El destinatario preferido es el email que la familia cargó al hacer el pedido (más
          // confiable: es a quien le corresponde el pedido), y sólo si no lo tenemos se usa el
          // email de quien pagó en Mercado Pago (puede ser otra persona, ej. un abuelo pagando).
          const emailDestino = orderData?.familias?.email || paymentInfo.payer?.email;
          if (emailDestino && emailDestino.includes('@')) {
            console.log(`[Mercado Pago Webhook] Enviando comprobante para pedido ${pedidoId} a ${emailDestino}`);
            await enviarCorreoFotosHD({
              to: emailDestino,
              tutorNombre: orderData?.familias?.nombre || paymentInfo.payer?.first_name || 'Familia',
              alumnoNombre: orderData?.alumno_nombre || 'tu hijo/a',
              colegioNombre: orderData?.colegio_nombre || 'tu colegio',
              cursoCodigo: orderData?.curso_codigo || undefined,
              kitNombre: orderData?.kit_nombre || undefined,
              pedidoId: orderData?.pedido_friendly_id || pedidoId,
              total: paymentInfo.transaction_amount || 0,
              whatsappContacto: orderData?.familias?.whatsapp || '',
            });
          }
        }
      } else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
        if (pedidoId && supabase) {
          console.log(`[Mercado Pago Webhook] Marcando pedido ${pedidoId} como rechazado/cancelado.`);
          await supabase
            .from('pedidos')
            .update({
              estado: 'cancelado',
              mp_payment_id: String(paymentId),
              updated_at: new Date().toISOString(),
            })
            .eq('id', pedidoId);
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Mercado Pago Webhook Error]:', error);
    return res.status(200).send('OK');
  }
});

// Endpoint público para que el cliente consulte el estado de pago actualizado de su pedido
app.get('/api/pedidos/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(503).json({ success: false, error: 'Servicio de base de datos no disponible' });
    }

    // OJO: la tabla "pedidos" solo tiene una columna de estado ("estado": pendiente_pago |
    // pagado | entregado | cancelado) — no existen "estado_pago" ni "mercadopago_payment_id".
    // Antes este select pedía esas columnas inexistentes, Postgres devolvía error, y este
    // endpoint (que usa el Portal de Familias para avisar automáticamente "tu pago fue
    // aprobado" apenas vuelven de Mercado Pago) fallaba siempre con 400 — ninguna familia veía
    // la confirmación automática, aunque el pago sí se hubiera acreditado bien. Ver auditoría
    // 2026-09-09.
    const { data, error } = await supabase
      .from('pedidos')
      .select('id, estado, updated_at, mp_payment_id')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }

    const esAprobado = data.estado === 'pagado' || data.estado === 'entregado';
    const esRechazado = data.estado === 'cancelado';

    return res.json({
      success: true,
      pedidoId: data.id,
      estado: data.estado,
      estadoPago: esAprobado ? 'aprobado' : esRechazado ? 'rechazado' : 'pendiente',
      actualizadoEl: data.updated_at,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al consultar estado del pedido' });
  }
});

// Auditoría 2026-09-09 (revisión a fondo): el buscador de "seguimiento de pedido" del Portal de
// Familias buscaba únicamente en el localStorage del navegador — una familia que entrara desde
// otro dispositivo o hubiera borrado los datos del navegador no encontraba su pedido, aunque
// estuviera pagado y guardado en Supabase. Este endpoint público (sin login, como corresponde a
// una búsqueda que hace la propia familia con su número de pedido o teléfono) permite buscar
// contra los datos reales. Es deliberadamente angosto para no poder usarse para "barrer" la
// base de pedidos de otras familias: exige al menos 4 caracteres del número de pedido, o al
// menos 6 dígitos de teléfono (la misma exigencia mínima que ya tenía la búsqueda local), sólo
// devuelve UNA coincidencia (la más reciente) y va detrás del mismo limitador de frecuencia por
// IP que el resto de los endpoints públicos sensibles.
app.get('/api/pedidos/buscar', limitarFrecuencia('pedidos-buscar', 15, 10 * 60 * 1000), async (req, res) => {
  try {
    const qRaw = String(req.query.query || '').trim();
    if (!qRaw) {
      return res.status(400).json({ success: false, error: 'Ingresá tu número de pedido o teléfono.' });
    }
    const query = qRaw.toUpperCase().slice(0, 60);
    const soloDigitos = query.replace(/\D/g, '');

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(503).json({ success: false, error: 'Servicio de base de datos no disponible' });
    }

    const columnas = 'id, pedido_friendly_id, colegio_nombre, alumno_nombre, grado, division, kit_nombre, total, estado, created_at, familias(nombre, whatsapp)';
    let fila: any = null;

    if (query.length >= 4) {
      const { data } = await supabase
        .from('pedidos')
        .select(columnas)
        .ilike('pedido_friendly_id', `%${query}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) fila = data[0];
    }

    if (!fila && soloDigitos.length >= 6) {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, pedido_friendly_id, colegio_nombre, alumno_nombre, grado, division, kit_nombre, total, estado, created_at, familias!inner(nombre, whatsapp)')
        .ilike('familias.whatsapp', `%${soloDigitos}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) console.warn('[pedidos/buscar] búsqueda por teléfono falló:', error.message);
      if (data && data.length > 0) fila = data[0];
    }

    if (!fila) {
      return res.status(404).json({ success: false, error: 'No se encontró ningún pedido registrado con ese número o teléfono.' });
    }

    return res.json({
      success: true,
      pedido: {
        id: fila.pedido_friendly_id || fila.id,
        colegio: fila.colegio_nombre,
        alumno: fila.alumno_nombre,
        grado: fila.grado,
        division: fila.division,
        tutor: fila.familias?.nombre || null,
        telefono: fila.familias?.whatsapp || null,
        kit: fila.kit_nombre,
        total: fila.total,
        fecha: fila.created_at,
        estado: fila.estado,
      },
    });
  } catch (err: any) {
    console.error('Error al buscar pedido:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al buscar el pedido' });
  }
});

// ==============================================================================
// 8. MIDDLEWARE VITE Y SERVIDO DE ARCHIVOS
// ==============================================================================

async function start() {
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Servidor Retrato Escolar corriendo en http://0.0.0.0:${PORT}`);
  });
}

export default app;

if (!process.env.VERCEL) {
  start();
}
