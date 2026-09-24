import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { Resend } from 'resend';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
import sharp from 'sharp';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import JSZip from 'jszip';
import QRCode from 'qrcode';

dotenv.config();

const app = express();
const PORT = 3000;

// Detrás del proxy de Vercel, sin esto Express cree que cada request llega por "http"
// (aunque el visitante esté en https) — eso rompe cualquier lógica que dependa de
// req.protocol, como la URL de retorno que le mandamos a Mercado Pago más abajo.
app.set('trust proxy', true);

// Resend firma el cuerpo exacto del webhook. Esta ruta debe procesarse como texto
// antes del parser JSON global para poder verificar que el evento sea auténtico.
app.post('/api/webhooks/resend-inbound', express.text({ type: 'application/json' }), async (req: Request, res: Response) => {
  try {
    const resend = getResendClient();
    const webhookSecret = process.env.RESEND_WEBHOOK_SECRET?.trim();
    if (!resend || !webhookSecret) return res.status(503).json({ success: false });
    const id = req.header('svix-id');
    const timestamp = req.header('svix-timestamp');
    const signature = req.header('svix-signature');
    if (!id || !timestamp || !signature) return res.status(400).json({ success: false });

    const evento = resend.webhooks.verify({
      payload: String(req.body || ''),
      headers: { id, timestamp, signature },
      webhookSecret,
    });
    if (evento.type !== 'email.received') return res.json({ success: true });

    const { data: email, error: emailError } = await resend.emails.receiving.get(evento.data.email_id);
    if (emailError || !email) throw emailError || new Error('No se pudo obtener el correo recibido.');
    const inboundDomain = (process.env.RESEND_INBOUND_DOMAIN || 'respuestas.retratoescolar.com.ar').toLowerCase();
    const destinatarios = Array.isArray(email.to) ? email.to : [];
    const direccionDestino = destinatarios.find((destino) => destino.toLowerCase().includes(`@${inboundDomain}`));
    const consultaId = direccionDestino?.match(/consulta-([0-9a-f-]{36})@/i)?.[1];
    if (!consultaId) return res.json({ success: true, ignored: true });

    const contenido = String(email.text || '').trim() || String(email.html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (!contenido) return res.json({ success: true, ignored: true });
    const supabase = getServerSupabase();
    if (!supabase) throw new Error('Supabase no configurado.');
    const { error: insertError } = await supabase.from('consultas_familias_mensajes').upsert({
      consulta_id: consultaId,
      direccion: 'entrante',
      remitente: email.from,
      destinatario: direccionDestino,
      asunto: email.subject || null,
      contenido: contenido.slice(0, 10000),
      resend_email_id: email.id,
      created_at: email.created_at,
    }, { onConflict: 'resend_email_id', ignoreDuplicates: true });
    if (insertError) throw insertError;
    await supabase.from('consultas_familias').update({ estado: 'nueva', updated_at: new Date().toISOString() }).eq('id', consultaId);
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Resend Inbound] Webhook rechazado o no procesado:', err);
    return res.status(400).json({ success: false });
  }
});

// Auditoría 2026-09-23 (bug real): express.json() sin opciones corta el body en 100 KB. El panel
// registra en UNA sola llamada todas las fotos de un lote (≈500 bytes por foto: 3 rutas/URLs
// largas + curso), así que un lote de ~200 fotos ya devolvía 413 "request entity too large": las
// fotos quedaban subidas a Storage pero NUNCA se registraban en el catálogo (no aparecían en la
// galería). Lo mismo con el padrón (hasta 2000 filas por importación). Vercel acepta hasta 4,5 MB.
app.use(express.json({ limit: '4mb' }));

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
//
// Auditoría 2026-09-23 (riesgo real para el lanzamiento): los límites son POR IP, y en Argentina
// los celulares suelen salir a internet por una IP compartida del operador (CGNAT) — igual que
// todas las familias conectadas al WiFi de un colegio. Varios topes eran tan bajos que un grupo de
// familias en la misma red se bloqueaba entre sí (ej. 10 inscripciones cada 15 min, o 60 consultas
// de estado cada 10 min, que una sola pantalla de "pago pendiente" agotaba sola en 4 minutos), y el
// webhook de Nave (siempre desde las mismas IPs de Nave) podía quedar rechazado en un día de mucha
// venta. Se subieron para uso legítimo en grupo; los secretos (códigos de 8 caracteres, tokens)
// siguen siendo inviables de adivinar con estos topes.
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

// Lazy client para Gemini (borrador de respuestas a consultas de familias — ver
// "4C. CONSULTAS DE FAMILIAS" más abajo). Solo redacta texto; nunca envía nada por su cuenta.
let geminiInstance: GoogleGenAI | null = null;
function getGeminiClient(): GoogleGenAI | null {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  if (!geminiInstance) {
    geminiInstance = new GoogleGenAI({ apiKey: apiKey.trim() });
  }
  return geminiInstance;
}

// Catálogo y reglas de negocio que la IA usa para redactar sugerencias de respuesta.
// OJO: si cambiás precios, kits o reglas (ver src/data/colegiosData.ts para los precios
// reales que ve el cliente), actualizá también este texto — no se lee de un solo lugar.
const CONTEXTO_NEGOCIO_CONSULTAS = `
Sos parte del equipo de atención al cliente de "Retrato Escolar" (retratoescolar.com.ar), un
servicio de fotografía escolar en Argentina.

Catálogo (precios en pesos argentinos):
- Kit Impreso + Digital ($30.000): 1 foto grupal impresa 20x30cm + 1 foto individual y 1 con
  la seño/docente, ambas 15x21cm, en una carpeta de presentación exclusiva. Incluye de regalo
  la descarga digital en alta resolución (HD) de las 3 fotos.
- Solo Digital HD ($15.000): las mismas 3 fotos (grupal, individual, con la seño), solo en
  descarga digital HD, sin impresión.
- Fotos Sueltas de Eventos ($5.000 c/u): fotos digitales individuales sueltas de actos,
  deportes, salidas o muestras (esta opción NO incluye foto grupal).
- La foto grupal de grado NUNCA se vende por separado: solo viene incluida dentro de los dos
  kits de arriba.

Cómo funciona:
- Cada familia recibe un Código Familiar único por email al aprobarse su inscripción, que le
  permite ver y elegir las fotos de su/s hijo/a/s (si tiene más de uno, un solo código alcanza
  para todos, aunque estén en cursos distintos).
- Las fotos de un curso se cargan al sistema después de que se toman las fotografías en el
  colegio. Hasta que eso pasa, la familia no puede elegir fotos ni pagar todavía, y se le avisa
  por email automáticamente en cuanto estén disponibles — no hace falta que vuelva a registrarse.
- El pago se hace online (Mercado Pago o Nave) dentro del mismo portal, una vez elegidas las 3
  fotos del kit.

Tu tarea: redactar una respuesta breve, cálida y clara en español rioplatense (tratamiento
"vos"), para la consulta de una familia que llegó por el formulario web. Contestá solo lo que
se pueda responder con la información de arriba. Si la consulta necesita datos puntuales que no
tenés acá (el estado real de un pedido, si ya se cargaron las fotos de un curso específico,
reclamos de pago, fechas de entrega, etc.), decilo con honestidad y avisale que el equipo va a
confirmarle ese dato — NUNCA inventes estados de pedidos, fechas o datos que no te dieron.
Devolvé SOLO el cuerpo del mensaje, sin saludo final ni firma (eso lo agrega el sistema aparte).
`.trim();

const resendReplyTo = process.env.RESEND_REPLY_TO_EMAIL || 'infocusfotografiayvideo@gmail.com';

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
// NAVE (Banco Galicia) — segundo medio de pago, sumado el 15/9/2026 a pedido de Pablo.
// Documentación real relevada ese día (portal de desarrolladores de Nave, sección "Checkout"):
// autenticación tipo OAuth2 client_credentials contra un servicio propio (no hay SDK server-side
// oficial, se llama con fetch directo), creación de una "intención de pago" que devuelve un
// checkout_url hosteado + un qr_data, y notificación asíncrona por webhook. A diferencia de
// Resend, Nave NO firma sus webhooks (no hay ningún esquema HMAC documentado) — por eso el
// webhook de acá abajo nunca confía en el estado que venga en el POST: siempre reconsulta el
// pago con un GET propio (con nuestro access_token) antes de tocar la base.
const NAVE_AUTH_AUDIENCE = 'https://naranja.com/ranty/merchants/api';

function getNaveEntorno(): 'sandbox' | 'production' {
  return (process.env.NAVE_ENVIRONMENT || 'sandbox').trim().toLowerCase() === 'production'
    ? 'production'
    : 'sandbox';
}

// URLs reales tomadas de la documentación de Nave (15/9/2026) — ver auditoría arriba.
function getNaveUrls() {
  const esSandbox = getNaveEntorno() === 'sandbox';
  return {
    auth: esSandbox
      ? 'https://homoservices.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate'
      : 'https://services.apinaranja.com/security-ms/api/security/auth0/b2b/m2msPrivate',
    crearIntencion: esSandbox
      ? 'https://api-sandbox.ranty.io/api/payment_request/ecommerce'
      : 'https://api.ranty.io/api/payment_request/ecommerce',
    // Base para "recuperar un pago" (GET .../ranty-payments/payments/{payment_id}) — se arma acá
    // en vez de usar el "payment_check_url" que manda la notificación tal cual, para no confiar
    // en una URL que viene en un POST sin firma (ver comentario del webhook más abajo).
    pagos: esSandbox
      ? 'https://api-sandbox.ranty.io/ranty-payments/payments'
      : 'https://api.ranty.io/ranty-payments/payments',
    intenciones: esSandbox
      ? 'https://api-sandbox.ranty.io/api/payment_requests'
      : 'https://api.ranty.io/api/payment_requests',
  };
}

function getNaveCredenciales(): { clientId: string; clientSecret: string; posId: string } | null {
  const clientId = process.env.NAVE_CLIENT_ID?.trim();
  const clientSecret = process.env.NAVE_CLIENT_SECRET?.trim();
  const posId = process.env.NAVE_POS_ID?.trim();
  if (!clientId || !clientSecret || !posId) return null;
  return { clientId, clientSecret, posId };
}

// Cache en memoria del access_token de Nave (dura 24hs según "expires_in") — no hace falta
// persistirlo: si el proceso del servidor se reinicia, se pide uno nuevo sin drama. Se guarda con
// 60s de margen para no arriesgarse a usarlo justo cuando expira.
let naveTokenCache: { token: string; expiraEn: number; entorno: string } | null = null;

async function obtenerNaveAccessToken(): Promise<string | null> {
  const credenciales = getNaveCredenciales();
  if (!credenciales) return null;
  const entorno = getNaveEntorno();
  if (naveTokenCache && naveTokenCache.entorno === entorno && naveTokenCache.expiraEn > Date.now()) {
    return naveTokenCache.token;
  }
  try {
    const { auth } = getNaveUrls();
    const resp = await fetch(auth, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: credenciales.clientId,
        client_secret: credenciales.clientSecret,
        audience: NAVE_AUTH_AUDIENCE,
      }),
    });
    if (!resp.ok) {
      console.error('[Nave] Error al obtener access_token:', resp.status, await resp.text().catch(() => ''));
      return null;
    }
    const data: any = await resp.json();
    if (!data?.access_token) return null;
    const expiresInSeg = Number(data.expires_in) || 3600;
    naveTokenCache = {
      token: data.access_token,
      expiraEn: Date.now() + Math.max(0, expiresInSeg - 60) * 1000,
      entorno,
    };
    return naveTokenCache.token;
  } catch (err) {
    console.error('[Nave] Error de red al pedir access_token:', err);
    return null;
  }
}

// ==============================================================================
// ZOHO MAIL — CAMPAÑA DE PROSPECCIÓN A COLEGIOS (agregado 22/9/2026 a pedido de Pablo)
// La función nativa "Mail Merge" de la interfaz web de Zoho falló con un error genérico
// ("Disculpas: Algo salió mal") tanto con la cuenta principal (ventas@contacto...) como con
// el alias (colegios@contacto...) y sin dejar ningún registro en el historial — todo indica
// un bloqueo de envío masivo a nivel de cuenta nueva, no un problema de datos ni de alias.
// Esta integración evita esa función puntual: manda los correos uno por uno con la API REST
// de Zoho Mail (POST /api/accounts/{accountId}/messages), autenticada por OAuth2. Datacenter
// zoho.com (US), confirmado en la consola de API de Zoho al crear la aplicación.
const ZOHO_ACCOUNTS_BASE = 'https://accounts.zoho.com';
const ZOHO_SCOPES = 'ZohoMail.messages.CREATE,ZohoMail.accounts.READ';
// Lista blanca de remitentes — sin esto, cualquiera que pudiera llamar al endpoint de envío
// (aun detrás de requireAdminAuth) podría hacer que el "De" fuera una dirección arbitraria.
const ZOHO_REMITENTES_PERMITIDOS = [
  'colegios@contacto.retratoescolar.com.ar',
  'ventas@contacto.retratoescolar.com.ar',
];

function getZohoCredenciales(): { clientId: string; clientSecret: string; redirectUri: string } | null {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  const redirectUri = process.env.ZOHO_REDIRECT_URI?.trim();
  if (!clientId || !clientSecret || !redirectUri) return null;
  return { clientId, clientSecret, redirectUri };
}

interface ZohoTokensGuardados {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  apiDomain: string;
  cuentaEmail: string | null;
  expiresAt: number; // epoch ms
}

async function obtenerZohoTokensGuardados(): Promise<ZohoTokensGuardados | null> {
  const supabase = getServerSupabase();
  if (!supabase) return null;
  const { data, error } = await supabase.from('zoho_oauth_tokens').select('*').eq('id', true).maybeSingle();
  if (error || !data) return null;
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    accountId: data.account_id,
    apiDomain: data.api_domain,
    cuentaEmail: data.cuenta_email,
    expiresAt: new Date(data.expires_at).getTime(),
  };
}

// Guarda la conexión completa — SOLO se usa en el callback de OAuth, la primera vez que se
// conecta una cuenta (o al reconectar). Todos los campos son obligatorios a propósito.
async function guardarZohoTokens(tokens: {
  accessToken: string;
  refreshToken: string;
  accountId: string;
  apiDomain: string;
  cuentaEmail: string | null;
  expiresAt: number;
}) {
  const supabase = getServerSupabase();
  if (!supabase) throw new Error('Supabase no configurado.');
  const { error } = await supabase.from('zoho_oauth_tokens').upsert({
    id: true,
    access_token: tokens.accessToken,
    refresh_token: tokens.refreshToken,
    account_id: tokens.accountId,
    api_domain: tokens.apiDomain,
    cuenta_email: tokens.cuentaEmail,
    expires_at: new Date(tokens.expiresAt).toISOString(),
    updated_at: new Date().toISOString(),
  }, { onConflict: 'id' });
  if (error) throw error;
}

// Bug real detectado el 22/9/2026: la renovación automática del access_token (ver más abajo)
// llamaba a guardarZohoTokens() con solo accessToken/expiresAt, confiando en que el upsert
// dejara el resto de las columnas (refresh_token, account_id, api_domain) como estaban. En
// realidad, el upsert de Supabase arma un INSERT ... ON CONFLICT DO UPDATE que también
// actualiza esas columnas con NULL cuando no vienen en el payload — y como refresh_token es
// NOT NULL, la renovación fallaba siempre con "null value in column refresh_token violates
// not-null constraint", dejando la conexión rota hasta desconectar y reconectar a mano. Esta
// función SÍ usa un UPDATE común (no upsert), que solo toca las columnas que le pasamos.
async function actualizarZohoAccessToken(accessToken: string, expiresAt: number): Promise<void> {
  const supabase = getServerSupabase();
  if (!supabase) throw new Error('Supabase no configurado.');
  const { error } = await supabase
    .from('zoho_oauth_tokens')
    .update({ access_token: accessToken, expires_at: new Date(expiresAt).toISOString(), updated_at: new Date().toISOString() })
    .eq('id', true);
  if (error) throw error;
}

// Devuelve un access_token vigente, renovándolo con el refresh_token si ya venció (con 2
// minutos de margen). Nunca pide el consentimiento de nuevo: eso solo pasa una vez, al
// conectar la cuenta desde el panel.
async function obtenerZohoAccessTokenValido(): Promise<ZohoTokensGuardados | null> {
  const creds = getZohoCredenciales();
  if (!creds) return null;
  const tokens = await obtenerZohoTokensGuardados();
  if (!tokens) return null;
  if (tokens.expiresAt - Date.now() > 2 * 60 * 1000) return tokens;
  try {
    const resp = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        refresh_token: tokens.refreshToken,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        grant_type: 'refresh_token',
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || !data?.access_token) {
      console.error('[Zoho] Error al renovar access_token:', resp.status, data);
      return null;
    }
    const nuevoExpiresAt = Date.now() + (Number(data.expires_in) || 3600) * 1000;
    await actualizarZohoAccessToken(data.access_token, nuevoExpiresAt);
    return { ...tokens, accessToken: data.access_token, expiresAt: nuevoExpiresAt };
  } catch (err) {
    console.error('[Zoho] Error de red al renovar access_token:', err);
    return null;
  }
}

interface DestinatarioCampanaZoho {
  email: string;
  institucion?: string;
  localidad_partido?: string;
  nivel?: string;
}

// Reemplaza las variables {{institucion}}, {{localidad_partido}} y {{nivel}} del asunto/cuerpo
// de la plantilla con los datos reales de cada colegio.
function personalizarPlantillaZoho(texto: string, destinatario: DestinatarioCampanaZoho): string {
  return String(texto || '')
    .replace(/\{\{\s*institucion\s*\}\}/gi, destinatario.institucion || '')
    .replace(/\{\{\s*localidad_partido\s*\}\}/gi, destinatario.localidad_partido || '')
    .replace(/\{\{\s*nivel\s*\}\}/gi, destinatario.nivel || '');
}

// Bug real detectado el 22/9/2026 en el primer correo de prueba: la API de Zoho Mail interpreta
// el campo "content" como HTML. Pablo escribe la plantilla como texto plano normal (con saltos
// de línea y viñetas "• "), y al mandarlo tal cual, sin ninguna etiqueta HTML, el cliente de
// correo colapsa todos los saltos de línea — el mail llegó como un solo párrafo corrido, sin
// forma de carta. Esta función convierte ese texto plano a un HTML simple y prolijo (párrafos,
// viñetas como lista real, y links autodetectados) antes de mandarlo.
// Pablo pidió (22/9/2026) que se vea "lindo, con color" como el mail de "fotos en HD listas"
// (franja oscura + naranja arriba, cajas con color para destacar puntos) en vez de texto plano
// en blanco y negro. Se reutiliza la misma paleta de esos templates: navy #0f172a + naranja
// #f59e0b/#d97706 en el header, caja celeste con tildes verdes para las viñetas, y una placa
// ámbar/roja para el título de sección en mayúsculas — todo generado a partir del texto plano
// que Pablo escribe en el panel, sin que tenga que tocar HTML él.
function formatearCuerpoCartaHtml(textoPlano: string): string {
  // Comillas incluidas: los links se insertan dentro de href="..." (una URL con " rompía el HTML).
  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const linkificar = (s: string) => s.replace(/(https?:\/\/[^\s<"]+)/g, '<a href="$1" style="color:#1d4ed8;">$1</a>');
  const esTituloCorto = (l: string) => l.length > 0 && l.length <= 45 && l === l.toUpperCase() && /[A-ZÁÉÍÓÚÑ]/.test(l);

  const bloques = String(textoPlano || '').trim().split(/\n\s*\n/);
  const cuerpoHtml = bloques.map((bloque) => {
    const lineas = bloque.split('\n').map((l) => l.trim()).filter((l) => l.length > 0);
    if (lineas.length === 0) return '';

    // Un renglón corto y en MAYÚSCULAS ("COBERTURA ESCOLAR 2026") se destaca como placa de color
    // en vez de quedar como una línea de texto más.
    if (lineas.length === 1 && esTituloCorto(lineas[0])) {
      return `<div style="margin:22px 0 14px 0;"><span style="display:inline-block;background-color:#fef3c7;color:#b91c1c;font-size:12px;font-weight:800;letter-spacing:1px;padding:6px 14px;border-radius:999px;">${escapeHtml(lineas[0])}</span></div>`;
    }

    // Viñetas ("• ") → caja con marco celeste y tilde verde por ítem, no una lista pelada.
    const esLista = lineas.every((l) => l.startsWith('• '));
    if (esLista) {
      const items = lineas
        .map((l) => `<p style="margin:0 0 8px 0;font-size:14px;line-height:1.5;color:#1e3a5f;"><span style="color:#059669;font-weight:800;">✓</span>&nbsp;${linkificar(escapeHtml(l.slice(2)))}</p>`)
        .join('');
      return `<div style="margin:0 0 20px 0;padding:16px 18px;background-color:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;">${items}</div>`;
    }

    // Un párrafo compuesto solo por un link (el de "conocé la propuesta completa") → botón de
    // acción naranja, igual que el resto de los correos del sitio, en vez de un texto azul.
    if (lineas.length === 1 && /^https?:\/\//i.test(lineas[0])) {
      const url = escapeHtml(lineas[0]);
      return `<div style="margin:24px 0;text-align:center;"><a href="${url}" target="_blank" rel="noopener noreferrer" style="display:inline-block;background-color:#d97706;color:#ffffff;font-size:14px;font-weight:700;text-decoration:none;padding:13px 28px;border-radius:12px;box-shadow:0 4px 12px rgba(217,119,6,0.35);">Ver la propuesta completa →</a></div>`;
    }

    return `<p style="margin:0 0 16px 0;font-size:14px;line-height:1.6;color:#334155;">${lineas.map((l) => linkificar(escapeHtml(l))).join('<br>')}</p>`;
  }).filter(Boolean).join('\n');

  // OJO — bug real detectado el 22/9/2026: acá había un documento HTML completo propio
  // (<!DOCTYPE>, <html>, <head>, <body>). Zoho mete el "content" que le mandamos DENTRO de su
  // propio documento de correo, así que terminaba habiendo un <html>/<body> anidado dentro de
  // otro — Gmail interpreta esa estructura como si fuera contenido citado/recortado y lo pliega
  // detrás de un "..." por default (el correo llegaba con el cuerpo escondido). La solución es
  // mandar solo el fragmento de contenido, sin documento propio — como el resto de los templates
  // de este archivo que sí usan Resend directamente.
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;max-width:600px;margin:0 auto;">
  <div style="background-color:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);">
    <div style="background-color:#0f172a;padding:32px 24px;text-align:center;border-bottom:3px solid #f59e0b;">
      <div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#f59e0b;text-transform:uppercase;margin-bottom:6px;">RETRATO ESCOLAR • PRODUCTORA INFOCUS</div>
      <h1 style="color:#ffffff;margin:0;font-size:21px;font-weight:800;letter-spacing:-0.5px;">Propuesta de Cobertura Fotográfica 2026</h1>
    </div>
    <div style="padding:28px 24px;">
      ${cuerpoHtml}
    </div>
    <div style="background-color:#f1f5f9;padding:18px 24px;text-align:center;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;">
      © 2026 Retrato Escolar • Fotografía Escolar Profesional<br>
      <a href="https://retratoescolar.com.ar" style="color:#d97706;text-decoration:none;font-weight:600;">retratoescolar.com.ar</a>
    </div>
  </div>
</div>`;
}

async function enviarZohoMail(params: {
  fromAddress: string;
  toAddress: string;
  subject: string;
  content: string;
}): Promise<{ ok: boolean; messageId?: string; error?: string }> {
  const tokens = await obtenerZohoAccessTokenValido();
  if (!tokens) return { ok: false, error: 'Zoho no está conectado, o no se pudo renovar el token de acceso.' };
  try {
    const resp = await fetch(`${tokens.apiDomain}/api/accounts/${tokens.accountId}/messages`, {
      method: 'POST',
      headers: {
        Authorization: `Zoho-oauthtoken ${tokens.accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fromAddress: params.fromAddress,
        toAddress: params.toAddress,
        subject: params.subject,
        content: formatearCuerpoCartaHtml(params.content),
        askReceipt: 'no',
      }),
    });
    const data: any = await resp.json().catch(() => ({}));
    if (!resp.ok || data?.status?.code !== 200) {
      return { ok: false, error: data?.data?.moreInfo || data?.status?.description || `Zoho respondió con error HTTP ${resp.status}.` };
    }
    return { ok: true, messageId: data?.data?.messageId };
  } catch (err: any) {
    return { ok: false, error: err?.message || 'Error de red al llamar a la API de Zoho Mail.' };
  }
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

// Auditoría 2026-09-22 (posible bug de seguridad, BAJO): comparación genérica en tiempo
// constante para secretos cortos comparados por igualdad de string (además del PIN/token admin,
// que ya usaban este patrón cada uno por su lado — ver verifyAdminToken arriba). Se centraliza
// acá para que cualquier otra comparación de "secreto que viene del cliente vs. secreto guardado"
// (por ejemplo el código de acceso al padrón de un colegio) no vuelva a compararse con `!==`
// plano, que es vulnerable en teoría a timing attacks.
function compararTimingSafe(a: string, b: string): boolean {
  try {
    const bufA = Buffer.from(a);
    const bufB = Buffer.from(b);
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
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

  // String(): si llegaba un número (ej. {"pin": 1234}) normalizePin hacía .trim() sobre un
  // número y el handler explotaba con un 500 en vez de responder "PIN incorrecto".
  const pin = req.body?.pin === undefined || req.body?.pin === null ? '' : String(req.body.pin);
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
          // Orden cronológico: más abajo "el más reciente" se toma como el último del array — sin
          // orden explícito Postgres devuelve las filas en cualquier orden.
          .order('created_at', { ascending: true })
          .order('id')
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

// Auditoría 2026-09-16 (pedido de Pablo: "necesito un buscador de alumnos, por nombre y
// apellido, dni, codigo, telefono, para saber si pagó"): hasta ahora, para saber si una familia
// puntual ya pagó había que entrar a "Estado de pagos" y elegir el colegio a mano (pensado para
// cursos con tarifa total acordada, no para una búsqueda rápida de un alumno cualquiera), o
// revisar "Pedidos" a ojo. Este endpoint busca en paralelo por nombre/apellido y DNI (tabla
// `alumnos`), por Código de Acceso real de la sección (`codigos_seccion`, mismo mecanismo que
// "Códigos y difusión") y por teléfono de la familia (`pedidos` + `familias.whatsapp`, igual que
// ya hace el buscador público `/api/pedidos/buscar`) — y para cada alumno que encuentra, cruza
// sus pedidos por nombre (mismo criterio que `/estado-pagos` de arriba) para decir si ya pagó.
app.get('/api/admin/alumnos/buscar', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const qRaw = String(req.query.q || '').trim();
    if (qRaw.length < 2) {
      return res.status(400).json({ success: false, error: 'Escribí al menos 2 caracteres para buscar.' });
    }
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });

    const soloDigitos = qRaw.replace(/\D/g, '');
    const codigoNormalizado = normalizarCodigoSeccion(qRaw);
    const qLike = `%${qRaw.replace(/[%_]/g, '\\$&')}%`;

    const [colegiosRes, porNombreRes, porDniRes, seccionesRes, pedidosPorTelefonoRes] = await Promise.all([
      supabase.from('colegios').select('id, nombre'),
      supabase.from('alumnos').select('id, nombre, grado, division, turno, colegio_id, numero_lista, dni').ilike('nombre', qLike).limit(50),
      supabase.from('alumnos').select('id, nombre, grado, division, turno, colegio_id, numero_lista, dni').ilike('dni', qLike).limit(50),
      codigoNormalizado.length >= 4
        ? supabase.from('codigos_seccion').select('colegio_id, grado, turno, division, codigo_secreto')
        : Promise.resolve({ data: [], error: null } as any),
      soloDigitos.length >= 6
        ? supabase
            .from('pedidos')
            .select(
              'id, pedido_friendly_id, colegio_id, colegio_nombre, alumno_nombre, grado, division, kit_nombre, total, estado, created_at, familias!inner(nombre, whatsapp, email)'
            )
            .ilike('familias.whatsapp', `%${soloDigitos}%`)
            .order('created_at', { ascending: false })
            .limit(20)
        : Promise.resolve({ data: [], error: null } as any),
    ]);
    if (porNombreRes.error) throw porNombreRes.error;
    if (porDniRes.error) throw porDniRes.error;

    const mapaColegios = new Map((colegiosRes.data || []).map((c: any) => [c.id, c.nombre]));

    // El código de sección no distingue mayúsculas ni guiones ("AB12-CD34" == "ab12cd34"), y
    // Supabase no lo puede filtrar así en la consulta — se compara ya normalizado acá.
    const seccionesQueMatchean = ((seccionesRes as any).data || []).filter(
      (s: any) => codigoNormalizado.length >= 4 && normalizarCodigoSeccion(s.codigo_secreto).includes(codigoNormalizado)
    );
    let alumnosDeSecciones: any[] = [];
    if (seccionesQueMatchean.length > 0) {
      const resultados = await Promise.all(
        seccionesQueMatchean.map((s: any) =>
          supabase
            .from('alumnos')
            .select('id, nombre, grado, division, turno, colegio_id, numero_lista, dni')
            .eq('colegio_id', s.colegio_id)
            .eq('grado', s.grado)
            .eq('turno', s.turno)
            .eq('division', s.division)
        )
      );
      alumnosDeSecciones = resultados.flatMap((r) => r.data || []);
    }

    // Combina y dedupea por id los tres caminos de búsqueda (nombre, DNI, código de sección).
    const mapaAlumnos = new Map<string, any>();
    [...(porNombreRes.data || []), ...(porDniRes.data || []), ...alumnosDeSecciones].forEach((a) => mapaAlumnos.set(a.id, a));
    const alumnosEncontrados = Array.from(mapaAlumnos.values()).slice(0, 60);

    // Para cruzar pago, trae de una sola vez todos los pedidos de cada colegio involucrado
    // (en vez de un pedido por alumno) — mismo criterio de "pagado" y de emparejado por nombre
    // normalizado que ya usa `/estado-pagos` arriba.
    const colegioIds = Array.from(new Set(alumnosEncontrados.map((a) => a.colegio_id).filter(Boolean)));
    const ESTADOS_PAGADOS = new Set(['pagado', 'entregado']);
    const pedidosPorColegio = new Map<string, any[]>();
    if (colegioIds.length > 0) {
      const resultados = await Promise.all(
        colegioIds.map((cid) =>
          traerTodasLasFilas<any>((desde, hasta) =>
            supabase
              .from('pedidos')
              .select('id, pedido_friendly_id, alumno_nombre, estado, total, kit_nombre, metodo_pago, created_at, familias(nombre, whatsapp, email)')
              .eq('colegio_id', cid)
              .order('created_at', { ascending: true })
              .order('id')
              .range(desde, hasta)
          )
        )
      );
      colegioIds.forEach((cid, idx) => pedidosPorColegio.set(cid, resultados[idx]));
    }

    // El Código de Acceso real de cada sección (no hay uno por alumno individual, es uno por
    // grado+turno+división) — se cachea por sección para no repetir la misma consulta si varios
    // alumnos encontrados comparten curso.
    const codigosPorSeccionCache = new Map<string, string | null>();
    const obtenerCodigoDeSeccion = async (a: any): Promise<string | null> => {
      const clave = `${a.colegio_id}__${a.grado}__${a.turno}__${a.division}`;
      if (codigosPorSeccionCache.has(clave)) return codigosPorSeccionCache.get(clave)!;
      const { data: fila } = await supabase
        .from('codigos_seccion')
        .select('codigo_secreto')
        .eq('colegio_id', a.colegio_id)
        .eq('grado', a.grado || '')
        .eq('turno', a.turno || '')
        .eq('division', a.division || '')
        .maybeSingle();
      const codigo = fila?.codigo_secreto || null;
      codigosPorSeccionCache.set(clave, codigo);
      return codigo;
    };

    const alumnosConDatos = await Promise.all(
      alumnosEncontrados.map(async (a) => {
        const pedidosDelColegio = pedidosPorColegio.get(a.colegio_id || '') || [];
        const claveExacta = normalizarNombreComparable(a.nombre);
        const clavePalabras = normalizarNombrePorPalabras(a.nombre);
        const pedidosDelAlumno = pedidosDelColegio.filter((p: any) => {
          const pClaveExacta = normalizarNombreComparable(p.alumno_nombre);
          const pClavePalabras = normalizarNombrePorPalabras(p.alumno_nombre);
          return pClaveExacta === claveExacta || pClavePalabras === clavePalabras;
        });
        const pedidoPagado = pedidosDelAlumno.find((p: any) => ESTADOS_PAGADOS.has(p.estado));
        const pedidoElegido = pedidoPagado || pedidosDelAlumno[pedidosDelAlumno.length - 1] || null;
        const codigoSeccion = await obtenerCodigoDeSeccion(a);

        return {
          id: a.id,
          nombre: a.nombre,
          dni: a.dni || null,
          grado: a.grado,
          division: a.division,
          turno: a.turno,
          numeroLista: a.numero_lista,
          colegioId: a.colegio_id,
          colegioNombre: mapaColegios.get(a.colegio_id) || null,
          codigoSeccion,
          pagado: !!pedidoPagado,
          otrosPedidos: pedidosDelAlumno.length > 1 ? pedidosDelAlumno.length - 1 : 0,
          pedido: pedidoElegido
            ? {
                id: pedidoElegido.id,
                numero: pedidoElegido.pedido_friendly_id || null,
                estado: pedidoElegido.estado,
                total: Number(pedidoElegido.total) || 0,
                kitNombre: pedidoElegido.kit_nombre,
                metodoPago: pedidoElegido.metodo_pago,
                fecha: pedidoElegido.created_at,
                tutorNombre: pedidoElegido.familias?.nombre || null,
                tutorTelefono: pedidoElegido.familias?.whatsapp || null,
                tutorEmail: pedidoElegido.familias?.email || null,
              }
            : null,
        };
      })
    );

    // Pedidos hallados directo por teléfono de la familia — se muestran aparte porque puede que
    // el nombre del alumno en ese pedido no matchee ningún alumno de la nómina cargada (typo,
    // alumno que ya no está en la lista, colegio sin nómina real cargada todavía, etc.), igual
    // que ya pasa en "Estado de pagos" con "Pedidos sin alumno en la nómina".
    const pedidosPorTelefono = ((pedidosPorTelefonoRes as any).data || []).map((p: any) => ({
      id: p.id,
      numero: p.pedido_friendly_id || null,
      alumnoNombre: p.alumno_nombre,
      colegioNombre: p.colegio_nombre || mapaColegios.get(p.colegio_id) || null,
      grado: p.grado,
      division: p.division,
      estado: p.estado,
      total: Number(p.total) || 0,
      kitNombre: p.kit_nombre,
      fecha: p.created_at,
      tutorNombre: p.familias?.nombre || null,
      tutorTelefono: p.familias?.whatsapp || null,
    }));

    return res.json({ success: true, alumnos: alumnosConDatos, pedidosPorTelefono });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al buscar alumnos' });
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
    // Paginado (ver traerTodasLasFilas): sin esto el listado se cortaba en 1000 familias.
    const data = await traerTodasLasFilas((desde, hasta) =>
      supabase.from('familias').select('*').order('created_at', { ascending: false }).order('id').range(desde, hasta)
    );
    return res.json({ success: true, familias: data });
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
    // Auditoría 2026-09-22: se agrega colegio_id al join con familias para que el panel de
    // "Resumen de Kits" (ver server-side fix en resumenKitsService.ts) pueda agrupar por
    // colegio sin necesitar una consulta aparte.
    // Auditoría 2026-09-23 (bug real): sin paginar, PostgREST devuelve como máximo 1000 filas —
    // a partir del pedido 1001 el panel de Laboratorio dejaba de mostrar los pedidos más viejos
    // sin ningún aviso. Se pagina igual que "Nómina 2026" (ver traerTodasLasFilas).
    const data = await traerTodasLasFilas((desde, hasta) =>
      supabase
        .from('pedidos')
        .select('*, pedido_fotos(*), familias(nombre, whatsapp, email, colegio_id)')
        .order('created_at', { ascending: false })
        .order('id')
        .range(desde, hasta)
    );
    return res.json({ success: true, pedidos: data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener pedidos' });
  }
});

// Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo). El pipeline físico de un
// pedido pagado tiene 3 etapas ordenadas — antes cada botón del panel las trataba por separado y
// nada impedía saltear una (ver bug real: se pudo marcar "listo_retiro" sin pasar por
// "en_produccion"). Esta es la única lista de orden: cualquier validación de "¿puedo avanzar a
// esta etapa?" en todo el archivo se apoya en ella, en vez de tener el orden repetido a mano en
// cada endpoint.
const ETAPAS_LAB = ['en_produccion', 'listo_retiro', 'entregado'] as const;
type EtapaLab = typeof ETAPAS_LAB[number];

/** true si "siguiente" es una etapa a la que se puede avanzar desde "actual" — es decir, la
 * inmediatamente próxima en ETAPAS_LAB, o la misma etapa (reenvío del mismo aviso). No permite
 * saltear etapas ni retroceder. */
function puedeAvanzarEtapaLab(actual: EtapaLab | null | undefined, siguiente: EtapaLab): boolean {
  const indiceSiguiente = ETAPAS_LAB.indexOf(siguiente);
  const indiceActual = actual ? ETAPAS_LAB.indexOf(actual) : -1;
  return indiceSiguiente === indiceActual || indiceSiguiente === indiceActual + 1;
}

app.post('/api/admin/pedidos/notificar-estado', requireAdminAuth, async (req: Request, res: Response) => {
 try {
  const tipo = req.body?.tipo as TipoActualizacionPedido;
  const destinatarios = Array.isArray(req.body?.destinatarios) ? req.body.destinatarios.slice(0, 100) : [];
  if (!['en_produccion', 'listo_retiro'].includes(tipo) || destinatarios.length === 0) return res.status(400).json({ success: false, error: 'Tipo de aviso o destinatarios inválidos.' });
  // Auditoría 2026-09-15: antes esta ruta sólo mandaba el email de aviso y nunca tocaba la base
  // de datos, así que el pedido quedaba "en producción"/"listo para retirar" únicamente en la
  // cabeza del cliente que recibió el mail — el panel seguía mostrándolo igual que antes y no
  // había forma de filtrar por esa etapa. Se agrega la columna "estado_lab" (pedidos.estado_lab)
  // y se guarda acá, junto con el envío del email, para que quede reflejado en el panel.
  const supabase = getServerSupabase();
  // Auditoría 2026-09-20 (pedido de Pablo): "En producción" y "Listo para retirar" ahora se
  // pueden reenviar (el fotógrafo puede volver a avisar al mismo cliente si hace falta), pero la
  // fecha que se le muestra en el panel tiene que ser SIEMPRE la del primer envío, no la del
  // último — si no, cada reenvío "borraría" cuándo entró realmente en producción. Por eso la
  // columna de fecha (fecha_envio_produccion / fecha_envio_listo_retiro) sólo se graba la
  // primera vez (.is(columna, null) en el WHERE); estado_lab y updated_at sí se actualizan
  // siempre, para que el panel siempre sepa cuál fue el último aviso mandado.
  const columnaFecha = tipo === 'en_produccion' ? 'fecha_envio_produccion' : 'fecha_envio_listo_retiro';
  let enviados = 0;
  const errores: string[] = [];
  const resultados: { pedidoId: string; estadoLab: string; fechaEnvioProduccion?: string | null; fechaEnvioListoRetiro?: string | null }[] = [];
  // Auditoría 2026-09-20 (bug real reportado por Pablo: apretó "Listo para retirar" en un pedido
  // que nunca había pasado por "En producción", y el sistema lo dejó pasar sin ningún aviso — ni
  // acá, ni en el botón del panel, había nada que impidiera saltear el paso). Se busca el
  // estado_lab actual de cada pedido ANTES de mandar nada, para poder frenar ese salto: no tiene
  // sentido avisarle a una familia "andá a buscar tus fotos" si el laboratorio nunca las mandó a
  // producción. Un pedido que YA está en 'listo_retiro' puede seguir recibiendo ese mismo aviso
  // de nuevo (reenvío) sin problema.
  const estadosActuales = new Map<string, string | null>();
  // Auditoría 2026-09-24: estado de PAGO de cada pedido — no se manda a producción ni se avisa
  // "listo para retirar" un pedido que todavía no se cobró (antes nada lo impedía, y el panel
  // pasaba a mostrarlo como "Aprobado").
  const estadosPago = new Map<string, string>();
  if (supabase) {
    const idsValidos = destinatarios.map((d: any) => d?.pedidoId).filter(Boolean);
    if (idsValidos.length > 0) {
      const { data: filasActuales, error: errorEstados } = await supabase
        .from('pedidos')
        .select('id, estado, estado_lab')
        .in('id', idsValidos);
      if (errorEstados) {
        console.warn('[notificar-estado] No se pudo verificar el estado_lab actual antes de enviar:', errorEstados.message);
      } else {
        (filasActuales || []).forEach((fila: any) => {
          estadosActuales.set(fila.id, fila.estado_lab);
          estadosPago.set(fila.id, fila.estado);
        });
      }
    }
  }
  for (const destinatario of destinatarios) {
    if (!destinatario?.to?.includes('@') || !destinatario?.pedidoId) { errores.push(`${destinatario?.alumnoNombre || 'Cliente'}: email o pedido inválido.`); continue; }
    // Auditoría 2026-09-20: esto también cierra un problema emparentado que no había reportado
    // Pablo todavía: antes, reenviar "En producción" a un pedido que YA estaba en "Listo para
    // retirar" pisaba estado_lab de vuelta a 'en_produccion' en la base (el UPDATE de más abajo
    // no distinguía "avanzar" de "retroceder"). puedeAvanzarEtapaLab bloquea ambos casos: saltear
    // una etapa hacia adelante, y retroceder una ya alcanzada.
    if (supabase && estadosPago.has(destinatario.pedidoId) && !['pagado', 'entregado'].includes(estadosPago.get(destinatario.pedidoId) as string)) {
      errores.push(`${destinatario.alumnoNombre || destinatario.to}: el pedido todavía no está pagado — aprobá el pago antes de avisar la etapa de laboratorio.`);
      continue;
    }
    if (supabase && !puedeAvanzarEtapaLab(estadosActuales.get(destinatario.pedidoId) as EtapaLab | null, tipo)) {
      const etapaLegible = tipo === 'en_produccion' ? 'En producción' : 'Listo para retirar';
      errores.push(`${destinatario.alumnoNombre || destinatario.to}: no se puede pasar a "${etapaLegible}" desde el estado actual de ese pedido (evita saltos y retrocesos de etapa).`);
      continue;
    }
    try {
      await enviarCorreoActualizacionPedido({ tipo, ...destinatario });
      enviados += 1;
      if (supabase) {
        const ahora = new Date().toISOString();
        // 1) Graba la fecha de "primera vez" sólo si todavía no existe.
        const { error: errorFecha } = await supabase
          .from('pedidos')
          .update({ [columnaFecha]: ahora })
          .eq('id', destinatario.pedidoId)
          .is(columnaFecha, null);
        if (errorFecha) console.warn(`[notificar-estado] Email enviado pero no se pudo guardar ${columnaFecha} para ${destinatario.pedidoId}:`, errorFecha.message);
        // 2) Actualiza el estado actual y updated_at siempre, sea primer envío o reenvío.
        const { data: filaActualizada, error: updateError } = await supabase
          .from('pedidos')
          .update({ estado_lab: tipo, updated_at: ahora })
          .eq('id', destinatario.pedidoId)
          .select('id, estado_lab, fecha_envio_produccion, fecha_envio_listo_retiro')
          .single();
        if (updateError) {
          console.warn(`[notificar-estado] Email enviado pero no se pudo guardar estado_lab para ${destinatario.pedidoId}:`, updateError.message);
        } else if (filaActualizada) {
          resultados.push({
            pedidoId: destinatario.pedidoId,
            estadoLab: filaActualizada.estado_lab,
            fechaEnvioProduccion: filaActualizada.fecha_envio_produccion,
            fechaEnvioListoRetiro: filaActualizada.fecha_envio_listo_retiro,
          });
        }
      }
    }
    catch (error: any) { errores.push(`${destinatario.alumnoNombre || destinatario.to}: ${error?.message || 'falló el envío'}`); }
  }
  return res.status(enviados > 0 ? 200 : 502).json({ success: errores.length === 0, enviados, fallidos: errores.length, errores, resultados });
 } catch (err: any) {
  // Auditoría 2026-09-21 (refuerzo): esta ruta era la única de todo el archivo sin try/catch
  // envolviendo todo el handler — si la consulta de estados actuales (más arriba) fallaba antes
  // de llegar al bucle, la promesa quedaba rechazada sin capturar y la respuesta nunca se
  // mandaba (el botón del panel se queda "colgado" en vez de mostrar un error).
  console.error('Error en /api/admin/pedidos/notificar-estado:', err);
  return res.status(500).json({ success: false, error: err?.message || 'Error al notificar el estado del pedido' });
 }
});

// Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo): hasta hoy no existía
// NINGÚN botón ni endpoint que registrara "la familia ya vino y retiró su pedido" — el pipeline
// del panel de Laboratorio se quedaba en "Listo para retirar" para siempre, sin forma de cerrar
// el círculo. El único lugar que modelaba un estado "entregado" era el valor 'entregado' de la
// columna de PAGO "estado" (mezclando cobro con entrega física), y nada lo escribía nunca. Este
// endpoint es la pieza que faltaba: usa estado_lab (el mismo campo de todo el pipeline físico,
// ver ETAPAS_LAB) en vez de tocar el estado de pago, y exige haber pasado por "listo_retiro"
// antes — no se puede marcar como retirado un pedido que nunca avisamos que estaba listo.
app.post('/api/admin/pedidos/:id/marcar-retirado', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });

    const { data: pedido, error: errorLectura } = await supabase
      .from('pedidos')
      .select('id, estado, estado_lab')
      .eq('id', id)
      .maybeSingle();
    if (errorLectura) throw errorLectura;
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    if (!['pagado', 'entregado'].includes(pedido.estado)) {
      return res.status(409).json({ success: false, error: 'Este pedido todavía no está pagado — aprobá el pago antes de marcarlo como retirado.' });
    }

    if (!puedeAvanzarEtapaLab(pedido.estado_lab as EtapaLab | null, 'entregado')) {
      return res.status(409).json({
        success: false,
        error: 'Este pedido todavía no pasó por "Listo para retirar" — avisale a la familia antes de marcarlo como retirado.',
      });
    }

    const ahora = new Date().toISOString();
    // La fecha de retiro se graba una sola vez (igual que fecha_envio_produccion/listo_retiro),
    // por si en algún momento se necesita "reabrir" y volver a marcar sin perder la fecha real.
    await supabase.from('pedidos').update({ fecha_entregado: ahora }).eq('id', id).is('fecha_entregado', null);
    const { data: filaActualizada, error: errorUpdate } = await supabase
      .from('pedidos')
      .update({ estado_lab: 'entregado', updated_at: ahora })
      .eq('id', id)
      .select('id, estado_lab, fecha_entregado')
      .single();
    if (errorUpdate) throw errorUpdate;

    return res.json({ success: true, estadoLab: filaActualizada.estado_lab, fechaEntregado: filaActualizada.fecha_entregado });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al marcar el pedido como retirado' });
  }
});

// Auditoría 2026-09-21 (pedido de Pablo: poder escanear con el celular un QR impreso en el sobre
// físico del laboratorio, y que le muestre al toque el pedido para avisar "Listo para retirar" o
// "Marcar retirado" sin tener que buscarlo a mano en el panel completo). Vista liviana de un solo
// pedido — evita bajar el listado entero de pedidos al celular sólo para atender un escaneo.
app.get('/api/admin/pedidos/:id/resumen', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });

    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select('id, pedido_friendly_id, alumno_nombre, colegio_nombre, grado, division, turno, estado, estado_lab, fecha_envio_produccion, fecha_envio_listo_retiro, fecha_entregado, familias(nombre, whatsapp, email)')
      .eq('id', id)
      .maybeSingle();
    if (error) throw error;
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

    const familia: any = Array.isArray((pedido as any).familias) ? (pedido as any).familias[0] : (pedido as any).familias;

    return res.json({
      success: true,
      pedido: {
        id: pedido.id,
        pedidoFriendlyId: pedido.pedido_friendly_id,
        alumnoNombre: pedido.alumno_nombre,
        colegioNombre: pedido.colegio_nombre,
        grado: pedido.grado,
        division: pedido.division,
        turno: pedido.turno,
        estado: pedido.estado,
        estadoLab: pedido.estado_lab,
        fechaEnvioProduccion: pedido.fecha_envio_produccion,
        fechaEnvioListoRetiro: pedido.fecha_envio_listo_retiro,
        fechaEntregado: pedido.fecha_entregado,
        tutorNombre: familia?.nombre || null,
        tutorEmail: familia?.email || null,
        tutorWhatsapp: familia?.whatsapp || null,
      },
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener el pedido' });
  }
});

// Genera el código QR (PNG) que se imprime en el sobre físico para el laboratorio: al escanearlo
// con la cámara del celular abre directamente la vista de arriba para ESE pedido puntual — como
// exige la sesión de admin (requireAdminAuth), quien escanee el sobre sin haber iniciado sesión
// como fotógrafo sólo ve la pantalla de PIN, nunca el nombre del alumno. No se guarda en ningún
// lado: se genera al vuelo cada vez que el panel lo pide, así que sigue sirviendo igual aunque
// cambie el dominio del sitio en el futuro.
app.get('/api/admin/pedidos/:id/qr', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });

    const { data: pedido, error } = await supabase.from('pedidos').select('id').eq('id', id).maybeSingle();
    if (error) throw error;
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

    const hostDetectado = req.get('host') || '';
    const esLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostDetectado);
    const protocoloFinal = esLocal ? req.protocol : 'https';
    const appUrl = (process.env.APP_URL || `${protocoloFinal}://${hostDetectado}`).replace(/\/+$/, '');
    const urlEscaneo = `${appUrl}/?escaneo=${encodeURIComponent(id)}`;

    const png = await QRCode.toBuffer(urlEscaneo, { type: 'png', width: 500, margin: 2 });
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(png);
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al generar el código QR' });
  }
});

// Actualizar estado de pedido (Pago o Entrega)
app.post('/api/admin/pedidos/:id/estado', requireAdminAuth, async (req, res) => {
  try {
    const { id } = req.params;
    const { estadoPago } = req.body;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    // OJO: la tabla "pedidos" solo tiene UNA columna de estado de PAGO ("estado": pendiente_pago |
    // pagado | entregado (legado, ver abajo) | cancelado) — no existe columna separada
    // "estado_pago". Antes este endpoint escribía en columnas inexistentes: como Postgres rechaza
    // el UPDATE completo si cualquiera de las columnas no existe, este botón del panel (marcar
    // pedido pagado a mano, pensado sobre todo para pagos en efectivo) nunca guardaba nada en
    // Supabase, aunque sí quedara guardado en el localStorage del navegador del admin. Se mapea al
    // único estado real. Ver auditoría 2026-09-09.
    // Auditoría 2026-09-20: se retira acá el manejo de "estadoEntrega === 'entregado'" que
    // escribía 'entregado' en ESTA columna de pago — nada en el panel llegó a usarlo nunca (era
    // código muerto) y mezclaba "se cobró" con "se retiró físicamente". Ese paso ahora es
    // POST /api/admin/pedidos/:id/marcar-retirado, que graba en estado_lab (ver más arriba).
    let nuevoEstado: string | undefined;
    if (estadoPago === 'aprobado' || estadoPago === 'pagado') {
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

    // Auditoría 2026-09-18 (reporte de Pablo): la automatización del .zip HD solo estaba
    // conectada a los webhooks de Mercado Pago y Nave. Cuando el admin aprueba un pago a mano
    // desde este botón (pagos en efectivo/transferencia), el pedido pasaba a "pagado" pero nunca
    // se generaba el .zip ni se guardaba el link de descarga — por eso el email salía sin el
    // link y el portal quedaba en "preparando tu descarga" para siempre. Se genera acá también,
    // igual que en los webhooks, cada vez que un pedido pasa a "pagado" por esta vía.
    let linkDescargaHD: string | null = null;
    if (nuevoEstado === 'pagado' && data?.[0]) {
      linkDescargaHD = await generarYSubirZipHDParaPedido(supabase, data[0]);
    }

    return res.json({ success: true, pedido: data?.[0], linkDescargaHD: linkDescargaHD || undefined });
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

    // Ver buscarColegioReal: una foto guardada con el id del colegio "de relleno" (lista de
    // colegios sin cargar) nunca aparece en la galería de las familias del colegio real.
    for (const colegioIdFoto of new Set(filas.map((f: any) => f.colegio_id))) {
      if (!(await buscarColegioReal(supabase, colegioIdFoto))) {
        return res.status(400).json({ success: false, error: 'El colegio elegido no es válido (la lista de colegios no terminó de cargar). Recargá el panel, elegí el colegio y volvé a intentar — las fotos ya subidas se pueden volver a registrar.' });
      }
    }

    const seccionesDelLote = Array.from(new Map(filas.map((fila: any) => [
      `${fila.colegio_id}|${fila.codigo_curso}`,
      { colegioId: fila.colegio_id, codigoCurso: fila.codigo_curso, grado: fila.grado, turno: fila.turno, division: fila.division },
    ])).values()) as Array<{ colegioId: string; codigoCurso: string; grado: string; turno: string; division: string }>;

    // El aviso se dispara únicamente cuando el curso pasa de cero fotos a tener su primera
    // galería real. Así, una carga posterior no vuelve a contactar a todas las familias.
    const seccionesNuevas: typeof seccionesDelLote = [];
    for (const seccion of seccionesDelLote) {
      const { count, error: errorConteo } = await supabase
        .from('fotos')
        .select('id', { count: 'exact', head: true })
        .eq('colegio_id', seccion.colegioId)
        .eq('codigo_curso', seccion.codigoCurso);
      if (errorConteo) throw errorConteo;
      if ((count || 0) === 0) seccionesNuevas.push(seccion);
    }

    const { data, error } = await supabase.from('fotos').insert(filas).select();
    if (error) throw error;

    let emailsEnviados = 0;
    const erroresAviso: string[] = [];
    for (const seccion of seccionesNuevas) {
      try {
        emailsEnviados += await avisarFotosDisponiblesASeccion(supabase, seccion);
      } catch (errorAviso: any) {
        console.error('[fotos] No se pudo enviar el aviso automático:', errorAviso);
        erroresAviso.push(errorAviso?.message || 'Error desconocido');
      }
    }

    return res.json({
      success: true,
      registradas: data?.length || 0,
      emailsEnviados,
      warning: erroresAviso.length > 0 ? 'Las fotos se publicaron, pero algunos avisos por email no pudieron enviarse.' : undefined,
    });
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
    // Paginado: sin esto sólo se revisaban las primeras 1000 fotos y "restantes" daba 0 aunque
    // quedaran fotos sin miniatura propia más allá de ese tope.
    const todas = await traerTodasLasFilas<any>((desde, hasta) =>
      supabase
        .from('fotos')
        .select('id, storage_path, thumb_path, preview_path')
        .order('created_at', { ascending: true })
        .order('id')
        .range(desde, hasta)
    );

    const candidatas = todas.filter((f: any) => !f.thumb_path || f.thumb_path === f.preview_path);
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

    // Paginado (mismo motivo que regenerar-miniaturas): el offset nunca pasaba de la foto 1000.
    const universo = await traerTodasLasFilas<any>((desde, hasta) =>
      supabase
        .from('fotos')
        .select('id, storage_path')
        .order('created_at', { ascending: true })
        .order('id')
        .range(desde, hasta)
    );
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

    // Auditoría 2026-09-23 (bug real): el panel de Laboratorio llama a esta ruta SIN filtros para
    // cruzar cada pedido con sus fotos. Sin paginar, PostgREST cortaba en las 1000 fotos más
    // nuevas: los pedidos de cursos cargados antes quedaban "sin fotos" en el panel (y sin
    // archivos para el laboratorio) aunque las fotos existieran.
    const data = await traerTodasLasFilas((desde, hasta) => {
      let builder = supabase.from('fotos').select('*').order('created_at', { ascending: false }).order('id');
      if (grado && turno) {
        builder = builder.eq('codigo_curso', determinarCodigoCursoServidor(grado, turno, division || ''));
      }
      if (colegioId) {
        builder = builder.eq('colegio_id', colegioId);
      }
      return builder.range(desde, hasta);
    });
    return res.json({ success: true, fotos: data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al obtener las fotos' });
  }
});

// Descarga protegida del original HD. El bucket permanece privado y el navegador sólo puede
// acceder mientras conserva una sesión válida del panel de administración.
app.get('/api/admin/fotos/:id/original', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado' });
    }

    const { data: foto, error: errorFoto } = await supabase
      .from('fotos')
      .select('storage_path')
      .eq('id', req.params.id)
      .maybeSingle();
    if (errorFoto) throw errorFoto;
    if (!foto?.storage_path) {
      return res.status(404).json({ success: false, error: 'Foto original no encontrada' });
    }

    const { data: archivo, error: errorDescarga } = await supabase.storage
      .from('fotos-hd')
      .download(foto.storage_path);
    if (errorDescarga || !archivo) throw errorDescarga || new Error('No se pudo descargar el original');

    const nombre = foto.storage_path.split('/').pop() || `${req.params.id}.jpg`;
    res.setHeader('Content-Type', archivo.type || 'application/octet-stream');
    res.setHeader('Content-Disposition', `inline; filename="${nombre.replace(/["\\\r\n]/g, '_')}"`);
    res.setHeader('Cache-Control', 'private, no-store');
    return res.send(Buffer.from(await archivo.arrayBuffer()));
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al descargar la foto original' });
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
// Auditoría 2026-09-19 (bug real encontrado en auditoría de código, MEDIO): este endpoint borra
// TODO el catálogo de fotos de TODOS los colegios de una sola vez, sin ningún tipo de
// confirmación más allá de tener sesión de admin — a diferencia de "Cerrar año", que exige
// escribir a mano una frase exacta antes de borrar nada. Un solo click accidental (o un token de
// admin filtrado) borra el catálogo completo sin posibilidad de deshacer. Se agrega la misma
// frase de seguridad que usa "Cerrar año".
app.delete('/api/admin/fotos', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const confirmacion = (req.body && (req.body as any).confirmacion) || (req.query.confirmacion as string) || '';
    const normalizar = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalizar(confirmacion) !== normalizar('borrar todas las fotos')) {
      return res.status(400).json({
        success: false,
        error: 'Falta confirmar. Tenés que mandar la frase exacta: "BORRAR TODAS LAS FOTOS".',
      });
    }
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

// Auditoría 2026-09-23 (bug real): storage.list() sólo devuelve el primer nivel de una carpeta —
// las subcarpetas vienen como entradas sin `id`. Las fotos se guardan en "2026/<curso>/originales/
// ...", así que listar la raíz devolvía sólo la carpeta "2026" y el vaciado de bucket terminaba
// sin borrar ni un archivo (y el borrado de buckets huérfanos fallaba por "bucket no vacío").
// Esto recorre las subcarpetas y devuelve la ruta completa de cada archivo.
async function listarArchivosDeBucket(
  supabase: SupabaseClient,
  bucket: string,
  prefijo = '',
  maxArchivos = 20000
): Promise<string[]> {
  const archivos: string[] = [];
  const pendientes: string[] = [prefijo.replace(/^\/+|\/+$/g, '')];
  while (pendientes.length > 0 && archivos.length < maxArchivos) {
    const carpeta = pendientes.shift() as string;
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await supabase.storage.from(bucket).list(carpeta, { limit: 1000, offset });
      if (error) throw error;
      const entradas = data || [];
      for (const entrada of entradas) {
        const ruta = carpeta ? `${carpeta}/${entrada.name}` : entrada.name;
        if (entrada.id) archivos.push(ruta);
        else pendientes.push(ruta);
      }
      if (entradas.length < 1000) break;
    }
  }
  return archivos.slice(0, maxArchivos);
}

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
// Auditoría 2026-09-19 (bug real encontrado en auditoría de código, MEDIO): mismo problema que
// DELETE /api/admin/fotos — vacía un bucket entero (potencialmente todas las fotos HD o web del
// negocio) sin más confirmación que la sesión de admin. Se agrega la misma frase de seguridad
// que usa "Cerrar año", específica del bucket para evitar confundir cuál se va a vaciar.
app.post('/api/admin/storage/limpiar-bucket', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { bucket, prefix, confirmacion } = req.body || {};
    if (!BUCKETS_FOTOS_PERMITIDOS.has(bucket)) {
      return res.status(400).json({ success: false, error: 'Bucket no permitido' });
    }
    const normalizar = (s: string) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (normalizar(confirmacion) !== normalizar(`borrar bucket ${bucket}`)) {
      return res.status(400).json({
        success: false,
        error: `Falta confirmar. Tenés que mandar la frase exacta: "BORRAR BUCKET ${String(bucket).toUpperCase()}".`,
      });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const prefijo = typeof prefix === 'string' ? prefix : '';

    // Recorre también las subcarpetas (ver listarArchivosDeBucket); tope defensivo de 20.000
    // archivos por llamada.
    const rutas = await listarArchivosDeBucket(supabase, bucket, prefijo);
    let eliminados = 0;
    for (const lote of enLotes(rutas, 500)) {
      const { error: errorRemove } = await supabase.storage.from(bucket).remove(lote);
      if (errorRemove) throw errorRemove;
      eliminados += lote.length;
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

    const rutas = await listarArchivosDeBucket(supabase, bucket);
    let eliminados = 0;
    for (const lote of enLotes(rutas, 500)) {
      const { error: errorRemove } = await supabase.storage.from(bucket).remove(lote);
      if (errorRemove) throw errorRemove;
      eliminados += lote.length;
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

  // Auditoría 2026-09-22 (bug real encontrado en auditoría de código, ALTO): antes esto filtraba
  // `familias.eq('colegio_id', colegioId)`, pero familias.colegio_id es la columna uuid del
  // modelo VIEJO (referencia a la tabla "colegios") que /api/pedidos/crear deliberadamente NUNCA
  // completa al crear una familia real (ver el comentario ahí: ese valor es texto/slug en el
  // resto de la app, no un uuid, y escribirlo rompería el INSERT). Como resultado, esa condición
  // no matcheaba NINGUNA fila real — "resumen" mostraba siempre "familias: 0" y "ejecutar" jamás
  // borraba nombre/whatsapp/email de esas familias, que quedaban huérfanas para siempre pese a
  // que el cierre de año promete limpiar los datos de la temporada. Ahora las familias del
  // colegio se derivan de sus alumnos (alumnos.familia_id) y de sus pedidos (pedidos.familia_id),
  // que son las dos relaciones reales que sí se completan siempre.
  //
  // Auditoría 2026-09-23 (bug real, ALTO): todas estas consultas iban sin paginar (PostgREST
  // corta en 1000 filas: un colegio con 1314 alumnos dejaba 314 sin borrar y el "resumen" mostraba
  // números falsos) y armaban filtros `alumno_id.in.(<todos los ids>)` dentro de la URL — con
  // cientos de UUIDs la URL supera el límite del servidor y la consulta falla entera. Ahora se
  // pagina y los filtros por lista de ids se parten en lotes chicos.
  const alumnos = await traerTodasLasFilas<{ id: string; familia_id: string | null }>((desde, hasta) => {
    const q = supabase.from('alumnos').select('id, familia_id').order('id');
    return (todos ? q : q.eq('colegio_id', colegioId)).range(desde, hasta);
  });
  const alumnoIds: string[] = alumnos.map((a) => a.id);

  // Filas de `tabla` del colegio (por colegio_id) + las ligadas a sus alumnos (por alumno_id),
  // sin repetir.
  const traerPorColegioOAlumnos = async <T extends { id: string }>(tabla: string, columnas: string): Promise<T[]> => {
    const porId = new Map<string, T>();
    const agregar = (filas: T[]) => filas.forEach((f) => porId.set(f.id, f));
    agregar(await traerTodasLasFilas<T>((desde, hasta) => {
      const q = supabase.from(tabla).select(columnas).order('id');
      return (todos ? q : q.eq('colegio_id', colegioId)).range(desde, hasta);
    }));
    if (!todos) {
      for (const lote of enLotes(alumnoIds)) {
        agregar(await traerTodasLasFilas<T>((desde, hasta) =>
          supabase.from(tabla).select(columnas).in('alumno_id', lote).order('id').range(desde, hasta)
        ));
      }
    }
    return Array.from(porId.values());
  };

  const fotos = await traerPorColegioOAlumnos<{ id: string; storage_path: string | null; thumb_path: string | null; preview_path: string | null }>(
    'fotos',
    'id, storage_path, thumb_path, preview_path'
  );

  // Auditoría 2026-09-19 (bug real encontrado en auditoría de código, MEDIO): esto filtraba
  // sólo por familia_id/alumno_id, pero esas dos columnas del pedido casi nunca se completan;
  // en cambio "pedidos.colegio_id" SÍ se guarda siempre desde que se creó el pedido (ver
  // /api/pedidos/crear) — por eso se filtra también por colegio_id.
  const pedidosDelColegio = await traerPorColegioOAlumnos<{ id: string; familia_id: string | null }>('pedidos', 'id, familia_id');

  const familiaIdsSet = new Set<string>();
  for (const a of alumnos) {
    if (a.familia_id) familiaIdsSet.add(a.familia_id);
  }
  for (const p of pedidosDelColegio) {
    if (p.familia_id) familiaIdsSet.add(p.familia_id);
  }
  const familiaIds: string[] = Array.from(familiaIdsSet);

  return { familiaIds, alumnoIds, fotos, pedidoIds: pedidosDelColegio.map((p) => p.id) };
}

// Parte una lista de ids en lotes chicos para filtros `.in(...)`: cada id viaja en la URL de la
// consulta, y con cientos de UUIDs juntos la URL supera el largo máximo que acepta el servidor.
function enLotes<T>(lista: T[], tamano = 100): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < lista.length; i += tamano) lotes.push(lista.slice(i, i + tamano));
  return lotes;
}

// Ids de pedido_fotos ligados a esos pedidos o fotos (sin repetir), consultando en lotes.
async function idsPedidoFotosDe(
  supabase: NonNullable<ReturnType<typeof getServerSupabase>>,
  pedidoIds: string[],
  fotoIds: string[]
): Promise<string[]> {
  const ids = new Set<string>();
  for (const [columna, lista] of [['pedido_id', pedidoIds], ['foto_id', fotoIds]] as const) {
    for (const lote of enLotes(lista)) {
      const filas = await traerTodasLasFilas<{ id: string }>((desde, hasta) =>
        supabase.from('pedido_fotos').select('id').in(columna, lote).order('id').range(desde, hasta)
      );
      filas.forEach((f) => ids.add(f.id));
    }
  }
  return Array.from(ids);
}

// Las miniaturas/vistas ampliadas (thumb_path/preview_path) se guardan como URL pública
// completa (bucket 'fotos-web'); storage_path (HD) se guarda como ruta relativa dentro de
// 'fotos-hd'. Esto extrae la ruta relativa real dentro del bucket para poder borrar el
// archivo físico, sea cual sea el formato en el que haya quedado guardado.
function extraerPathStorageParaCierre(valor: string | null, bucket: string): string | null {
  if (!valor) return null;
  const marcador = `/object/public/${bucket}/`;
  const idx = valor.indexOf(marcador);
  // Las URLs guardadas llevan "?v=<timestamp>" al final (anti-caché, ver subida de fotos): hay que
  // sacarlo, si no Storage busca un archivo con ese nombre literal y el borrado no hace nada.
  const sinQuery = (ruta: string) => ruta.split('?')[0];
  if (idx >= 0) return sinQuery(valor.substring(idx + marcador.length));
  return valor.startsWith('http') ? null : sinQuery(valor);
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

    const pedidoFotos = (await idsPedidoFotosDe(supabase, pedidoIds, fotos.map((f) => f.id))).length;

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
  // Declarado fuera del try/catch para que el catch de abajo pueda seguir leyéndolo (una
  // variable `let`/`const` declarada DENTRO de un bloque try no es visible en su catch).
  let pasoActual = 'validación';
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

    // Auditoría 2026-09-22 (posible bug de integridad, BAJO): esta operación borra en varios
    // pasos secuenciales SIN transacción (Supabase/PostgREST no expone transacciones multi-tabla
    // desde acá sin escribir una función RPC en la base, que es un cambio de esquema que no se
    // aplica solo desde este archivo). Si un paso intermedio falla (timeout, error puntual), el
    // cierre de año queda a medio hacer sin forma de saber en cuál. Mitigación barata: se guarda
    // en qué paso se está y se lo suma al mensaje de error, para que quede claro qué se alcanzó a
    // borrar y qué no si algo se corta a mitad de camino.
    pasoActual = 'pedido_fotos';

    // Borra por lista de ids en lotes (ver enLotes: la lista viaja en la URL).
    const borrarPorIds = async (tabla: string, columna: string, ids: string[]) => {
      for (const lote of enLotes(ids)) {
        const { error } = await supabase.from(tabla).delete().in(columna, lote);
        if (error) throw error;
      }
    };

    // 1) pedido_fotos (depende de pedidos y fotos)
    await borrarPorIds('pedido_fotos', 'pedido_id', pedidoIds);
    await borrarPorIds('pedido_fotos', 'foto_id', fotoIds);

    // 2) pedidos
    pasoActual = 'pedidos';
    await borrarPorIds('pedidos', 'id', pedidoIds);

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
    pasoActual = 'fotos';
    await borrarPorIds('fotos', 'id', fotoIds);

    // 5) alumnos
    pasoActual = 'alumnos';
    await borrarPorIds('alumnos', 'id', alumnoIds);

    // 6) familias
    pasoActual = 'familias';
    await borrarPorIds('familias', 'id', familiaIds);

    // 7-11) el resto de las tablas de temporada, scopeadas por colegio (o todas si es "todos").
    // Igual que en /api/admin/fotos (DELETE), .not('id','is',null) es el filtro "matchea todo"
    // que exige el cliente de Supabase para no permitir un delete() totalmente sin condición.
    const borrarPorColegio = async (tabla: string) => {
      pasoActual = tabla;
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
    console.error(`Error al ejecutar el cierre de año (paso: ${pasoActual}):`, err);
    return res.status(500).json({
      success: false,
      error: `${err?.message || 'Error al cerrar el año'} (se cortó en el paso "${pasoActual}" — revisá qué se alcanzó a borrar antes de reintentar)`,
    });
  }
});

// Galería pública: fotos reales de un curso puntual, para el portal de familias.
// SEGURIDAD: esta ruta es pública (sin sesión), así que la única puerta de entrada es el
// código secreto de la sección (`codigo_seccion`, ver `codigos_seccion` más arriba). Antes
// esta ruta aceptaba directamente grado/turno/división —datos públicos, visibles en un
// combo del sitio— y devolvía las fotos reales sin pedir ningún código: cualquiera podía
// ver las fotos de cualquier curso con sólo elegir las opciones del desplegable. Ahora el
// grado/turno/división salen del código validado, nunca de lo que mande el navegador.
app.get('/api/fotos', limitarFrecuencia('fotos-galeria', 600, 10 * 60 * 1000), async (req: Request, res: Response) => {
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

// Auditoría 2026-09-23 (bug de integridad, ALTO): el sitio muestra un colegio "de relleno"
// (id 'col-divino-pastor-2026', ver COLEGIO_POR_DEFECTO en colegiosService.ts) mientras carga la
// lista real o si esa carga falla. Una inscripción o un pedido enviados en ese momento quedaban
// guardados con un colegio_id que no existe: nunca cruzaban con el padrón ni con las fotos del
// colegio real (la familia no veía nunca sus fotos). Se valida contra la tabla antes de guardar.
async function buscarColegioReal(supabase: SupabaseClient, colegioId: unknown): Promise<{ id: string; nombre: string } | null> {
  const id = String(colegioId || '').trim();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return null;
  const { data, error } = await supabase.from('colegios').select('id, nombre').eq('id', id).maybeSingle();
  if (error) throw error;
  return data ? { id: data.id, nombre: data.nombre } : null;
}
const ERROR_COLEGIO_NO_VALIDO = 'No pudimos identificar el colegio. Recargá la página y volvé a intentar.';

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

// Auditoría 2026-09-22 (pedido de Pablo: "que cada vez que vayan a ingresar, lo hagan con
// nombre y apellido del padre, tutor o encargado, el DNI del padre, tutor o encargado, y el
// código generado"): igual que el teléfono, el DNI se compara sólo por dígitos (sin puntos ni
// espacios que la familia pueda haber tipeado).
function normalizarDniServidor(dni: unknown): string {
  return String(dni || '').replace(/\D/g, '');
}

// Auditoría 2026-09-22 (bug real encontrado en auditoría de código, BAJO): los timestamps
// legibles que se guardan en `fecha_inscripcion`/`fecha_aprobacion` se armaban con
// `now.getDate()/getMonth()/getHours()`, que usan la hora LOCAL DEL PROCESO NODE, no la de
// Argentina. En un despliegue serverless (Vercel) el runtime suele correr en UTC, así que esas
// fechas quedaban grabadas y mostradas en el panel con ~3hs de diferencia respecto a la hora
// real en la que la familia se inscribió o se la aprobó — confuso para el fotógrafo al revisar
// "cuándo pasó esto". Se centraliza acá con Intl.DateTimeFormat fijando explícitamente el huso
// horario de Argentina, sin importar en qué huso corra el servidor.
function formatearFechaHoraArgentina(fecha: Date): string {
  const partes = new Intl.DateTimeFormat('es-AR', {
    timeZone: 'America/Argentina/Buenos_Aires',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(fecha);
  const obtener = (tipo: string) => partes.find((p) => p.type === tipo)?.value || '';
  return `${obtener('day')}/${obtener('month')}/${obtener('year')} ${obtener('hour')}:${obtener('minute')}`;
}

// Auditoría 2026-09-22 (Pablo: "¿por qué el código minilab no figura en esos pedidos de
// prueba?"): mismo criterio de refuerzo que ya se aplicó a curso_codigo — nunca confiar en un
// valor derivado que mande el navegador cuando el servidor puede calcularlo solo con datos que
// ya validó. Réplica exacta de `sanitizarParaMinilab` (src/services/pedidosLabService.ts) —
// función pura de texto, sin ninguna dependencia de navegador, así que es segura de duplicar acá.
function sanitizarParaMinilabServidor(texto: string): string {
  return texto
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

/**
 * Auditoría 2026-09-22: hasta ahora el "número de lista" de cada pedido (usado sólo para armar
 * el código de minilab y ordenar los archivos del laboratorio, nunca vino de ningún padrón real
 * de la escuela) se generaba en el navegador con `Math.floor(1 + Math.random() * 25)` — un
 * número al azar en cada pedido, incluso para el MISMO alumno pagando de nuevo. Dos
 * consecuencias reales, visibles en el panel: (1) el código de minilab de un mismo alumno
 * cambiaba de pedido a pedido sin ningún motivo; (2) dos alumnos distintos del mismo curso
 * podían coincidir en el mismo número al azar, generando el mismo código de minilab para dos
 * fotos distintas (colisión real de nombre de archivo). Se reemplaza por un correlativo estable:
 * cuántos pedidos ya existen para ese mismo curso_codigo, +1 — determinístico dentro de ese
 * curso y sin depender de ningún dato que el navegador pueda inventar. No es el número de lista
 * oficial del colegio (el sistema no guarda ninguno), pero al menos dos pedidos del mismo curso
 * nunca van a coincidir en el mismo número.
 */
async function obtenerNumeroListaSecuencial(supabase: ReturnType<typeof getServerSupabase>, cursoCodigo: string): Promise<number> {
  try {
    const { count, error } = await supabase!
      .from('pedidos')
      .select('id', { count: 'exact', head: true })
      .eq('curso_codigo', cursoCodigo);
    if (error || typeof count !== 'number') return 1;
    let candidato = count + 1;

    // Auditoría 2026-09-22 (posible bug de integridad, MEDIO/BAJO — mitigación parcial): el
    // comentario original de arriba decía que "dos pedidos del mismo curso nunca van a coincidir
    // en el mismo número", pero esto sigue siendo un patrón leer-luego-escribir sin ningún lock
    // ni columna UNIQUE en la base: dos checkouts casi simultáneos del mismo curso (día de venta,
    // varios hermanos/familias comprando a la vez) pueden leer el mismo `count` y terminar con el
    // mismo `alumno_numero_lista`, duplicando el nombre de archivo del minilab. Una solución
    // realmente atómica necesita una restricción UNIQUE (curso_codigo, alumno_numero_lista) en
    // Supabase + reintento ante conflicto 23505, que requiere una migración de base de datos (no
    // se aplica sola desde acá). Como mitigación sin tocar el esquema: se vuelve a chequear que
    // el número candidato no esté ya usado justo antes de devolverlo, y si otro pedido lo tomó en
    // el medio, se corre al siguiente — esto angosta muchísimo la ventana de colisión (que ahora
    // requiere que dos requests lean Y verifiquen en el mismo instante) sin eliminarla del todo.
    for (let intento = 0; intento < 5; intento++) {
      const { data: yaExiste, error: errChequeo } = await supabase!
        .from('pedidos')
        .select('id')
        .eq('curso_codigo', cursoCodigo)
        .eq('alumno_numero_lista', candidato)
        .limit(1);
      if (errChequeo) break; // si el chequeo falla, mejor devolver el candidato que trabar el pedido
      if (!yaExiste || yaExiste.length === 0) break;
      candidato += 1;
    }
    return candidato;
  } catch {
    return 1;
  }
}

function calcularCodigoAlumnoServidor(cursoCodigo: string, numeroLista: number, alumnoNombre: string): string {
  return `${sanitizarParaMinilabServidor(cursoCodigo)}_${String(numeroLista).padStart(2, '0')}_${sanitizarParaMinilabServidor(alumnoNombre || 'ALUMNO')}`;
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

// Todas las filas de codigos_seccion (paginado: PostgREST corta en 1000 filas por consulta).
async function traerTodosLosCodigosSeccion(supabase: any): Promise<any[]> {
  return traerTodasLasFilas<any>((desde, hasta) =>
    supabase
      .from('codigos_seccion')
      .select('id, colegio_id, grado, turno, division, codigo_secreto')
      .order('id')
      .range(desde, hasta)
  );
}

// Auditoría 2026-09-23 (bug real): la validación del portal compara los códigos NORMALIZADOS (sin
// guiones ni espacios: "AB12-CD34" == "AB12CD34"), pero los chequeos de "¿este código ya lo usa
// otra sección?" comparaban el texto exacto. Los códigos generados se guardan con guion
// ("AB12-CD34") y los fijados a mano desde el panel sin él ("AB12CD34"), así que dos secciones
// distintas podían quedar con el "mismo" código — y el portal le mostraba a una familia la
// galería de OTRO curso (la primera que apareciera). Este chequeo compara igual que el portal.
async function codigoSeccionEnUso(supabase: any, codigo: string, excluirId?: string | null): Promise<boolean> {
  const buscado = normalizarCodigoSeccion(codigo);
  if (!buscado) return false;
  const filas = await traerTodosLosCodigosSeccion(supabase);
  return filas.some((fila) => fila.id !== excluirId && normalizarCodigoSeccion(fila.codigo_secreto) === buscado);
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
    if (await codigoSeccionEnUso(supabase, candidato)) {
      // Ese código ya pertenece a otra sección distinta: se descarta y se genera uno nuevo,
      // en vez de dejar que dos secciones distintas terminen compartiendo el mismo código.
      candidato = '';
    }
  }
  if (!candidato) {
    // Auditoría 2026-09-16: antes se usaba el código recién generado al azar sin chequear si ya
    // pertenecía a otra sección (ese chequeo sólo se hacía para un candidato sugerido a mano,
    // arriba) — con pocos intentos de reintento acá alcanza para blindarlo también en este caso.
    for (let intento = 0; intento < 5; intento++) {
      const propuesto = generarCodigoSecretoSeccion();
      if (!(await codigoSeccionEnUso(supabase, propuesto))) {
        candidato = propuesto;
        break;
      }
    }
    if (!candidato) candidato = generarCodigoSecretoSeccion();
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

  // Paginado y con error propagado: antes, con más de 1000 secciones, los códigos más nuevos
  // "no existían", y un error puntual de la base se informaba como "código incorrecto".
  const data = await traerTodosLosCodigosSeccion(supabase);

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
      if (!(await codigoSeccionEnUso(supabase, candidato))) {
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

    if (await codigoSeccionEnUso(supabase, codigoNormalizado, existente?.id || null)) {
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

// Auditoría 2026-09-24 (bug real en datos de producción, CRÍTICO): de las inscripciones cuyo
// alumno figura en la nómina oficial del colegio (tabla `alumnos`, cargada desde el panel), 1 de
// cada 3 quedó en una DIVISIÓN distinta a la real — casi siempre la "A" (la que el formulario
// traía preseleccionada) o "Jornada Extendida" (que el formulario ponía solo al elegir ese turno,
// cuando en la nómina esos chicos son de la división C). Como el código de acceso es por sección,
// esas familias reciben el código de OTRO curso: verían fotos de otros chicos y no las de su hijo.
// Cuando el nombre del alumno coincide sin ambigüedad con la nómina, el curso de la nómina manda.
type CursoNomina = { grado: string; turno: string | null; division: string };
async function crearBuscadorEnNomina(supabase: SupabaseClient, colegioId: string) {
  let nomina: { claves: string[]; palabras: Set<string>; curso: CursoNomina }[] | null = null;
  const cargar = async () => {
    if (nomina) return nomina;
    const filas = await traerTodasLasFilas<any>((desde, hasta) =>
      supabase.from('alumnos').select('nombre, grado, turno, division').eq('colegio_id', colegioId).order('id').range(desde, hasta)
    );
    nomina = filas
      .filter((a) => a.nombre && a.grado && a.division)
      .map((a) => {
        const clave = normalizarNombrePorPalabras(a.nombre);
        return {
          claves: [clave],
          palabras: new Set(clave.split(' ').filter(Boolean)),
          curso: { grado: String(a.grado).trim(), turno: a.turno ? String(a.turno).trim() : null, division: String(a.division).trim() },
        };
      });
    return nomina;
  };
  const mismaSeccion = (a: CursoNomina, b: CursoNomina) => a.grado === b.grado && a.division === b.division && (a.turno || '') === (b.turno || '');
  const unico = (cursos: CursoNomina[]): CursoNomina | null =>
    cursos.length > 0 && cursos.every((c) => mismaSeccion(c, cursos[0])) ? cursos[0] : null;

  return async (nombreCompleto: string, gradoEscrito?: unknown): Promise<CursoNomina | null> => {
    const clave = normalizarNombrePorPalabras(nombreCompleto);
    const palabras = clave.split(' ').filter(Boolean);
    if (palabras.length < 2) return null;
    try {
      const lista = await cargar();
      const exactos = lista.filter((a) => a.claves[0] === clave).map((a) => a.curso);
      if (exactos.length > 0) return unico(exactos);
      // La familia pudo escribir sólo uno de los nombres ("Juan Pérez" por "Juan Martín Pérez"):
      // se acepta si todas sus palabras están en un único alumno de la nómina. Como una
      // coincidencia parcial es más débil ("Juan Perez" también está contenido en "Alvarez
      // Perez, Juan Martin", de otro año), sólo se usa si además coincide el grado elegido.
      const grado = String(gradoEscrito || '').trim();
      if (!grado) return null;
      const parciales = lista
        .filter((a) => a.curso.grado === grado && palabras.every((w) => a.palabras.has(w)))
        .map((a) => a.curso);
      return unico(parciales);
    } catch (e) {
      console.warn('[inscripciones] No se pudo consultar la nómina para corregir el curso:', e);
      return null;
    }
  };
}

// Inscripción pública: valida contra el padrón autorizado del colegio y asigna código al instante si coincide.
// Todo el acceso a `padres_autorizados` e `inscripciones` pasa exclusivamente por acá, del lado del servidor
// (con la Service Role Key) — el navegador nunca consulta esas tablas directamente.
// Auditoría 2026-09-23: este endpoint público no tenía límite de frecuencia (manda correos y
// escribe en la base), a diferencia del resto de los formularios públicos.
app.post('/api/inscripciones/validar', limitarFrecuencia('inscripciones-validar', 40, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const {
      colegioId,
      colegioNombre,
      padreNombre,
      padreDni,
      telefonoWhatsApp,
      email,
      alumnoNombre,
      alumnoApellido,
      alumnoDni,
      grado,
      division,
      turno,
      solicitaFotoHermanos,
      hermanos: hermanosRecibidos
    } = req.body || {};
    // Tope defensivo: un array enorme de "hermanos" se guardaba entero en la fila (jsonb).
    const hermanos = Array.isArray(hermanosRecibidos) ? hermanosRecibidos.slice(0, 10) : [];

    if (!padreNombre || !alumnoNombre || !colegioId || !telefonoWhatsApp || !email) {
      return res.status(400).json({ success: false, error: 'Faltan datos obligatorios para la inscripción' });
    }
    const alumnoDniLimpio = String(alumnoDni || '').replace(/\D/g, '');
    if (alumnoDniLimpio.length < 6 || alumnoDniLimpio.length > 9) {
      return res.status(400).json({ success: false, error: 'El DNI del alumno/a no es válido' });
    }
    // Auditoría 2026-09-22 (pedido de Pablo, ronda 2 — el formulario de inscripción todavía no
    // pedía el DNI del tutor, sólo se lo agregué al ingreso posterior): se pide acá también, de
    // entrada, para que quede cargado desde el primer momento y no dependa de identificar por
    // nombre en el primer ingreso (ver `/api/inscripciones/buscar`) — ese camino por nombre
    // queda sólo como respaldo para las familias aprobadas ANTES de este cambio.
    const padreDniLimpio = normalizarDniServidor(padreDni);
    if (padreDniLimpio.length < 6 || padreDniLimpio.length > 9) {
      return res.status(400).json({ success: false, error: 'El DNI del padre, madre o tutor no es válido' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const colegioReal = await buscarColegioReal(supabase, colegioId);
    if (!colegioReal) {
      return res.status(400).json({ success: false, error: ERROR_COLEGIO_NO_VALIDO });
    }

    const telDigits = normalizarTelefonoServidor(telefonoWhatsApp);
    const telUltimos = telDigits.length >= 8 ? telDigits.slice(-8) : telDigits;
    const cleanEmail = String(email || '').trim().toLowerCase();

    let matchPadre: any = null;
    let candidatosPadron: any[] = [];
    try {
      // Paginado: un colegio grande supera las 1000 filas de padrón y la coincidencia se perdía.
      const candidatos = await traerTodasLasFilas<any>((desde, hasta) =>
        supabase
          .from('padres_autorizados')
          .select('*')
          .eq('colegio_id', colegioId)
          .eq('usado', false)
          .order('id')
          .range(desde, hasta)
      );

      if (Array.isArray(candidatos)) {
        candidatosPadron = candidatos;
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

    // Auditoría 2026-09-21 (refuerzo — hallazgo: hermanos nunca se reconciliaban contra el
    // padrón, a diferencia del alumno principal). Antes, el array "hermanos" se guardaba tal
    // cual lo mandara el navegador — grado/turno/división (e incluso colegioId) totalmente
    // inventados por quien completa el formulario. Como `/api/familia/hijos` resuelve (y CREA
    // si no existe) el código secreto real de cualquier grado/turno/división que le pidan para
    // cada "hermano" sin ninguna verificación, esto permitía que una familia YA aprobada (un
    // estado perfectamente normal, no un ataque sofisticado) agregara un "hermano" inventado
    // con la sección de otro curso — o de otro colegio — y se le devolviera el código secreto
    // real de esa sección ajena, sin pasar por ninguna revisión. Mismo criterio que ya se aplica
    // al alumno principal (matchPadre, más arriba): el colegio SIEMPRE es el de esta inscripción
    // (nunca el que declare el hermano), y si hay una fila del padrón oficial de ESTE colegio con
    // el mismo contacto (teléfono/email) y un nombre que matchea, su grado/turno/división real
    // manda por sobre lo que haya tipeado la familia — igual que ya ocurre con el alumno
    // principal cuando el padrón trae esos datos cargados.
    const cursoEnNomina = await crearBuscadorEnNomina(supabase, colegioReal.id);
    const hermanosReconciliados = await Promise.all((Array.isArray(hermanos) ? hermanos : []).map(async (h: any) => {
      const nombreCompletoHermano = normalizarNombrePorPalabras(`${h?.alumnoNombre || ''} ${h?.alumnoApellido || ''}`);
      const matchHermano = nombreCompletoHermano
        ? candidatosPadron.find((p: any) => normalizarNombrePorPalabras(p.alumno_nombre) === nombreCompletoHermano)
        : null;
      const nominaHermano = await cursoEnNomina(`${h?.alumnoNombre || ''} ${h?.alumnoApellido || ''}`, h?.grado);
      return {
        ...h,
        colegioId, // nunca el que venga en el hermano: siempre el colegio de esta inscripción
        grado: (matchHermano?.grado && String(matchHermano.grado).trim()) || nominaHermano?.grado || h?.grado,
        turno: (matchHermano?.turno && String(matchHermano.turno).trim()) || nominaHermano?.turno || h?.turno,
        division: (matchHermano?.division && String(matchHermano.division).trim()) || nominaHermano?.division || h?.division,
      };
    }));

    // Buscar si esta misma familia (mismo colegio + mismo WhatsApp o email) ya tiene una
    // inscripción cargada, para actualizarla en vez de crear un duplicado (por ejemplo, cuando
    // la familia usa "Modificar datos de inscripción" y vuelve a enviar el formulario).
    let inscripcionExistente: any = null;
    try {
      // Paginado: con más de 1000 inscripciones en el colegio, la existente podía no aparecer y
      // se creaba un duplicado.
      const existentes = await traerTodasLasFilas<any>((desde, hasta) =>
        supabase
          .from('inscripciones')
          .select('*')
          .eq('colegio_id', colegioId)
          .neq('estado', 'rechazado')
          .order('id')
          .range(desde, hasta)
      );

      if (Array.isArray(existentes)) {
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
    const fechaStr = formatearFechaHoraArgentina(now);

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
    // Orden de prioridad del curso: padrón (si trae curso) > nómina oficial (ver
    // crearBuscadorEnNomina) > lo que eligió la familia en el formulario.
    const cursoNominaPrincipal = await cursoEnNomina(`${alumnoNombre || ''} ${alumnoApellido || ''}`, grado);
    const gradoAprobado = (matchPadre?.grado && String(matchPadre.grado).trim()) || cursoNominaPrincipal?.grado || grado;
    const turnoAprobado = (matchPadre?.turno && String(matchPadre.turno).trim()) || cursoNominaPrincipal?.turno || turno;
    const divisionAprobada = (matchPadre?.division && String(matchPadre.division).trim()) || cursoNominaPrincipal?.division || division;

    // Auditoría 2026-09-16 (hallazgo reportado por Pablo): si una familia YA aprobada vuelve a
    // completar este formulario público pero esta vez el curso (colegio/grado/turno/división)
    // quedó distinto al que tenía guardado — corrigió un error de tipeo, el alumno cambió de
    // sección, etc. — antes se seguía usando el `codigo_asignado` VIEJO (el de la sección
    // anterior) aunque la fila quedara con el grado/turno/división nuevos. Eso dejaba a esa
    // familia con un código que en realidad pertenece a OTRA sección — y por lo tanto a otras
    // familias — mostrándole datos de gente que no tiene nada que ver (y viceversa: la sección
    // nueva real de esta familia nunca llegaba a tener su propio código creado). Ahora, si el
    // curso cambió, se pide (o crea) el código real de la sección nueva en vez de arrastrar el
    // anterior.
    // Auditoría 2026-09-23 (bug de seguridad, ALTO): acá antes se regeneraba el código si una
    // familia YA aprobada reenviaba el formulario con otro curso. Se quitó: una inscripción
    // aprobada ya no se modifica desde el formulario público (ver `congelarInscripcionAprobada`
    // más abajo) — el cambio de curso de una familia aprobada lo hace el fotógrafo desde el panel.

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
            colegioNombre: colegioReal.nombre,
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
        // Se reenvía con los datos YA GUARDADOS (los que aprobó el fotógrafo), no con lo tipeado.
        const resultadoReenvio = await enviarCorreoCodigoAcceso({
          to: String(inscripcionExistente.email).trim().toLowerCase(),
          padreNombre: String(inscripcionExistente.padre_nombre || padreNombre).trim(),
          colegioNombre: String(inscripcionExistente.colegio_nombre || colegioNombre || 'Colegio').trim(),
          codigo: codigoAcceso,
          alumnos: [{
            nombre: String(inscripcionExistente.alumno_nombre || '').trim(),
            apellido: String(inscripcionExistente.alumno_apellido || '').trim(),
            grado: inscripcionExistente.grado,
            division: inscripcionExistente.division,
            turno: inscripcionExistente.turno,
          }],
          solicitaFotoHermanos: Boolean(inscripcionExistente.solicita_foto_hermanos),
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
      padre_dni: padreDniLimpio,
      telefono_whatsapp: telefonoGuardado,
      email: emailGuardado,
      alumno_nombre: String(alumnoNombre).trim(),
      alumno_apellido: String(alumnoApellido || '').trim(),
      alumno_dni: alumnoDniLimpio,
      // El curso corregido (padrón/nómina) se guarda también en las pendientes: así, cuando el
      // fotógrafo la aprueba desde el panel, el código que se genera es el de la sección real.
      turno: String(turnoAprobado || 'Mañana').trim(),
      grado: String(gradoAprobado || 'Sala 3 años').trim(),
      division: String(divisionAprobada || 'A').trim(),
      colegio_id: colegioReal.id,
      colegio_nombre: colegioReal.nombre,
      estado,
      codigo_asignado: codigoAcceso,
      codigo_familiar: codigoAcceso,
      solicita_foto_hermanos: Boolean(solicitaFotoHermanos || (hermanos && hermanos.length > 0)),
      hermanos: hermanosReconciliados,
      fecha_inscripcion: inscripcionExistente?.fecha_inscripcion || fechaStr,
      fecha_aprobacion: estado === 'aceptado' ? (inscripcionExistente?.fecha_aprobacion || fechaStr) : null,
      notificacion_whatsapp_enviada: inscripcionExistente ? Boolean(inscripcionExistente.notificacion_whatsapp_enviada) : false,
      notificacion_email_enviada: emailEnviado || (inscripcionExistente ? Boolean(inscripcionExistente.notificacion_email_enviada) : false),
    };

    // Auditoría 2026-09-23 (bug de seguridad, ALTO): una inscripción YA APROBADA se encuentra
    // acá sólo por teléfono o email — datos que no son secretos (los tiene cualquiera del grupo
    // de WhatsApp del curso). Antes, reenviar este formulario público con el teléfono de otra
    // familia aprobada REESCRIBÍA su fila: nombre y DNI del tutor (el DNI es lo que ahora se usa
    // para ingresar al portal), alumnos, hermanos y hasta el curso (regenerando el código). Con
    // eso alguien podía (a) apropiarse del acceso de esa familia poniendo su propio DNI, o (b)
    // agregarle un "hermano" en cualquier otro curso y obtener el código real de ese curso vía
    // /api/familia/hijos. Ahora una inscripción aprobada NO se modifica desde el formulario
    // público: sólo se le reenvía el código a su correo ya validado. Cualquier corrección de
    // datos de una familia aprobada la hace el fotógrafo desde el panel.
    const congelarInscripcionAprobada = inscripcionExistente?.estado === 'aceptado';
    const filaAGuardar: Record<string, any> = congelarInscripcionAprobada
      ? { notificacion_email_enviada: inscripcionRow.notificacion_email_enviada }
      : inscripcionRow;

    let resultadoFila: any = null;
    let errGuardar: any = null;

    if (inscripcionExistente?.id) {
      const { data: actualizada, error } = await supabase
        .from('inscripciones')
        .update(filaAGuardar)
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
    // Auditoría 2026-09-23 (bug de privacidad, ALTO): cuando el formulario coincide (por teléfono o
    // email, datos NO secretos) con una inscripción YA APROBADA, `resultadoFila` es la fila de ESA
    // familia — que puede no ser quien completó el formulario. Se devolvía completa: DNI del tutor
    // (la llave que hoy se usa junto al código del curso para entrar al portal), DNI del alumno,
    // email, teléfono y hermanos. Ahora, en ese caso, sólo viaja lo mínimo para mostrar la pantalla
    // de "revisá tu correo", con los nombres que escribió quien envió el formulario.
    // Lo mismo aplica a una aprobación automática recién hecha: el email/teléfono guardados son
    // los del padrón oficial, no necesariamente los que escribió quien completó el formulario.
    const inscripcionRespuesta = estado === 'aceptado'
      ? {
          id: inscripcionSinCodigo.id,
          estado: inscripcionSinCodigo.estado,
          colegio_id: inscripcionSinCodigo.colegio_id,
          colegio_nombre: inscripcionSinCodigo.colegio_nombre,
          padre_nombre: String(padreNombre).trim(),
          alumno_nombre: String(alumnoNombre).trim(),
          alumno_apellido: String(alumnoApellido || '').trim(),
          grado: congelarInscripcionAprobada ? String(grado || '') : inscripcionSinCodigo.grado,
          division: congelarInscripcionAprobada ? String(division || '') : inscripcionSinCodigo.division,
          turno: congelarInscripcionAprobada ? String(turno || '') : inscripcionSinCodigo.turno,
          // Sólo los nombres que escribió quien envió el formulario (para el "y N hermanos más").
          hermanos: (Array.isArray(hermanos) ? hermanos : []).map((h: any, idx: number) => ({
            id: String(h?.id || `hermano-${idx}`),
            alumnoNombre: String(h?.alumnoNombre || ''),
            alumnoApellido: String(h?.alumnoApellido || ''),
          })),
        }
      : inscripcionSinCodigo;
    return res.json({
      success: true,
      estado,
      emailEnviado,
      // El correo destino de una familia ya aprobada tampoco se muestra completo (ver arriba).
      emailDestino: emailEnviado && emailDestinoNotificacion
        ? (emailDestinoNotificacion === cleanEmail ? emailDestinoNotificacion : enmascararEmailServidor(emailDestinoNotificacion))
        : null,
      inscripcion: inscripcionRespuesta,
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
app.post('/api/inscripciones/buscar', limitarFrecuencia('inscripciones-buscar', 40, 10 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { query, tutorNombre, dni } = req.body || {};
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

    // Paso 1: ¿lo que se escribió ES el código real? Coincidencia exacta = prueba de posesión
    // del código, pero ya no alcanza sola.
    // Auditoría 2026-09-16 (hallazgo en vivo, Pablo probando el sitio como un cliente más):
    // este código lo puede compartir MÁS DE UNA familia a propósito — es, en los hechos, el
    // código de la sección (colegio+grado+turno+división) que el colegio reparte por WhatsApp a
    // todo el curso.
    // Auditoría 2026-09-22 (pedido explícito de Pablo: "que cada vez que vayan a ingresar, lo
    // hagan con nombre y apellido del padre/tutor/encargado, el DNI del padre/tutor/encargado, y
    // el código generado... con eso solucionamos el problema de que con un solo código por curso
    // no se crucen los datos de los alumnos al momento de ingresar"): ya no alcanza con acertar
    // el código — TODAS las familias que comparten sección lo tienen — así que ahora se piden
    // SIEMPRE, código + nombre del tutor + DNI del tutor juntos, y se buscan TODAS las filas de
    // ese código (no sólo 2) para poder identificar exactamente cuál es. Como el DNI del tutor es
    // un campo nuevo (`padre_dni`) que ninguna de las familias ya aprobadas cargó todavía, el
    // primer ingreso de cada una se resuelve por nombre (comparado sin importar tildes/orden de
    // palabras) y ese DNI se guarda ahí mismo para que los ingresos siguientes ya lo validen
    // directo, sin depender más del nombre.
    let candidatos: any[] = [];
    const tryEqCodigoTodas = async (column: string, value: string) => {
      if (candidatos.length || !value) return;
      const { data } = await supabase.from('inscripciones').select('*').eq(column, value);
      if (data && data.length > 0) candidatos = data;
    };
    await tryEqCodigoTodas('codigo_asignado', qUpper);
    await tryEqCodigoTodas('codigo_familiar', qUpper);
    // Auditoría 2026-09-23: la galería (/api/fotos) acepta el código con o sin guion/espacios, pero
    // acá se exigía el texto exacto — una familia que tipeaba "AB12CD34" en vez de "AB12-CD34" (o
    // al revés, para códigos fijados a mano) recibía "código no encontrado". Se prueban también
    // las variantes normalizadas.
    const qNormalizado = normalizarCodigoSeccion(q);
    if (qNormalizado.length >= 4) {
      const variantes = [qNormalizado];
      if (qNormalizado.length === 8) variantes.push(`${qNormalizado.slice(0, 4)}-${qNormalizado.slice(4)}`);
      for (const variante of variantes) {
        if (variante === qUpper) continue;
        await tryEqCodigoTodas('codigo_asignado', variante);
        await tryEqCodigoTodas('codigo_familiar', variante);
      }
    }

    if (candidatos.length > 0) {
      const soloCurso = (fila: any) => ({
        estado: fila.estado,
        codigo_asignado: fila.codigo_asignado,
        codigo_familiar: fila.codigo_familiar,
        colegio_id: fila.colegio_id,
        colegio_nombre: fila.colegio_nombre,
        grado: fila.grado,
        division: fila.division,
        turno: fila.turno,
      });

      const tutorNombreInput = String(tutorNombre || '').trim();
      const dniInput = normalizarDniServidor(dni);

      if (!tutorNombreInput || dniInput.length < 6) {
        return res.json({
          success: true,
          requiereDatosTutor: true,
          inscripcion: soloCurso(candidatos[0]),
        });
      }

      // 1) ¿alguna fila ya tiene guardado justo este DNI? (ingresos posteriores al primero)
      let match = candidatos.find((c: any) => c.padre_dni && normalizarDniServidor(c.padre_dni) === dniInput) || null;

      // 2) si ninguna lo tenía guardado, se identifica por nombre entre las que todavía no
      // tienen DNI cargado — y, si hay una sola que coincide, se aprovecha para guardárselo.
      if (!match) {
        const nombreNormEntrada = normalizarNombrePorPalabras(tutorNombreInput);
        const porNombre = candidatos.filter(
          (c: any) => !c.padre_dni && normalizarNombrePorPalabras(c.padre_nombre) === nombreNormEntrada && nombreNormEntrada.length > 0
        );
        if (porNombre.length === 1) {
          match = porNombre[0];
          try {
            await supabase.from('inscripciones').update({ padre_dni: dniInput }).eq('id', match.id);
            match.padre_dni = dniInput;
          } catch (e) {
            console.warn('No se pudo guardar el DNI del tutor en /api/inscripciones/buscar:', e);
          }
        }
      }

      if (!match) {
        return res.json({
          success: true,
          requiereDatosTutor: true,
          datosNoCoinciden: true,
          inscripcion: soloCurso(candidatos[0]),
        });
      }

      return res.json({ success: true, inscripcion: match });
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
      // Todavía no tiene código asignado: se informa el estado. Auditoría 2026-09-23 (privacidad):
      // antes se devolvía la fila completa a quien escribiera un teléfono/email ajeno — incluidos
      // el DNI del tutor (que después, junto al código del curso, es la llave para entrar al
      // portal) y los DNI de los chicos. La pantalla sólo necesita nombres, curso y estado.
      const { padre_dni: _dniTutorOculto, alumno_dni: _dniAlumnoOculto, hermanos: hermanosFila, ...pendienteSinDni } = porContacto;
      const hermanosSinDni = Array.isArray(hermanosFila)
        ? hermanosFila.map(({ alumnoDni: _dniHermanoOculto, ...h }: any) => h)
        : [];
      return res.json({ success: true, inscripcion: { ...pendienteSinDni, hermanos: hermanosSinDni } });
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

// Auditoría 2026-09-16 (pedido de Pablo: la web y el mail de aprobación prometen "1 solo Código
// Familiar... vas a poder ver a todos tus hijos y alternar entre ellos con un solo toque", pero
// el Código Familiar siempre fue, en los hechos, el código de la sección del hijo PRINCIPAL
// nada más — cada hermano ya se guardaba con su propio grado/turno/división al inscribirse
// (columna `hermanos`, ver `AlumnoHermano`), pero nunca se le generaba ni resolvía un código de
// su propia sección, así que no había forma real de ver su galería con el mismo código. Este
// endpoint es el que le faltaba: dado el Código Familiar ya validado, devuelve el hijo principal
// + cada hermano con SU PROPIO código real de sección (generándolo recién ahora si esa sección
// todavía no tenía uno, con la misma función que ya usa "Códigos y difusión"). El frontend
// (`PortalFamiliasModal.tsx`) usa esto para poder alternar la galería mostrada sin pedirle a la
// familia un código distinto por cada hijo — nunca se le entrega grado/turno/división "en
// crudo" al navegador como si fuera la llave: la llave sigue siendo siempre un código secreto.
app.get('/api/familia/hijos', limitarFrecuencia('familia-hijos', 100, 10 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const codigo = String(req.query.codigo || '').trim().toUpperCase();
    if (!codigo) {
      return res.status(400).json({ success: false, error: 'Falta el código familiar.' });
    }
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });

    // Auditoría 2026-09-22 (mismo código de sección compartido por todo el curso, ver
    // `/api/inscripciones/buscar` más arriba): este endpoint pedía la fila con `.limit(1)`, así
    // que si dos o más familias comparten `codigo_asignado` (lo normal, es el código del curso)
    // siempre devolvía los hijos de la PRIMERA que apareciera en la tabla — no necesariamente la
    // familia que está mirando la pantalla. Ahora se piden TODAS las filas de ese código y, si
    // hay más de una, se identifica la correcta por el DNI del tutor (`padre_dni`, ya validado en
    // `/api/inscripciones/buscar` antes de llegar acá) — si por algún motivo no llega o no
    // coincide, se cae de nuevo a la primera fila en vez de romper la pantalla.
    const dniQuery = normalizarDniServidor(req.query.dni);
    const { data: filas } = await supabase
      .from('inscripciones')
      .select('id, colegio_id, colegio_nombre, alumno_nombre, alumno_apellido, grado, division, turno, estado, codigo_asignado, padre_dni, hermanos')
      .eq('codigo_asignado', codigo);

    if (!filas || filas.length === 0) {
      return res.status(404).json({ success: false, error: 'Código familiar no encontrado o todavía no aprobado.' });
    }
    // Auditoría 2026-09-23 (bug de privacidad, ALTO): antes, si el DNI no llegaba o no coincidía,
    // se "caía de nuevo a la primera fila" — o sea, a los hijos de OTRA familia del mismo curso
    // (el mismo síntoma de "no sé quién es Juan Perez"). Peor: la respuesta incluye el código
    // real de sección de cada hermano, así que cualquiera con el código del curso podía obtener
    // los códigos de los cursos de los hermanos de otra familia y ver esas fotos. Ahora:
    //  - si la fila tiene DNI del tutor cargado, hay que mandar ESE DNI;
    //  - si hay varias familias con el mismo código, hay que mandar el DNI (sin DNI no se puede
    //    saber cuál es) — nunca se elige una "por defecto".
    const coincidenDni = (f: any) => f.padre_dni && dniQuery.length >= 6 && normalizarDniServidor(f.padre_dni) === dniQuery;
    let fila: any = filas.find(coincidenDni) || null;
    if (!fila && filas.length === 1 && !filas[0].padre_dni) {
      // Único caso sin DNI: familia vieja (antes del 22/9) con un código que no comparte nadie.
      fila = filas[0];
    }
    if (!fila) {
      return res.status(403).json({
        success: false,
        requiereDatosTutor: true,
        error: 'Para ver a tus hijos/as necesitamos identificarte con el nombre y DNI del tutor. Volvé a ingresar.',
      });
    }

    if (!fila || fila.estado !== 'aceptado' || !fila.codigo_asignado) {
      return res.status(404).json({ success: false, error: 'Código familiar no encontrado o todavía no aprobado.' });
    }

    const candidatos = [
      {
        id: 'principal',
        nombreCompleto: `${fila.alumno_nombre || ''} ${fila.alumno_apellido || ''}`.trim() || 'Alumno/a',
        colegioId: fila.colegio_id,
        colegioNombre: fila.colegio_nombre,
        grado: fila.grado,
        turno: fila.turno,
        division: fila.division,
      },
      ...((Array.isArray(fila.hermanos) ? fila.hermanos : []) as any[]).map((h: any, idx: number) => ({
        id: h?.id || `hermano-${idx}`,
        nombreCompleto: `${h?.alumnoNombre || ''} ${h?.alumnoApellido || ''}`.trim() || 'Hermano/a',
        colegioId: h?.colegioId || fila.colegio_id,
        colegioNombre: h?.colegioNombre || fila.colegio_nombre,
        grado: h?.grado,
        turno: h?.turno,
        division: h?.division,
      })),
    ].filter((c) => c.colegioId && c.grado && c.turno);

    const hijos = await Promise.all(
      candidatos.map(async (c) => {
        const codigoSeccion = await obtenerOCrearCodigoSeccion(supabase, c.colegioId, c.grado, c.turno, c.division || '');
        return {
          id: c.id,
          nombreCompleto: c.nombreCompleto,
          colegioNombre: c.colegioNombre,
          grado: c.grado,
          turno: c.turno,
          division: c.division,
          codigoSeccion,
        };
      })
    );

    return res.json({ success: true, hijos });
  } catch (err: any) {
    console.error('Error al resolver los hijos del código familiar:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al resolver los hijos de esta familia' });
  }
});

// --- Rutas de administración de inscripciones y padrón (protegidas con requireAdminAuth) ---

app.get('/api/admin/inscripciones', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const data = await traerTodasLasFilas((desde, hasta) =>
      supabase.from('inscripciones').select('*').order('created_at', { ascending: false }).order('id').range(desde, hasta)
    );
    return res.json({ success: true, inscripciones: data });
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
    const fechaStr = formatearFechaHoraArgentina(now);

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

// Auditoría 2026-09-22 (pedido de Pablo: "como hago para eliminar a un inscripto?"): antes NO
// existía ninguna forma de borrar una fila de `inscripciones` — "Rechazar" (arriba) sólo cambia
// el estado a "rechazado" y sólo está disponible para inscripciones pendientes; una ya aprobada
// se quedaba en el listado para siempre. Este DELETE borra directamente la fila de `inscripciones`
// (pendiente, rechazada o aprobada). Es seguro: aprobar una inscripción sólo actualiza esta misma
// fila (ver POST .../aprobar más arriba) — NO crea filas en `familias`/`alumnos`/`pedidos`, esas
// se crean recién cuando la familia usa su Código Familiar desde el Portal — así que borrar acá
// nunca borra en cascada pedidos, fotos ni el acceso que la familia ya haya generado.
app.delete('/api/admin/inscripciones/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const { error } = await supabase.from('inscripciones').delete().eq('id', id);
    if (error) throw error;
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al eliminar la inscripción' });
  }
});

app.get('/api/admin/padron', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const colegioId = req.query.colegioId as string | undefined;
    const data = await traerTodasLasFilas((desde, hasta) => {
      let builder = supabase.from('padres_autorizados').select('*').order('created_at', { ascending: false }).order('id');
      if (colegioId) {
        builder = builder.eq('colegio_id', colegioId);
      }
      return builder.range(desde, hasta);
    });
    return res.json({ success: true, padron: data });
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
  if (!compararTimingSafe(String(codigo).trim().toUpperCase(), String(colegio.codigo_padron).trim().toUpperCase())) {
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
  const existentes = await traerTodasLasFilas<any>((desde, hasta) =>
    supabase
      .from('padres_autorizados')
      .select('email, telefono')
      .eq('colegio_id', colegioId)
      .order('id')
      .range(desde, hasta)
  );

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
// Auditoría 2026-09-21 (refuerzo): endpoint público sin autenticación más allá del código de la
// URL — sin límite de frecuencia, se podía probar por fuerza bruta un código de padrón válido.
app.get('/api/padron/institucion/:colegioId', limitarFrecuencia('padron-institucion-get', 20, 10 * 60 * 1000), async (req: Request, res: Response) => {
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
app.post('/api/padron/institucion/:colegioId', limitarFrecuencia('padron-institucion-post', 20, 10 * 60 * 1000), async (req: Request, res: Response) => {
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
// Auditoría 2026-09-21 (refuerzo): mismo motivo que /api/padron/institucion — es un lookup
// público por código, sin límite de frecuencia se podía probar por fuerza bruta.
app.get('/api/padron/link/:codigo', limitarFrecuencia('padron-link-get', 20, 10 * 60 * 1000), async (req: Request, res: Response) => {
  const { codigo } = req.params;
  const resultado = await resolverColegioPorCodigoPadron(codigo);
  if (!resultado.ok) {
    return res.status(resultado.status).json({ success: false, error: resultado.error });
  }
  return res.json({ success: true, colegioNombre: resultado.colegio.nombre });
});

app.post('/api/padron/link/:codigo', limitarFrecuencia('padron-link-post', 20, 10 * 60 * 1000), async (req: Request, res: Response) => {
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
// 4C. CONSULTAS DE FAMILIAS (formulario público + bandeja administrativa)
// La web nunca escribe directamente en Supabase: valida, limita intentos y usa el cliente
// privado del servidor. La tabla no concede ningún permiso a anon/authenticated.
// ==============================================================================

app.post('/api/consultas-familias', limitarFrecuencia('consultas-familias', 10, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { nombre, email, telefono, colegio, numeroPedido, asunto, mensaje, sitioWeb } = req.body || {};
    if (String(sitioWeb || '').trim()) return res.json({ success: true });

    const datos = {
      nombre: String(nombre || '').trim(),
      email: String(email || '').trim().toLowerCase(),
      telefono: String(telefono || '').trim(),
      colegio: String(colegio || '').trim(),
      numeroPedido: String(numeroPedido || '').trim(),
      asunto: String(asunto || '').trim(),
      mensaje: String(mensaje || '').trim(),
    };
    if (datos.nombre.length < 2 || datos.nombre.length > 120) return res.status(400).json({ success: false, error: 'Revisá el nombre ingresado.' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(datos.email) || datos.email.length > 254) return res.status(400).json({ success: false, error: 'Ingresá un email válido.' });
    if (datos.asunto.length < 2 || datos.asunto.length > 160) return res.status(400).json({ success: false, error: 'Seleccioná un motivo válido.' });
    if (datos.mensaje.length < 5 || datos.mensaje.length > 3000) return res.status(400).json({ success: false, error: 'El mensaje debe tener entre 5 y 3000 caracteres.' });
    if (datos.telefono.length > 50 || datos.colegio.length > 160 || datos.numeroPedido.length > 80) return res.status(400).json({ success: false, error: 'Uno de los datos ingresados es demasiado largo.' });

    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'El servicio de consultas no está disponible.' });

    const { data: consulta, error } = await supabase.from('consultas_familias').insert({
      nombre: datos.nombre,
      email: datos.email,
      telefono: datos.telefono || null,
      colegio: datos.colegio || null,
      numero_pedido: datos.numeroPedido || null,
      asunto: datos.asunto,
      mensaje: datos.mensaje,
      estado: 'nueva',
      origen: 'web',
    }).select('id').single();
    if (error) throw error;

    const resend = getResendClient();
    if (resend) {
      const destino = process.env.CONSULTAS_EMAIL || resendReplyTo;
      const detalle = [
        datos.colegio ? `<p><strong>Colegio:</strong> ${escapeHtml(datos.colegio)}</p>` : '',
        datos.numeroPedido ? `<p><strong>Pedido:</strong> ${escapeHtml(datos.numeroPedido)}</p>` : '',
        datos.telefono ? `<p><strong>Teléfono:</strong> ${escapeHtml(datos.telefono)}</p>` : '',
      ].join('');
      const aviso = await resend.emails.send({
        from: process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>',
        replyTo: datos.email,
        to: [destino],
        subject: `Nueva consulta web: ${datos.asunto}`,
        html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a"><h2>Nueva consulta de una familia</h2><p><strong>Nombre:</strong> ${escapeHtml(datos.nombre)}</p><p><strong>Email:</strong> ${escapeHtml(datos.email)}</p>${detalle}<p><strong>Motivo:</strong> ${escapeHtml(datos.asunto)}</p><div style="padding:16px;background:#f8fafc;border:1px solid #e2e8f0;border-radius:12px;white-space:pre-wrap">${escapeHtml(datos.mensaje)}</div><p style="font-size:12px;color:#64748b">Consulta ${escapeHtml(consulta.id)} · También está disponible en el panel administrativo.</p></div>`,
      });
      if (aviso.error) console.error('[Consultas] No se pudo enviar el aviso por email:', aviso.error);
    }

    return res.status(201).json({ success: true });
  } catch (err: any) {
    console.error('[Consultas] Error al guardar consulta:', err);
    return res.status(500).json({ success: false, error: 'No pudimos guardar tu consulta. Intentá nuevamente.' });
  }
});

app.get('/api/admin/consultas-familias', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
    const estado = String(req.query.estado || 'nueva');
    const estadosValidos = ['nueva', 'en_proceso', 'resuelta', 'todas'];
    if (!estadosValidos.includes(estado)) return res.status(400).json({ success: false, error: 'Estado inválido.' });
    let query = supabase.from('consultas_familias').select('*, consultas_familias_mensajes(*)').order('created_at', { ascending: false }).limit(500);
    if (estado !== 'todas') query = query.eq('estado', estado);
    const { data, error } = await query;
    if (error) throw error;
    return res.json({ success: true, consultas: data || [] });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'No se pudieron obtener las consultas.' });
  }
});

app.patch('/api/admin/consultas-familias/:id/estado', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const estado = String(req.body?.estado || '');
    if (!['nueva', 'en_proceso', 'resuelta'].includes(estado)) return res.status(400).json({ success: false, error: 'Estado inválido.' });
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
    const { data, error } = await supabase.from('consultas_familias').update({ estado, updated_at: new Date().toISOString() }).eq('id', req.params.id).select('id').single();
    if (error) throw error;
    return res.json({ success: true, consulta: data });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'No se pudo actualizar la consulta.' });
  }
});

app.delete('/api/admin/consultas-familias/:id', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
    const { id } = req.params;

    await supabase.from('consultas_familias_mensajes').delete().eq('consulta_id', id);
    const { error } = await supabase.from('consultas_familias').delete().eq('id', id);
    if (error) throw error;

    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'No se pudo eliminar la consulta.' });
  }
});

app.post('/api/admin/consultas-familias/:id/responder', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const mensaje = String(req.body?.mensaje || '').trim();
    if (mensaje.length < 2 || mensaje.length > 5000) {
      return res.status(400).json({ success: false, error: 'La respuesta debe tener entre 2 y 5000 caracteres.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
    const { data: consulta, error } = await supabase
      .from('consultas_familias')
      .select('id,nombre,email,asunto,estado')
      .eq('id', req.params.id)
      .single();
    if (error || !consulta) return res.status(404).json({ success: false, error: 'No encontramos la consulta.' });

    const resend = getResendClient();
    if (!resend) return res.status(503).json({ success: false, error: 'El servicio de email no está configurado.' });
    const resultado = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>',
      replyTo: `consulta-${consulta.id}@${process.env.RESEND_INBOUND_DOMAIN || 'respuestas.retratoescolar.com.ar'}`,
      to: [consulta.email],
      subject: `Re: ${consulta.asunto}`,
      html: `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a"><p>Hola ${escapeHtml(consulta.nombre)},</p><div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(mensaje)}</div><p style="margin-top:24px">Saludos,<br><strong>Retrato Escolar</strong></p><hr style="margin:24px 0;border:0;border-top:1px solid #e2e8f0"><p style="font-size:12px;color:#64748b">Podés responder directamente a este correo si necesitás continuar la conversación.</p></div>`,
    });
    if (resultado.error) throw resultado.error;

    const { error: messageError } = await supabase.from('consultas_familias_mensajes').insert({
      consulta_id: consulta.id,
      direccion: 'saliente',
      remitente: process.env.RESEND_FROM_EMAIL || 'fotos@retratoescolar.com.ar',
      destinatario: consulta.email,
      asunto: `Re: ${consulta.asunto}`,
      contenido: mensaje,
      resend_email_id: resultado.data?.id || null,
    });
    if (messageError) console.error('[Consultas] El correo se envió, pero no se guardó en el historial:', messageError);

    if (consulta.estado === 'nueva') {
      const { error: updateError } = await supabase
        .from('consultas_familias')
        .update({ estado: 'en_proceso', updated_at: new Date().toISOString() })
        .eq('id', consulta.id);
      if (updateError) console.error('[Consultas] La respuesta se envió, pero no se actualizó el estado:', updateError);
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Consultas] Error al responder:', err);
    return res.status(500).json({ success: false, error: 'No pudimos enviar la respuesta. Intentá nuevamente.' });
  }
});

// Redacta un borrador de respuesta con IA para que el fotógrafo lo revise y envíe a mano
// desde el botón "Responder" de arriba — esta ruta NUNCA envía el mensaje ni lo guarda en
// consultas_familias_mensajes, solo devuelve el texto sugerido.
app.post(
  '/api/admin/consultas-familias/:id/sugerir-respuesta',
  requireAdminAuth,
  limitarFrecuencia('sugerir-respuesta', 20, 10 * 60 * 1000),
  async (req: Request, res: Response) => {
    try {
      const gemini = getGeminiClient();
      if (!gemini) {
        return res.status(503).json({ success: false, error: 'La IA no está configurada (falta GEMINI_API_KEY en el servidor).' });
      }

      const supabase = getServerSupabase();
      if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
      const { data: consulta, error } = await supabase
        .from('consultas_familias')
        .select('id,nombre,colegio,numero_pedido,asunto,mensaje,consultas_familias_mensajes(direccion,contenido,created_at)')
        .eq('id', req.params.id)
        .single();
      if (error || !consulta) return res.status(404).json({ success: false, error: 'No encontramos la consulta.' });

      const historial = (consulta.consultas_familias_mensajes || [])
        .sort((a: any, b: any) => String(a.created_at).localeCompare(String(b.created_at)))
        .map((m: any) => `${m.direccion === 'entrante' ? 'Familia' : 'Retrato Escolar'}: ${m.contenido}`)
        .join('\n');

      const promptConsulta = `
Datos de la consulta:
- Nombre: ${consulta.nombre}
- Colegio mencionado: ${consulta.colegio || 'no especificado'}
- Número de pedido mencionado: ${consulta.numero_pedido || 'ninguno'}
- Asunto: ${consulta.asunto}
- Mensaje: ${consulta.mensaje}
${historial ? `\nConversación previa:\n${historial}` : ''}

Redactá la respuesta ahora.
      `.trim();

      const resultadoIA = await gemini.models.generateContent({
        model: 'gemini-3.6-flash',
        contents: promptConsulta,
        config: { systemInstruction: CONTEXTO_NEGOCIO_CONSULTAS },
      });
      const sugerencia = resultadoIA.text?.trim();
      if (!sugerencia) throw new Error('La IA no devolvió texto.');

      return res.json({ success: true, sugerencia });
    } catch (err: any) {
      console.error('[Consultas] Error al sugerir respuesta con IA:', err);
      return res.status(500).json({ success: false, error: 'No pudimos generar una sugerencia. Intentá nuevamente o escribila a mano.' });
    }
  }
);

// ==============================================================================
// 4D. SOLICITUDES DE CÓDIGO DE CURSO (reemplaza el botón "Solicitar por WhatsApp")
// Una familia que no encuentra su código deja sus datos acá en vez de escribirle
// directo al fotógrafo por WhatsApp; queda listado en el panel admin para que lo
// atienda cuando pueda, sin flood de mensajes individuales.
// ==============================================================================

// Envío público: cualquier familia puede dejar su solicitud, sin login
app.post('/api/solicitudes-codigo', limitarFrecuencia('solicitudes-codigo', 20, 15 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { nombreSolicitante, contacto, alumnoNombre, colegioId, colegioNombre, grado, division, turno, mensaje } = req.body || {};

    const nombre = String(nombreSolicitante || '').trim();
    const contactoLimpio = String(contacto || '').trim();
    if (!nombre || !contactoLimpio) {
      return res.status(400).json({ success: false, error: 'Faltan tu nombre y el email con el que te registraste' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contactoLimpio)) {
      return res.status(400).json({ success: false, error: 'Ingresá un email válido' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    // Si escribió el mismo email con el que se registró, el código sólo se reenvía a esa
    // dirección. No se devuelve en la respuesta pública ni se revela si pertenece a otra persona.
    {
      // Auditoría 2026-09-22 (bug real encontrado en auditoría de código, MEDIO): la regex de
      // arriba valida "forma de email" pero no excluye los comodines de ilike ('%' y '_'), así
      // que un input como "%@gmail.com" la pasaba igual y convertía este "match exacto" en un
      // patrón que matcheaba CUALQUIER inscripción aceptada con ese dominio — rompiendo la
      // garantía de coincidencia exacta que promete el comentario de arriba (vector de spam:
      // reenviar el código de una familia al azar a partir de su dominio de email). Se escapan
      // los caracteres especiales de ilike antes de usarlos para que sólo pueda matchear el
      // email exacto (case-insensitive), nunca un patrón.
      const emailParaIlike = contactoLimpio.replace(/[%_\\]/g, (c) => `\\${c}`);
      let inscripcionesQuery = supabase
        .from('inscripciones')
        .select('id,email,padre_nombre,colegio_nombre,codigo_asignado,alumno_nombre,alumno_apellido,grado,division,turno,hermanos,solicita_foto_hermanos')
        .eq('estado', 'aceptado')
        .ilike('email', emailParaIlike)
        .order('updated_at', { ascending: false })
        .limit(1);
      if (colegioId) inscripcionesQuery = inscripcionesQuery.eq('colegio_id', colegioId);

      const { data: coincidencias, error: errorBusqueda } = await inscripcionesQuery;
      if (errorBusqueda) throw errorBusqueda;
      const inscripcion = coincidencias?.[0];
      if (inscripcion?.codigo_asignado && inscripcion.email) {
        const alumnos = [
          { nombre: inscripcion.alumno_nombre, apellido: inscripcion.alumno_apellido || '', grado: inscripcion.grado, division: inscripcion.division, turno: inscripcion.turno },
          ...(Array.isArray(inscripcion.hermanos) ? inscripcion.hermanos : []).map((h: any) => ({
            nombre: h.alumnoNombre || h.alumno_nombre,
            apellido: h.alumnoApellido || h.alumno_apellido || '',
            grado: h.grado,
            division: h.division,
            turno: h.turno,
          })),
        ];
        const resultadoEmail = await enviarCorreoCodigoAcceso({
          to: inscripcion.email,
          padreNombre: inscripcion.padre_nombre,
          colegioNombre: inscripcion.colegio_nombre,
          codigo: inscripcion.codigo_asignado,
          alumnos,
          solicitaFotoHermanos: Boolean(inscripcion.solicita_foto_hermanos),
        });
        if (!resultadoEmail.success) throw new Error(resultadoEmail.error || 'No se pudo reenviar el código por email');

        return res.json({
          success: true,
          envioAutomatico: true,
          mensaje: 'Te enviamos tu Código Familiar al correo registrado. Revisá también la carpeta Spam o Correo no deseado.',
        });
      }
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

    return res.json({
      success: true,
      solicitud: data,
      envioAutomatico: false,
      mensaje: 'Recibimos tu solicitud. Revisaremos los datos y te contactaremos a la brevedad.',
    });
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
    const data = await traerTodasLasFilas((desde, hasta) => {
      let builder = supabase.from('solicitudes_codigo').select('*').order('created_at', { ascending: false }).order('id');
      if (estado && estado !== 'todas') {
        builder = builder.eq('estado', estado);
      }
      return builder.range(desde, hasta);
    });
    return res.json({ success: true, solicitudes: data });
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

// Auditoría 2026-09-16 (pedido de Pablo): el cartel de esta pestaña ya decía "Respondeles por
// WhatsApp o email", pero "por email" quería decir abrir su propio cliente de correo a mano —
// no había forma de contestar desde el sistema, con la misma cuenta oficial que ya usa para todo
// lo demás (Mercado Pago, avisos de fotos listas, etc.). Este endpoint replica el patrón que ya
// existe para "Consultas de familias" (mismo remitente, mismo servicio de Resend), pero más
// simple: acá no hay un hilo de conversación guardado (no existe una tabla de mensajes para
// solicitudes, a diferencia de consultas_familias_mensajes) — es un email suelto de una vía. Al
// enviarse con éxito, se marca la solicitud como atendida automáticamente (si ya se le contestó,
// no tiene sentido que siga apareciendo en "Pendientes").
//
// Auditoría 2026-09-16, segunda vuelta (pedido de Pablo: "no puede ser automático?"): cuando la
// familia sí dejó colegio+grado+turno+división al pedir el código (el panel se lo busca solo con
// `asegurarCodigoSeccionAdmin`/`codigos_seccion` antes de abrir este cuadro), el frontend manda
// `codigo` acá y el email sale con la misma caja destacada que ya usa el aviso de "inscripción
// validada" (ver `enviarCorreoCodigoAcceso` más abajo) en vez de un párrafo de texto libre — así
// Pablo no tiene que escribir ni tipear el código a mano, solo revisar y apretar enviar. `mensaje`
// pasa a ser opcional en ese caso (una aclaración extra, si quiere agregar algo); sigue siendo
// obligatorio cuando no hay código (la familia no dejó grado/turno/división, o esa sección
// todavía no tiene código asignado) y Pablo responde a mano como antes.
app.post('/api/admin/solicitudes-codigo/:id/responder', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const mensaje = String(req.body?.mensaje || '').trim();
    const codigo = String(req.body?.codigo || '').trim().toUpperCase();
    if (!codigo && (mensaje.length < 2 || mensaje.length > 5000)) {
      return res.status(400).json({ success: false, error: 'La respuesta debe tener entre 2 y 5000 caracteres.' });
    }
    if (mensaje.length > 5000) {
      return res.status(400).json({ success: false, error: 'La aclaración no puede superar los 5000 caracteres.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
    const { data: solicitud, error } = await supabase
      .from('solicitudes_codigo')
      .select('id,nombre_solicitante,contacto,estado')
      .eq('id', req.params.id)
      .single();
    if (error || !solicitud) return res.status(404).json({ success: false, error: 'No encontramos la solicitud.' });
    if (!solicitud.contacto || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(solicitud.contacto)) {
      return res.status(400).json({ success: false, error: 'Esta solicitud no tiene un email válido cargado.' });
    }

    const resend = getResendClient();
    if (!resend) return res.status(503).json({ success: false, error: 'El servicio de email no está configurado.' });
    const nombreDestinatario = escapeHtml(solicitud.nombre_solicitante || 'Familia');
    const htmlContent = codigo
      ? `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><title>Tu Código de Acceso - Retrato Escolar</title></head><body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1e293b;"><div style="max-width:600px;margin:24px auto;background-color:#ffffff;border-radius:16px;border:1px solid #e2e8f0;overflow:hidden;box-shadow:0 4px 6px -1px rgba(0,0,0,0.05);"><div style="background-color:#0f172a;padding:32px 24px;text-align:center;border-bottom:3px solid #f59e0b;"><div style="font-size:11px;font-weight:800;letter-spacing:2px;color:#f59e0b;text-transform:uppercase;margin-bottom:6px;">RETRATO ESCOLAR • EDICIÓN 2026</div><h1 style="color:#ffffff;margin:0;font-size:22px;font-weight:800;letter-spacing:-0.5px;">Encontramos tu Código de Acceso</h1></div><div style="padding:28px 24px;"><p style="font-size:15px;line-height:1.6;margin-top:0;">Hola <strong>${nombreDestinatario}</strong>,</p><p style="font-size:14px;line-height:1.6;color:#334155;">Nos pediste una mano para encontrar tu Código de Acceso — acá lo tenés:</p><div style="margin:24px 0;text-align:center;background-color:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:18px;"><div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:1px;color:#92400e;margin-bottom:6px;">Tu Código de Acceso</div><div style="font-size:26px;font-weight:800;color:#0f172a;font-family:monospace;letter-spacing:2px;">${escapeHtml(codigo)}</div></div>${mensaje ? `<div style="white-space:pre-wrap;line-height:1.6;font-size:14px;color:#334155;margin-bottom:16px;">${escapeHtml(mensaje)}</div>` : ''}<p style="font-size:13px;line-height:1.6;color:#334155;">Con este código podés ingresar a <strong>retratoescolar.com.ar</strong>, ver la galería y elegir tus fotos.</p><div style="font-size:12px;color:#64748b;line-height:1.6;border-top:1px solid #e2e8f0;padding-top:16px;margin-top:16px;">Podés responder directamente a este correo si necesitás algo más.</div></div><div style="background-color:#f1f5f9;padding:18px 24px;text-align:center;font-size:11px;color:#64748b;border-top:1px solid #e2e8f0;">© 2026 Retrato Escolar • Fotografía Escolar Profesional<br><a href="https://retratoescolar.com.ar" style="color:#d97706;text-decoration:none;font-weight:600;">retratoescolar.com.ar</a></div></div></body></html>`
      : `<div style="font-family:Arial,sans-serif;max-width:640px;margin:auto;color:#0f172a"><p>Hola ${nombreDestinatario},</p><div style="white-space:pre-wrap;line-height:1.6">${escapeHtml(mensaje)}</div><p style="margin-top:24px">Saludos,<br><strong>Retrato Escolar</strong></p><hr style="margin:24px 0;border:0;border-top:1px solid #e2e8f0"><p style="font-size:12px;color:#64748b">Podés responder directamente a este correo si necesitás algo más.</p></div>`;
    const resultado = await resend.emails.send({
      from: process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>',
      to: [solicitud.contacto],
      subject: codigo ? `Retrato Escolar: Tu Código de Acceso (${codigo})` : 'Tu código de curso — Retrato Escolar',
      html: htmlContent,
    });
    if (resultado.error) throw resultado.error;

    if (solicitud.estado !== 'atendido') {
      const { error: updateError } = await supabase
        .from('solicitudes_codigo')
        .update({ estado: 'atendido', updated_at: new Date().toISOString() })
        .eq('id', solicitud.id);
      if (updateError) console.error('[Solicitudes código] La respuesta se envió, pero no se marcó como atendida:', updateError);
    }
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[Solicitudes código] Error al responder:', err);
    return res.status(500).json({ success: false, error: 'No pudimos enviar la respuesta. Intentá nuevamente.' });
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

type SeccionFotosDisponible = { colegioId: string; codigoCurso: string; grado: string; turno: string; division: string };

function mismoDatoSeccion(a: unknown, b: unknown): boolean {
  const normalizar = (valor: unknown) => String(valor ?? '').trim().toLocaleLowerCase('es-AR')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ');
  return normalizar(a) === normalizar(b);
}

async function avisarFotosDisponiblesASeccion(supabase: SupabaseClient, seccion: SeccionFotosDisponible): Promise<number> {
  const resend = getResendClient();
  if (!resend) throw new Error('RESEND_API_KEY no está configurada; no se enviaron los avisos de galería.');

  // Paginado: en un colegio con más de 1000 familias aprobadas, las que quedaban fuera del tope
  // nunca recibían el aviso de "tus fotos ya están online".
  const inscripciones = await traerTodasLasFilas<any>((desde, hasta) =>
    supabase
      .from('inscripciones')
      .select('id,email,padre_nombre,alumno_nombre,colegio_nombre,grado,turno,division,hermanos')
      .eq('colegio_id', seccion.colegioId)
      .eq('estado', 'aceptado')
      .order('id')
      .range(desde, hasta)
  );

  const destinatarios = new Map<string, { id: string; email: string; tutor: string; alumno: string; colegio: string }>();
  for (const inscripcion of inscripciones || []) {
    const alumnos = [
      { nombre: inscripcion.alumno_nombre, grado: inscripcion.grado, turno: inscripcion.turno, division: inscripcion.division },
      ...(Array.isArray(inscripcion.hermanos) ? inscripcion.hermanos.map((h: any) => ({
        nombre: h.alumnoNombre || h.alumno_nombre,
        grado: h.grado,
        turno: h.turno,
        division: h.division,
      })) : []),
    ];
    const alumnoDelCurso = alumnos.find((alumno) =>
      mismoDatoSeccion(alumno.grado, seccion.grado)
      && mismoDatoSeccion(alumno.turno, seccion.turno)
      && mismoDatoSeccion(alumno.division, seccion.division)
    );
    const email = String(inscripcion.email || '').trim().toLowerCase();
    if (!alumnoDelCurso || !email.includes('@') || destinatarios.has(email)) continue;
    destinatarios.set(email, {
      id: String(inscripcion.id),
      email,
      tutor: inscripcion.padre_nombre || 'Familia',
      alumno: alumnoDelCurso.nombre || 'el alumno/a',
      colegio: inscripcion.colegio_nombre || 'la institución',
    });
  }

  // Auditoría 2026-09-23 (bug real): antes se mandaban TODOS los avisos a la vez con
  // Promise.allSettled + emails.send — Resend limita a ~2 pedidos por segundo, así que en un curso
  // con más de un par de familias casi todos los avisos volvían con error 429 (rate limit) y esas
  // familias nunca se enteraban de que sus fotos estaban online. Ahora se usa la API de lotes de
  // Resend (hasta 100 correos por pedido), de a un lote por vez.
  const lista = Array.from(destinatarios.values());
  const armarCorreo = (destinatario: { email: string; tutor: string; alumno: string; colegio: string }) => ({
    from: process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>',
    replyTo: resendReplyTo,
    to: [destinatario.email],
    subject: `Las fotos de ${destinatario.alumno} ya están online`,
    html: `<!doctype html><html lang="es"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#1e293b"><div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="background:#0f172a;padding:28px 24px;text-align:center;border-bottom:3px solid #f59e0b"><div style="color:#f59e0b;font-size:11px;font-weight:800;letter-spacing:2px">RETRATO ESCOLAR</div><h1 style="color:#fff;font-size:22px;margin:8px 0 0">¡Las fotos ya están online!</h1></div><div style="padding:28px 24px"><p>Hola <strong>${escapeHtml(destinatario.tutor)}</strong>,</p><p style="line-height:1.6">Las fotografías de <strong>${escapeHtml(destinatario.alumno)}</strong>, de ${escapeHtml(seccion.grado)} "${escapeHtml(seccion.division)}" · Turno ${escapeHtml(seccion.turno)}, ya están disponibles para ver y elegir.</p><div style="margin:24px 0;text-align:center"><a href="https://retratoescolar.com.ar" style="display:inline-block;background:#fbbf24;color:#0f172a;text-decoration:none;font-weight:800;padding:13px 22px;border-radius:10px">Ver mis fotos</a></div><p style="font-size:12px;color:#64748b">Ingresá con el mismo código de acceso que recibiste al aprobarse tu inscripción en ${escapeHtml(destinatario.colegio)}.</p></div></div></body></html>`,
  });

  let enviados = 0;
  const TAMANO_LOTE = 100;
  for (let i = 0; i < lista.length; i += TAMANO_LOTE) {
    const lote = lista.slice(i, i + TAMANO_LOTE);
    try {
      const resultado = await resend.batch.send(lote.map(armarCorreo), {
        idempotencyKey: `fotos-online-${crypto.createHash('sha256').update(`${seccion.colegioId}|${seccion.codigoCurso}|${lote.map((d) => d.id).join(',')}`).digest('hex')}`,
        batchValidation: 'permissive',
      });
      if (resultado.error) {
        console.error(`[fotos] Falló un lote de ${lote.length} avisos automáticos:`, resultado.error);
        continue;
      }
      const erroresLote = (resultado.data as any)?.errors?.length || 0;
      if (erroresLote > 0) console.error(`[fotos] ${erroresLote} aviso(s) del lote rechazados por Resend:`, (resultado.data as any).errors);
      enviados += lote.length - erroresLote;
    } catch (errLote) {
      console.error(`[fotos] Error de red enviando un lote de ${lote.length} avisos:`, errLote);
    }
    if (i + TAMANO_LOTE < lista.length) await new Promise((resolve) => setTimeout(resolve, 600));
  }
  if (enviados < lista.length) console.error(`[fotos] Fallaron ${lista.length - enviados} de ${lista.length} avisos automáticos.`);
  return enviados;
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
  esImpreso?: boolean;
}

type TipoActualizacionPedido = 'en_produccion' | 'listo_retiro';

async function enviarCorreoActualizacionPedido(datos: { tipo: TipoActualizacionPedido; to: string; tutorNombre: string; alumnoNombre: string; colegioNombre: string; pedidoId: string; pedidoFriendlyId?: string }) {
  const resend = getResendClient();
  if (!resend) throw new Error('RESEND_API_KEY no está configurada.');
  const esProduccion = datos.tipo === 'en_produccion';
  const titulo = esProduccion ? 'Tu pedido está en producción' : 'Tu pedido está listo para retirar';
  const mensaje = esProduccion ? `El pedido de fotografías de <strong>${escapeHtml(datos.alumnoNombre)}</strong> ya ingresó al laboratorio y se encuentra en producción.` : `El pedido de fotografías de <strong>${escapeHtml(datos.alumnoNombre)}</strong> ya está listo. Podés retirarlo en <strong>${escapeHtml(datos.colegioNombre)}</strong>.`;
  const detalle = esProduccion ? 'Te enviaremos un nuevo aviso cuando esté disponible para retirar en el colegio.' : 'Consultá en la institución los días y horarios habilitados para la entrega.';
  // Auditoría 2026-09-18 (reporte de Pablo): este correo mostraba "datos.pedidoId" tal cual, que
  // es el UUID interno de Supabase (necesario para que el servidor encuentre la fila), no el
  // número de pedido legible (IFS-2026-XXXX) que ve el cliente en el resto de los correos y en
  // el Portal. Se muestra "pedidoFriendlyId" cuando viene informado, y sólo si falta se cae al
  // UUID (mejor eso que no mostrar nada).
  const pedidoMostrado = datos.pedidoFriendlyId || datos.pedidoId;
  const resultado = await resend.emails.send({
    from: process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>', replyTo: resendReplyTo, to: [datos.to], subject: `${titulo} — ${datos.alumnoNombre}`,
    html: `<!doctype html><html lang="es"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#1e293b"><div style="max-width:600px;margin:24px auto;background:#fff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden"><div style="background:#0f172a;padding:28px 24px;text-align:center;border-bottom:3px solid #f59e0b"><div style="color:#f59e0b;font-size:11px;font-weight:800;letter-spacing:2px">RETRATO ESCOLAR</div><h1 style="color:#fff;font-size:22px;margin:8px 0 0">${titulo}</h1></div><div style="padding:28px 24px"><p>Hola <strong>${escapeHtml(datos.tutorNombre || 'Familia')}</strong>,</p><p style="line-height:1.6">${mensaje}</p><div style="margin:22px 0;padding:16px;background:${esProduccion ? '#eef2ff' : '#ecfdf5'};border-radius:12px;line-height:1.5">${detalle}</div><p style="font-size:12px;color:#64748b">Pedido: <strong>${escapeHtml(pedidoMostrado)}</strong></p></div></div></body></html>`,
  }, { headers: { 'Idempotency-Key': `estado-${datos.tipo}-${datos.pedidoId}-${new Date().toISOString().slice(0, 10)}` } });
  if (resultado.error) throw new Error(resultado.error.message);
  return resultado;
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
        <a href="${escapeHtml(enlaceHD)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.35);">
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

  // Auditoría 2026-09-23 (bug real): el SDK de Resend NO tira excepción cuando el envío falla
  // (dominio sin verificar, rate limit, email rechazado): devuelve { data: null, error }. Antes se
  // devolvía success:true igual, así que el pedido quedaba marcado email_enviado=true y el cron de
  // reintento lo salteaba aunque el correo nunca hubiera salido. Además el asunto usaba los textos
  // ya escapados para HTML (un "&" llegaba como "&amp;" en el asunto).
  const data = await resend.emails.send({
    from: fromEmail,
    replyTo: resendReplyTo,
    to: [to],
    subject: `📸 Tus fotos en Alta Resolución - ${alumnoNombre?.trim() || 'el alumno/a'} (${colegioNombre?.trim() || 'la institución'})`,
    html: htmlContent,
  });
  if (data.error) {
    console.error('[Resend] No se pudo enviar el correo de fotos HD:', data.error);
    return { success: false, error: data.error.message || 'Resend rechazó el envío del correo.' };
  }

  return {
    success: true,
    messageId: data.data?.id,
    from: fromEmail,
    to,
  };
}

/**
 * Auditoría 2026-09-20 (bug real reportado por Pablo: "no le llega el enlace de descarga de
 * fotos HD al cliente"). Causa raíz encontrada: aunque `generarYSubirZipHDParaPedido` y
 * `enviarCorreoFotosHD` se ejecutaban bien en el webhook de pago, el resultado (el link firmado,
 * si el correo salió, y cuándo) NUNCA se guardaba de vuelta en `pedidos` — ni acá, ni en el envío
 * manual desde el botón "Reenviar Email HD" del panel. Eso significa que:
 *   1) el panel de Laboratorio no podía distinguir un pedido al que ya se le mandó el link real
 *      de uno al que sólo se le mandó el texto de "en breve" — ambos se veían iguales;
 *   2) cada vez que alguien recargaba la página, `email_enviado`/`link_descarga_hd` volvían a
 *      leerse vacíos de la base, aunque el correo ya se hubiera mandado bien.
 * Esta función es el único lugar que graba ese resultado, para que la tabla `pedidos` sea la
 * fuente de verdad real (no la memoria del navegador). Sólo marca `email_enviado = true` cuando
 * el envío fue realmente exitoso (nunca en un envío simulado o fallido); el link se guarda igual
 * aunque el correo fallara, para no perder un .zip que sí se llegó a generar. Nunca lanza un
 * error — si falla el guardado, el pago/envío ya ocurrieron y no tiene sentido cortar el flujo
 * por esto (mismo criterio que el resto de las actualizaciones "best effort" en este archivo).
 */
async function registrarEnvioCorreoHD(
  supabase: SupabaseClient | null,
  pedidoId: string | null | undefined,
  linkDescargaHD: string | null,
  envioExitoso: boolean
): Promise<void> {
  if (!supabase || !pedidoId) return;
  try {
    const cambios: Record<string, any> = {};
    if (linkDescargaHD) cambios.link_descarga_hd = linkDescargaHD;
    if (envioExitoso) {
      cambios.email_enviado = true;
      cambios.fecha_envio_email = new Date().toISOString();
    }
    if (Object.keys(cambios).length === 0) return;
    const { error } = await supabase.from('pedidos').update(cambios).eq('id', pedidoId);
    if (error) console.warn(`[registrarEnvioCorreoHD] No se pudo guardar el resultado del envío HD para ${pedidoId}:`, error.message);
  } catch (err: any) {
    console.warn(`[registrarEnvioCorreoHD] Error inesperado guardando el envío HD para ${pedidoId}:`, err?.message || err);
  }
}

/**
 * Auditoría 2026-09-18 (pedido de Pablo: automatizar el .zip de descarga HD, en vez de que el
 * link de descarga quede vacío hasta que alguien lo suba a mano). Arma un .zip con los originales
 * en alta resolución (sin marca de agua) de las fotos que ESE pedido puntual compró — mismo
 * criterio de selección que generarArchivosParaLaboratorio() en el frontend
 * (src/services/pedidosLabService.ts), pero un solo archivo por foto distinta: una copia extra
 * impresa (copias_extras) es una copia física de más, no un archivo digital repetido.
 *
 * Sube el .zip al mismo bucket privado 'fotos-hd' (bajo "zips-pedidos/") y devuelve un link
 * firmado temporal para que la familia lo descargue directamente, sin exponer el bucket.
 *
 * Se llama automáticamente apenas se confirma un pago (Mercado Pago o Nave, más abajo). Si algo
 * falla acá (todavía no se cargaron las fotos de ese curso, error de red con Storage, etc.) esto
 * resuelve a null y el resto del flujo de pago sigue sin verse afectado: el pedido igual queda
 * "pagado" y el correo se manda con el texto de "en breve" en vez del link, como pasaba antes de
 * esta auditoría. El fotógrafo puede reintentarlo a mano una vez resuelto lo que haya fallado
 * (botón "Reenviar Email HD" en el panel de Laboratorio, que primero reintenta armar el .zip).
 */
function nombreZipHDPedido(pedido: { id: string }): string {
  return `zips-pedidos/${pedido.id}.zip`;
}

/**
 * Auditoría 2026-09-23: todo lo que hay que hacer cuando uno o más pedidos RECIÉN pasan a
 * "pagado" (armar el .zip HD, mandar el correo, grabar el resultado). Antes esto estaba copiado
 * dentro de cada webhook (Mercado Pago y Nave), y el respaldo de reconciliación de
 * /api/pedidos/:id/status marcaba el pedido como pagado SIN hacer nada de esto — y como el
 * webhook que llegaba después ya encontraba el pedido "pagado" (guard .neq), nunca se mandaba el
 * correo ni se armaba el .zip hasta el cron diario. Ahora los tres caminos usan esta misma
 * función, y como los tres marcan "pagado" con .neq('estado','pagado'), sólo el que gana la
 * carrera recibe las filas y las procesa (sin correos duplicados).
 */
async function procesarPedidosRecienPagados(supabase: SupabaseClient, filas: any[], emailRespaldo?: string | null, nombreRespaldo?: string | null) {
  await Promise.all((filas || []).map(async (orderData: any) => {
    const emailDestino = orderData?.familias?.email || emailRespaldo;
    if (!emailDestino || !String(emailDestino).includes('@')) return;
    const linkDescargaHD = await generarYSubirZipHDParaPedido(supabase, orderData);
    const resultadoEnvio = await enviarCorreoFotosHD({
      to: emailDestino,
      tutorNombre: orderData?.familias?.nombre || nombreRespaldo || 'Familia',
      alumnoNombre: orderData?.alumno_nombre || 'tu hijo/a',
      colegioNombre: orderData?.colegio_nombre || 'tu colegio',
      cursoCodigo: orderData?.curso_codigo || undefined,
      kitNombre: orderData?.kit_nombre || undefined,
      pedidoId: orderData?.pedido_friendly_id || orderData?.id,
      total: Number(orderData?.total) || 0,
      linkDescargaHD: linkDescargaHD || undefined,
    });
    await registrarEnvioCorreoHD(supabase, orderData?.id, linkDescargaHD, resultadoEnvio?.success === true);
  }));
}

/**
 * Auditoría 2026-09-23 (bug CRÍTICO de cobro): trae los pedidos pendientes de pago que
 * corresponden a una referencia de pago (el UUID de un pedido, o el grupo_pago_id de un carrito
 * multi-hijo). El monto a cobrar en Mercado Pago / Nave sale SIEMPRE de acá (la columna `total`
 * que calculó el servidor al registrar el pedido) — antes se volvía a calcular con el kit, las
 * carpetas y las fotos sueltas que mandara el navegador en ese momento, sin relación con lo que
 * había quedado guardado en el pedido. Ver /api/mercadopago/crear-preferencia.
 */
async function obtenerPedidosPendientesParaCobro(
  supabase: SupabaseClient,
  ref: { pedidoId?: unknown; grupoPagoId?: unknown }
): Promise<{ filas: any[]; error?: string; status?: number }> {
  const esUuid = (v: unknown) => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);
  const columna = ref.grupoPagoId !== undefined ? 'grupo_pago_id' : 'id';
  const valor = ref.grupoPagoId !== undefined ? ref.grupoPagoId : ref.pedidoId;
  if (!esUuid(valor)) {
    return { filas: [], status: 400, error: 'Falta la referencia del pedido a cobrar.' };
  }
  const { data, error } = await supabase
    .from('pedidos')
    .select('id, estado, total, kit_nombre, alumno_nombre, colegio_nombre, grupo_pago_id')
    .eq(columna, valor as string);
  if (error) return { filas: [], status: 500, error: error.message };
  if (!data || data.length === 0) {
    return { filas: [], status: 404, error: 'No encontramos el pedido registrado. Volvé a armar el pedido desde el portal.' };
  }
  // 'cancelado' se permite a propósito: un intento de pago rechazado (tarjeta sin fondos, etc.)
  // deja el pedido "cancelado", y la familia tiene que poder reintentar con otro medio.
  if (data.some((p: any) => p.estado === 'pagado' || p.estado === 'entregado')) {
    return { filas: [], status: 409, error: 'Este pedido ya está pagado.' };
  }
  if (data.some((p: any) => !(Number(p.total) > 0))) {
    return { filas: [], status: 409, error: 'El pedido no tiene un monto válido para cobrar.' };
  }
  return { filas: data };
}

/**
 * Auditoría 2026-09-23 (defensa en profundidad): antes de dar por pagados los pedidos de una
 * referencia, se compara lo que efectivamente cobró la pasarela contra la suma de los `total`
 * guardados. Si se cobró menos (con $1 de tolerancia por redondeo), NO se marca como pagado y
 * queda un error en el log para revisarlo a mano.
 */
async function montoCubrePedidos(supabase: SupabaseClient, columna: 'id' | 'grupo_pago_id', valor: string, montoPagado: number): Promise<boolean> {
  if (!Number.isFinite(montoPagado)) {
    // La pasarela no informó el monto en el formato esperado: no se bloquea el pago (el monto de
    // la intención/preferencia ya lo fijó el servidor desde la base), pero queda registrado.
    console.warn(`[Pagos] No se pudo leer el monto cobrado para ${columna}=${valor}; se omite el control de monto.`);
    return true;
  }
  const { data } = await supabase.from('pedidos').select('total').eq(columna, valor).neq('estado', 'pagado');
  if (!data || data.length === 0) return true; // nada pendiente con esa referencia: el update posterior no toca nada
  const esperado = data.reduce((acc: number, p: any) => acc + (Number(p.total) || 0), 0);
  if (montoPagado + 1 < esperado) {
    console.error(`[Pagos] MONTO INSUFICIENTE para ${columna}=${valor}: se cobró ${montoPagado} y el pedido vale ${esperado}. No se marca como pagado — revisar a mano.`);
    return false;
  }
  return true;
}

/**
 * Marca como pagados los pedidos de una referencia de pago (UUID de un pedido suelto, o
 * grupo_pago_id de un carrito multi-hijo), sólo si el monto cobrado alcanza, y devuelve SOLO las
 * filas que pasaron a "pagado" en esta llamada (con los datos de la familia para el correo).
 * Idempotente: un segundo llamado con la misma referencia devuelve [] y no hace nada.
 */
async function marcarReferenciaComoPagada(
  supabase: SupabaseClient,
  referencia: string,
  montoPagado: number,
  extras: Record<string, any>
): Promise<any[]> {
  const { data: individual } = await supabase.from('pedidos').select('id').eq('id', referencia).limit(1);
  const columna: 'id' | 'grupo_pago_id' = individual && individual.length > 0 ? 'id' : 'grupo_pago_id';
  if (!(await montoCubrePedidos(supabase, columna, referencia, montoPagado))) return [];
  const { data, error } = await supabase
    .from('pedidos')
    .update({ estado: 'pagado', ...extras, updated_at: new Date().toISOString() })
    .eq(columna, referencia)
    .neq('estado', 'pagado')
    .select('*, familias(nombre, whatsapp, email)');
  if (error) {
    console.error(`[Pagos] Error al marcar pagada la referencia ${referencia}:`, error);
    return [];
  }
  if (!data || data.length === 0) {
    console.log(`[Pagos] Referencia ${referencia}: nada para actualizar (no existe o ya estaba pagada).`);
  }
  return data || [];
}

async function generarYSubirZipHDParaPedido(supabase: SupabaseClient, pedido: any): Promise<string | null> {
  try {
    if (!pedido?.colegio_id || !pedido?.curso_codigo) return null;

    const { data: fotosCurso, error: errorFotos } = await supabase
      .from('fotos')
      .select('id, categoria, storage_path')
      .eq('colegio_id', pedido.colegio_id)
      .eq('codigo_curso', pedido.curso_codigo);
    if (errorFotos) throw errorFotos;
    if (!fotosCurso || fotosCurso.length === 0) return null;

    const buscarFoto = (id: string | undefined, categoria: string) =>
      id ? fotosCurso.find((f: any) => f.id === id && f.categoria === categoria) : undefined;

    const seleccion = (pedido.fotos_seleccionadas && typeof pedido.fotos_seleccionadas === 'object')
      ? pedido.fotos_seleccionadas
      : {};

    const elegidas: { nombre: string; foto: any }[] = [];
    const individual = buscarFoto(seleccion.individualId, 'individual');
    if (individual) elegidas.push({ nombre: 'Individual.jpg', foto: individual });
    const grupal = buscarFoto(seleccion.grupalId, 'grupal');
    if (grupal) elegidas.push({ nombre: 'Grupal.jpg', foto: grupal });
    const docente = seleccion.docenteId ? buscarFoto(seleccion.docenteId, 'docente') : undefined;
    if (docente) elegidas.push({ nombre: 'Con_la_seño.jpg', foto: docente });
    const otrasIds: string[] = Array.isArray(seleccion.otrasIds) ? seleccion.otrasIds : [];
    otrasIds.forEach((id: string, indice: number) => {
      const foto = buscarFoto(id, 'patio');
      if (foto) elegidas.push({ nombre: `Otra_${indice + 1}.jpg`, foto });
    });

    if (elegidas.length === 0) return null;

    const zip = new JSZip();
    let algunaDescargada = false;
    for (const item of elegidas) {
      if (!item.foto.storage_path) continue;
      const { data: archivo, error: errorDescarga } = await supabase.storage
        .from('fotos-hd')
        .download(item.foto.storage_path);
      if (errorDescarga || !archivo) {
        console.warn(`[ZIP HD] No se pudo descargar ${item.nombre} (pedido ${pedido.id}):`, errorDescarga?.message);
        continue;
      }
      zip.file(item.nombre, Buffer.from(await archivo.arrayBuffer()));
      algunaDescargada = true;
    }
    if (!algunaDescargada) return null;

    const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE', compressionOptions: { level: 6 } });
    // Auditoría 2026-09-23 (bug CRÍTICO de privacidad): antes el .zip se nombraba con el número
    // amigable del pedido (IFS-2026-XXXX, 4 dígitos al azar generados en el navegador) y se subía
    // con upsert:true. Con ~9.000 combinaciones posibles, dos pedidos distintos terminan tarde o
    // temprano con el mismo número (con ~110 pedidos ya hay 50% de chance) — y el .zip del
    // segundo PISABA el del primero: la familia A pasaba a descargar las fotos del hijo de la
    // familia B con su propio link. Ahora el archivo se nombra siempre con el UUID del pedido,
    // que es único por definición.
    const nombreZip = nombreZipHDPedido(pedido);
    const { error: errorSubida } = await supabase.storage
      .from('fotos-hd')
      .upload(nombreZip, zipBuffer, { contentType: 'application/zip', upsert: true });
    if (errorSubida) throw errorSubida;

    // 90 días: de sobra para que la familia lo baje; si llega a vencer, "Reenviar Email HD"
    // desde el panel vuelve a generar el .zip y firma un link nuevo.
    const { data: firmado, error: errorFirma } = await supabase.storage
      .from('fotos-hd')
      .createSignedUrl(nombreZip, 60 * 60 * 24 * 90);
    if (errorFirma || !firmado?.signedUrl) throw errorFirma || new Error('No se pudo firmar el link de descarga');

    await supabase.from('pedidos').update({ link_descarga_hd: firmado.signedUrl }).eq('id', pedido.id);
    return firmado.signedUrl;
  } catch (err: any) {
    console.error(`[ZIP HD] Falló la generación automática para el pedido ${pedido?.id}:`, err?.message || err);
    return null;
  }
}

/**
 * Auditoría 2026-09-20 (revisión completa de estados, pedido de Pablo: "avancemos con el cron").
 * Hasta ahora, si el .zip HD fallaba al momento del pago, la ÚNICA forma de que la familia
 * recibiera su link real era que Pablo abriera el panel de Laboratorio, notara la alerta y
 * apretara "Reintentar" a mano. Esta función es el reintento automático: busca pedidos pagados
 * sin link real hace más de `graciaMinutos` (para no pisarle los talones al intento que ya hace
 * el webhook de pago en el momento) y repite el mismo proceso que ese webhook — generar el .zip,
 * mandar el correo, grabar el resultado. La llama tanto el endpoint de cron de más abajo como
 * cualquier otro lugar que en el futuro quiera un reintento en lote sin pasar por HTTP.
 */
async function reintentarPedidosConHDPendiente(
  supabase: SupabaseClient,
  opciones: { limite?: number; graciaMinutos?: number } = {}
): Promise<{ revisados: number; resueltos: number; fallidos: number }> {
  const limite = opciones.limite ?? 20;
  const graciaMinutos = opciones.graciaMinutos ?? 10;
  const cortaFecha = new Date(Date.now() - graciaMinutos * 60 * 1000).toISOString();

  // Auditoría 2026-09-23 (bug real): antes se pedían sólo `limite` filas, sin orden. Los pedidos
  // que nunca se pueden resolver (sin email de la familia, o de un curso sin fotos cargadas)
  // seguían saliendo primero todos los días y ocupaban los 20 lugares: los demás pedidos pendientes
  // no se reintentaban nunca. Ahora se trae un margen más amplio, se descartan los que no tienen
  // email y se priorizan los más nuevos.
  const { data: candidatos, error } = await supabase
    .from('pedidos')
    .select('*, familias(nombre, whatsapp, email)')
    .eq('estado', 'pagado')
    .or('link_descarga_hd.is.null,link_descarga_hd.eq.')
    .lt('created_at', cortaFecha)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error) {
    console.error('[cron reintentar-hd] Error buscando pedidos pendientes:', error.message);
    return { revisados: 0, resueltos: 0, fallidos: 0 };
  }
  const pendientes = (candidatos || [])
    .filter((p: any) => String(p?.familias?.email || '').includes('@'))
    .slice(0, limite);
  if (pendientes.length === 0) return { revisados: 0, resueltos: 0, fallidos: 0 };

  let resueltos = 0;
  let fallidos = 0;
  // En serie, no en paralelo: a diferencia del webhook (que procesa como mucho los pedidos de UN
  // pago), acá puede haber varios pedidos de distintos pagos juntos, y no tiene sentido armar
  // todos los .zip al mismo tiempo dentro de una función serverless con tiempo límite.
  for (const pedido of pendientes) {
    const emailDestino = pedido.familias.email;
    try {
      const linkDescargaHD = await generarYSubirZipHDParaPedido(supabase, pedido);
      if (!linkDescargaHD) { fallidos += 1; continue; }
      const resultadoEnvio = await enviarCorreoFotosHD({
        to: emailDestino,
        tutorNombre: pedido?.familias?.nombre || 'Familia',
        alumnoNombre: pedido?.alumno_nombre || 'tu hijo/a',
        colegioNombre: pedido?.colegio_nombre || 'tu colegio',
        cursoCodigo: pedido?.curso_codigo || undefined,
        kitNombre: pedido?.kit_nombre || undefined,
        pedidoId: pedido?.pedido_friendly_id || pedido?.id,
        total: Number(pedido?.total) || 0,
        linkDescargaHD,
      });
      await registrarEnvioCorreoHD(supabase, pedido?.id, linkDescargaHD, resultadoEnvio?.success === true);
      if (resultadoEnvio?.success === true) resueltos += 1; else fallidos += 1;
    } catch (err: any) {
      fallidos += 1;
      console.warn(`[cron reintentar-hd] Falló el reintento para el pedido ${pedido?.id}:`, err?.message || err);
    }
  }
  return { revisados: pendientes.length, resueltos, fallidos };
}

// Auditoría 2026-09-20: endpoint que dispara Vercel Cron (ver vercel.json) para que el reintento
// del .zip HD no dependa de que alguien abra el panel de Laboratorio. Protegido con CRON_SECRET:
// Vercel manda automáticamente "Authorization: Bearer <CRON_SECRET>" en las llamadas programadas
// cuando esa variable de entorno existe — hay que crearla en el proyecto de Vercel (cualquier
// texto largo al azar sirve) para que este endpoint acepte las llamadas. Sin esa variable
// configurada, el endpoint sigue existiendo pero rechaza todo (falla cerrado, no abierto).
app.get('/api/cron/reintentar-hd', async (req: Request, res: Response) => {
  const secretoEsperado = process.env.CRON_SECRET;
  const autorizacion = req.headers.authorization || '';
  if (!secretoEsperado || !compararTimingSafe(autorizacion, `Bearer ${secretoEsperado}`)) {
    return res.status(401).json({ success: false, error: 'No autorizado.' });
  }
  const supabase = getServerSupabase();
  if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
  const resultado = await reintentarPedidosConHDPendiente(supabase);
  console.log('[cron reintentar-hd]', resultado);
  return res.json({ success: true, ...resultado });
});

// Auditoría 2026-09-19 (bug real encontrado en auditoría de código, MEDIO): el link de descarga
// HD se firma por 90 días al generar el .zip (ver arriba) y ese mismo valor quedaba guardado en
// "pedidos.link_descarga_hd" para siempre — pasados los 90 días, el link roto seguía
// devolviéndose tal cual en /api/pedidos/:id/status y /api/pedidos/buscar, y la única forma de
// arreglarlo era que el admin usara a mano "Reenviar Email HD" desde el panel. El nombre del
// archivo .zip en Storage es determinístico (no cambia), así que acá se puede volver a firmar
// una URL fresca de 90 días sobre el MISMO .zip ya generado, sin tener que rearmarlo — barato
// (una sola llamada a Storage) y transparente para la familia. Si el objeto ya no existiera en
// Storage por algún motivo, se devuelve tal cual el link guardado como último recurso.
async function refirmarLinkDescargaHDSiExiste(supabase: SupabaseClient, pedido: { id: string; pedido_friendly_id?: string | null; link_descarga_hd?: string | null }): Promise<string | undefined> {
  if (!pedido?.link_descarga_hd) return undefined;
  try {
    // Primero el nombre nuevo (por UUID, ver nombreZipHDPedido). Los .zip generados antes del
    // 23/9/2026 quedaron con el nombre viejo (número amigable) — se usa sólo como respaldo, y
    // sólo si el link guardado apunta justamente a ese archivo viejo.
    let { data: firmado, error } = await supabase.storage
      .from('fotos-hd')
      .createSignedUrl(nombreZipHDPedido(pedido), 60 * 60 * 24 * 90);
    const nombreViejo = pedido.pedido_friendly_id ? `zips-pedidos/${pedido.pedido_friendly_id}.zip` : null;
    if ((error || !firmado?.signedUrl) && nombreViejo && pedido.link_descarga_hd.includes(encodeURI(nombreViejo))) {
      ({ data: firmado, error } = await supabase.storage
        .from('fotos-hd')
        .createSignedUrl(nombreViejo, 60 * 60 * 24 * 90));
    }
    if (error || !firmado?.signedUrl) {
      return pedido.link_descarga_hd;
    }
    if (firmado.signedUrl !== pedido.link_descarga_hd) {
      await supabase.from('pedidos').update({ link_descarga_hd: firmado.signedUrl }).eq('id', pedido.id);
    }
    return firmado.signedUrl;
  } catch (err: any) {
    console.warn(`[ZIP HD] No se pudo refirmar el link de descarga para el pedido ${pedido?.id}:`, err?.message || err);
    return pedido.link_descarga_hd;
  }
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
          ${escapeHtml(codigo)}
        </div>
      </div>
      <p style="font-size: 13px; line-height: 1.6; color: #334155;">Con este único código podrá:</p>
      <ol style="font-size: 13px; color: #334155; padding-left: 20px;">
        <li>Ingresar a retratoescolar.com.ar con su nombre y apellido, su DNI y este código</li>
        <li>Ver las galerías individuales y grupales de todos sus hijos sin usar códigos diferentes</li>
        <li>Seleccionar las fotos favoritas y armar un pedido consolidado en un solo pago</li>
      </ol>
      <!-- Auditoría 2026-09-22 (pedido de Pablo): este código lo comparte todo el curso, así que
           además de él hace falta escribir el nombre y DNI del tutor para que el sitio identifique
           a la familia exacta — se lo aclaramos acá para que no se sorprendan al entrar. -->
      <p style="font-size: 12px; color: #92400e; background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 8px; padding: 10px 12px; line-height: 1.5;">
        <strong>Importante:</strong> este código es el mismo para todo el curso. Al ingresar, además del código va a tener que completar el <strong>nombre y apellido</strong> y el <strong>DNI</strong> de quien se inscribió, para que el sistema reconozca a sus hijos.
      </p>
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

  // Mismo bug que enviarCorreoFotosHD: sin mirar `error`, un envío rechazado por Resend se
  // informaba como exitoso (al panel, y a la familia como "te enviamos el código por email").
  const data = await resend.emails.send({
    from: fromEmail,
    replyTo: resendReplyTo,
    to: [to],
    subject: `Retrato Escolar: Tu Código de Acceso (${codigo}) - ${colegioNombre?.trim() || 'la institución'}`,
    html: htmlContent,
  });
  if (data.error) {
    console.error('[Resend] No se pudo enviar el correo con el código de acceso:', data.error);
    return { success: false, error: data.error.message || 'Resend rechazó el envío del correo.' };
  }

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
    // Auditoría 2026-09-20: "pedidoId" en el body es el ID legible (IFS-2026-XXXX), sólo para
    // mostrar en el correo — no sirve para encontrar la fila en Supabase. Se agrega
    // "pedidoSupabaseId" (el UUID real) aparte, igual que ya se hace en /notificar-estado, para
    // poder grabar el resultado del envío (ver registrarEnvioCorreoHD) cuando el fotógrafo
    // reenvía el correo a mano desde el botón del panel de Laboratorio.
    const { pedidoSupabaseId, ...datosCorreo } = req.body || {};
    const resultado = await enviarCorreoFotosHD(datosCorreo);
    const supabase = getServerSupabase();
    await registrarEnvioCorreoHD(supabase, pedidoSupabaseId, datosCorreo?.linkDescargaHD || null, resultado?.success === true);
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

// Auditoría 2026-09-18 (pedido de Pablo: automatizar el .zip de descarga HD): reintento manual
// desde el panel de Laboratorio para cuando la generación automática (en los webhooks de pago)
// falló — por ejemplo, si en ese momento todavía no se habían cargado las fotos del curso. El
// botón "Reenviar Email HD" llama primero a esta ruta y, si consigue un link, lo usa; si no,
// sigue mandando el correo con lo que ya hubiera guardado (o el texto de "en breve").
app.post('/api/admin/pedidos/:id/generar-zip-hd', requireAdminAuth, async (req: Request, res: Response) => {
  try {
    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });

    const { data: pedido, error } = await supabase
      .from('pedidos')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (!pedido) return res.status(404).json({ success: false, error: 'Pedido no encontrado' });

    const link = await generarYSubirZipHDParaPedido(supabase, pedido);
    if (!link) {
      // Auditoría 2026-09-21 (refuerzo): antes este error era el mismo mensaje genérico para
      // TODAS las causas posibles de falla — incluída la vez que curso_codigo no matcheaba
      // ninguna fila de fotos (el bug real que rompió la entrega de HD, ver auditoría en
      // PortalFamiliasModal.tsx). Este diagnóstico rápido distingue "no hay fotos cargadas para
      // ese curso" (lo más común y lo que hay que arreglar cargando fotos) de "hay fotos pero
      // falló armar/subir el .zip" (más probable un problema pasajero de Storage), para que el
      // mensaje del panel apunte a la causa real en vez de mandar a revisar algo que ya está bien.
      const { count: fotosDelCurso } = await supabase
        .from('fotos')
        .select('id', { count: 'exact', head: true })
        .eq('colegio_id', pedido.colegio_id)
        .eq('codigo_curso', pedido.curso_codigo);
      if (!fotosDelCurso) {
        return res.status(422).json({
          success: false,
          error: `No hay fotos cargadas para el curso "${pedido.curso_codigo || '(sin código)'}" de este pedido. Cargá las fotos de ese curso desde el panel de Fotos y volvé a intentar.`,
        });
      }
      return res.status(422).json({
        success: false,
        error: 'Hay fotos cargadas para ese curso, pero no se pudo armar o subir el .zip (probable problema pasajero de Storage — mirá los logs del servidor). Volvé a intentar en unos minutos.',
      });
    }
    return res.json({ success: true, linkDescargaHD: link });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al generar el .zip HD' });
  }
});

// SEGURIDAD: es una herramienta de diagnóstico para el fotógrafo (probar que el dominio de
// Resend funciona), no algo que deba poder disparar cualquier visitante sin sesión.
app.post(['/api/resend/test', '/resend/test'], requireAdminAuth, async (req, res) => {
  try {
    const to = typeof req.body?.to === 'string' ? req.body.to.trim() : '';
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
      replyTo: resendReplyTo,
      to: [to],
      subject: '✅ Prueba de conexión con Resend - Retrato Escolar',
      html: `
        <div style="font-family: sans-serif; max-width: 500px; margin: 20px auto; padding: 24px; border: 1px solid #e2e8f0; border-radius: 12px;">
          <h2 style="color: #0f172a; margin-top: 0;">¡Conexión con Resend exitosa!</h2>
          <p style="color: #334155; font-size: 14px;">
            Este es un correo de prueba enviado desde tu dominio <strong>retratoescolar.com.ar</strong> utilizando la API de Resend.
          </p>
          <div style="background-color: #ecfdf5; border: 1px solid #a7f3d0; padding: 12px; border-radius: 8px; color: #065f46; font-size: 13px; margin: 16px 0;">
            ✓ Remitente: <strong>${escapeHtml(fromEmail)}</strong><br>
            ✓ Destino: <strong>${escapeHtml(to)}</strong><br>
            ✓ Sistema: Retrato Escolar 2026
          </div>
          <p style="font-size: 12px; color: #64748b;">
            Tus clientes recibirán sus enlaces HD y comprobantes automáticamente a través de este canal.
          </p>
        </div>
      `,
    });
    if (data.error) {
      return res.status(502).json({ success: false, error: data.error.message || 'Resend rechazó el envío de prueba.' });
    }

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

// Auditoría 2026-09-19 (bug real encontrado en auditoría de código, CRÍTICO): precio por cada
// "Otra Foto" suelta del evento (fuera del kit) — debe coincidir siempre con
// PRECIO_FOTO_EVENTO en PortalFamiliasModal.tsx. Antes esta constante no existía del lado del
// servidor: el frontend mostraba estas fotos como cobradas en el total que la familia veía,
// pero ningún endpoint las sumaba al monto real, así que se cobraba de menos (o directamente
// $0 extra) por fotos que la familia sí recibía.
const PRECIO_FOTO_EVENTO = 5000;
const MAX_FOTOS_SUELTAS = 50; // tope defensivo, no hay caso de uso real por encima de esto

// Única función que calcula lo que se cobra por un pedido — la usan tanto la creación de la
// preferencia de Mercado Pago como el registro del pedido en la base (ver auditoría
// 2026-09-09, punto de gestión "un solo lugar de verdad para los precios"). Devuelve null si
// el kit no se reconoce.
// La carpeta extra es una COPIA de la carpeta del "Kit Impreso + Digital": en un kit sin carpeta
// física no tiene sentido (y el laboratorio no tendría qué duplicar). El portal ya la resetea al
// cambiar de kit; esto lo garantiza del lado del servidor también.
function carpetasExtrasValidas(kitId: string, carpetasExtras: unknown): number {
  if (kitId !== 'kit-clasico') return 0;
  return Math.min(MAX_CARPETAS_EXTRA, Math.max(0, Math.floor(Number(carpetasExtras) || 0)));
}

function calcularTotalPedido(kitId: string, carpetasExtras: unknown, cantidadFotosSueltas: unknown = 0): number | null {
  const precioBaseKit = PRECIOS_KITS[kitId];
  if (precioBaseKit === undefined) return null;
  const extrasValidados = carpetasExtrasValidas(kitId, carpetasExtras);
  const fotosSueltasValidadas = Math.min(
    MAX_FOTOS_SUELTAS,
    Math.max(0, Math.floor(Number(cantidadFotosSueltas) || 0))
  );
  return precioBaseKit + extrasValidados * PRECIO_CARPETA_EXTRA + fotosSueltasValidadas * PRECIO_FOTO_EVENTO;
}

// Crear preferencia de pago en Mercado Pago
app.post('/api/mercadopago/crear-preferencia', limitarFrecuencia('crear-preferencia', 60, 10 * 60 * 1000), async (req, res) => {
  try {
    const {
      pedidoId,
      kitId,
      kitNombre,
      alumnoNombre,
      colegioNombre,
      carpetasExtras,
      cantidadFotosSueltas,
      tutorNombre,
      tutorEmail,
      tutorTelefono,
    } = req.body;

    // Auditoría 2026-09-23 (bug CRÍTICO de cobro): el monto se toma del pedido YA REGISTRADO
    // en la base (columna `total`, calculada por el servidor en /api/pedidos/crear), nunca de
    // kitId/carpetasExtras/cantidadFotosSueltas que mande el navegador acá. Antes se recalculaba
    // con esos datos sueltos: bastaba registrar un Kit Impreso con 3 carpetas extra ($75.000) y
    // después pedir la preferencia de ESE MISMO pedido diciendo "kit-evento-suelto" ($5.000) —
    // el webhook marcaba el pedido como pagado igual y la familia recibía todo por $5.000.
    void kitId; void carpetasExtras; void cantidadFotosSueltas;
    const supabaseCobro = getServerSupabase();
    if (!supabaseCobro) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const cobro = await obtenerPedidosPendientesParaCobro(supabaseCobro, { pedidoId });
    if (cobro.error) {
      return res.status(cobro.status || 400).json({ success: false, error: cobro.error });
    }
    const totalCalculado = Number(cobro.filas[0].total);

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

    // Auditoría 2026-09-23: mp_preference_id nunca se grababa — y el respaldo de reconciliación
    // de /api/pedidos/:id/status sólo corre si esa columna tiene valor, así que ese respaldo
    // (pensado para cuando el webhook de Mercado Pago se pierde) no se ejecutaba nunca.
    if (result.id) {
      await supabaseCobro.from('pedidos').update({ mp_preference_id: String(result.id) }).eq('id', pedidoId);
    }

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

// Auditoría 2026-09-16 (carrito multi-hijo, "un solo pago"): equivalente a
// /api/mercadopago/crear-preferencia, pero arma UNA sola preferencia con un ítem de línea por
// cada hijo del carrito (mismo total combinado que se le va a cobrar a la familia en un único
// checkout). Mismo criterio de seguridad: el monto de cada línea se recalcula siempre acá con
// calcularTotalPedido, nunca se usa un total mandado por el cliente. "external_reference" es el
// grupoPagoId compartido por todos los pedidos de este carrito (ver /api/pedidos/crear-multiple),
// no el id de un pedido puntual — así el webhook sabe que tiene que marcar varias filas como
// pagadas, no una sola.
app.post('/api/mercadopago/crear-preferencia-multiple', limitarFrecuencia('crear-preferencia-multiple', 60, 10 * 60 * 1000), async (req, res) => {
  try {
    const { grupoPagoId, items, tutorNombre, tutorEmail, tutorTelefono } = req.body || {};

    // Los ítems que manda el navegador ya no se usan para cobrar (ver abajo: se cobra lo registrado
    // en la base para este grupo) — sólo hace falta el grupo. Así el portal puede regenerar el link
    // de un carrito sin tener que reconstruir la lista de hijos.
    void items;
    if (!grupoPagoId) {
      return res.status(400).json({ success: false, error: 'Falta el grupo de pago del carrito.' });
    }

    // Auditoría 2026-09-23: igual que en /api/mercadopago/crear-preferencia, cada línea se cobra
    // con el `total` de la fila YA REGISTRADA en la base para este grupo_pago_id — nunca con los
    // datos de kit/carpetas/fotos que mande el navegador en este request.
    const supabaseCobro = getServerSupabase();
    if (!supabaseCobro) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const cobro = await obtenerPedidosPendientesParaCobro(supabaseCobro, { grupoPagoId });
    if (cobro.error) {
      return res.status(cobro.status || 400).json({ success: false, error: cobro.error });
    }
    const mpItems: any[] = cobro.filas.map((fila: any) => ({
      id: fila.id,
      title: `Retrato Escolar 2026 - ${fila.kit_nombre || 'Kit Fotográfico'} (${fila.alumno_nombre || 'Alumno'})`,
      description: `Fotos escolares para ${fila.alumno_nombre || 'alumno'} en ${fila.colegio_nombre || 'el colegio'}`,
      quantity: 1,
      unit_price: Number(fila.total),
      currency_id: 'ARS',
    }));

    const mpConfig = getMercadoPagoConfig();
    if (!mpConfig) {
      return res.status(200).json({
        success: false,
        notConfigured: true,
        error: 'MERCADOPAGO_ACCESS_TOKEN no está configurada en las variables de entorno del servidor.',
      });
    }

    const hostDetectado = req.get('host') || '';
    const esLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostDetectado);
    const protocoloFinal = esLocal ? req.protocol : 'https';
    const appUrl = (process.env.APP_URL || `${protocoloFinal}://${hostDetectado}`).replace(/\/+$/, '');
    const preference = new Preference(mpConfig);

    const preferenceData = {
      body: {
        items: mpItems,
        payer: {
          name: tutorNombre || 'Familia',
          email: tutorEmail && tutorEmail.includes('@') ? tutorEmail : 'pagos@retratoescolar.com.ar',
          phone: { number: tutorTelefono || '' },
        },
        back_urls: {
          success: `${appUrl}/?mp_status=approved&grupo_pago_id=${grupoPagoId}`,
          failure: `${appUrl}/?mp_status=rejected&grupo_pago_id=${grupoPagoId}`,
          pending: `${appUrl}/?mp_status=pending&grupo_pago_id=${grupoPagoId}`,
        },
        auto_return: 'approved',
        external_reference: grupoPagoId,
        notification_url: `${appUrl}/api/mercadopago/webhook`,
        statement_descriptor: 'RETRATO ESCOLAR',
      },
    };

    const result = await preference.create(preferenceData);

    if (result.id) {
      await supabaseCobro.from('pedidos').update({ mp_preference_id: String(result.id) }).eq('grupo_pago_id', grupoPagoId);
    }

    return res.json({
      success: true,
      preferenceId: result.id,
      initPoint: result.init_point,
      sandboxInitPoint: result.sandbox_init_point,
    });
  } catch (error: any) {
    console.error('[Mercado Pago Preference Multiple Error]:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error al crear la preferencia de pago combinada en Mercado Pago',
    });
  }
});

// Auditoría 2026-09-23: kits que se pueden COMPRAR desde el portal. "kit-evento-suelto" ($5.000)
// existe en el catálogo para mostrarse en la landing, pero el portal nunca lo ofrece — y como el
// .zip HD arma TODAS las fotos elegidas (individual/grupal/docente) sin mirar el kit, un pedido
// armado a mano con ese kit recibía el pack completo por $5.000 (y además quedaba marcado como
// "impreso_digital" para el laboratorio). Se rechaza al registrar el pedido.
const KITS_COMPRABLES_PORTAL = new Set(['kit-clasico', 'kit-digital']);

// Auditoría 2026-09-23: el número amigable (IFS-2026-XXXX) lo genera el navegador con 4 dígitos
// al azar, sin chequear si ya existe. Se usa para buscar el pedido, en el correo y (antes) como
// nombre del .zip HD. Acá se garantiza que no se repita: si el propuesto ya existe (o ya se usó
// dentro del mismo carrito) se genera otro en el servidor, y se le devuelve al navegador el final.
async function asegurarFriendlyIdUnico(supabase: SupabaseClient, propuesto: unknown, yaUsados: Set<string>): Promise<string> {
  const formato = /^IFS-\d{4}-\d{4,5}$/; // debe seguir matcheando FORMATO_PEDIDO_FRIENDLY_ID (buscador)
  let candidato = String(propuesto || '').trim().toUpperCase().slice(0, 40);
  for (let intento = 0; intento < 8; intento++) {
    if (formato.test(candidato) && !yaUsados.has(candidato)) {
      const { data } = await supabase.from('pedidos').select('id').eq('pedido_friendly_id', candidato).limit(1);
      if (!data || data.length === 0) {
        yaUsados.add(candidato);
        return candidato;
      }
    }
    // A partir del 3er intento se agranda a 5 dígitos para salir rápido de zonas ya ocupadas.
    const digitos = intento < 3 ? 4 : 5;
    const min = 10 ** (digitos - 1);
    candidato = `IFS-${new Date().getFullYear()}-${crypto.randomInt(min, 10 ** digitos)}`;
  }
  yaUsados.add(candidato);
  return candidato;
}

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
app.post('/api/pedidos/crear', limitarFrecuencia('pedidos-crear', 60, 10 * 60 * 1000), async (req, res) => {
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

    // Auditoría 2026-09-19: la cantidad de "Otras Fotos" sueltas se deriva de la propia lista de
    // ids que manda el cliente (fotosSeleccionadas.otrasIds) — no de un número aparte que el
    // cliente podría inflar o reducir sin relación con lo que realmente eligió.
    const cantidadFotosSueltas = Array.isArray((fotosSeleccionadas as any)?.otrasIds)
      ? (fotosSeleccionadas as any).otrasIds.length
      : 0;
    const totalCalculado = KITS_COMPRABLES_PORTAL.has(String(kitId)) ? calcularTotalPedido(kitId, carpetasExtras, cantidadFotosSueltas) : null;
    if (totalCalculado === null) {
      return res.status(400).json({ success: false, error: 'Kit no reconocido. No se puede registrar el pedido.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    // Ver buscarColegioReal: un pedido con un colegio inexistente nunca cruza con sus fotos.
    const colegioReal = await buscarColegioReal(supabase, colegioId);
    if (!colegioReal) {
      return res.status(400).json({ success: false, error: ERROR_COLEGIO_NO_VALIDO });
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
        else if (Array.isArray(val)) {
          // Auditoría 2026-09-19 (bug real encontrado en auditoría de código): faltaba esta
          // rama — un array (como "otrasIds", los ids de las fotos sueltas/eventos elegidas)
          // no entraba en ninguna de las de arriba y se descartaba en silencio. Consecuencia:
          // ninguna foto suelta quedaba jamás registrada en el pedido guardado, así que ni la
          // generación automática del .zip HD ni el panel de Laboratorio se enteraban de que
          // existían, aunque la familia las hubiera pagado.
          const limpioArray = val
            .filter((item) => typeof item === 'string')
            .map((item) => String(item).slice(0, 200))
            .slice(0, 50);
          if (limpioArray.length > 0) limpio[clave] = limpioArray;
        }
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
    const extrasValidados = carpetasExtrasValidas(String(kitId), carpetasExtras);
    const metodosValidos = ['mercadopago', 'transferencia', 'efectivo', 'nave'];
    const metodoPagoValido = metodosValidos.includes(metodoPago) ? metodoPago : 'mercadopago';
    const cursoCodigoServidor = determinarCodigoCursoServidor(String(grado || ''), String(turno || ''), String(division || ''));
    // Auditoría 2026-09-22 (Pablo: "¿por qué el código minilab no figura?"): mismo refuerzo que
    // ya se aplicó a curso_codigo — codigo_alumno y alumno_numero_lista se calculan siempre acá,
    // nunca se acepta lo que mande el navegador (ver `calcularCodigoAlumnoServidor` y
    // `obtenerNumeroListaSecuencial` más arriba en este archivo).
    const numeroListaServidor = await obtenerNumeroListaSecuencial(supabase, cursoCodigoServidor);
    const codigoAlumnoServidor = calcularCodigoAlumnoServidor(cursoCodigoServidor, numeroListaServidor, acotar(alumnoNombre, 200));

    const filaPedido: Record<string, any> = {
      familia_id: familiaId,
      tipo_kit: tipoKit,
      // Nace SIEMPRE en pendiente_pago — nunca se acepta un "estado" mandado por el cliente.
      // Sólo el webhook de Mercado Pago o el panel de admin (con sesión) lo pueden pasar a
      // "pagado". Ver comentario de auditoría arriba de este endpoint.
      estado: 'pendiente_pago',
      total: totalCalculado,
      // Un kit sólo digital no lleva carpeta impresa.
      carpetas_impresas: kitId === 'kit-clasico' ? extrasValidados + 1 : 0,
      metodo_pago: metodoPagoValido,
      pedido_friendly_id: await asegurarFriendlyIdUnico(supabase, pedidoFriendlyId, new Set()),
      colegio_id: colegioReal.id,
      colegio_nombre: colegioReal.nombre,
      // Auditoría 2026-09-21 (refuerzo tras el bug de "sigue sin armarse el zip"): NUNCA se
      // acepta el curso_codigo tal como lo manda el navegador — ese fue exactamente el bug real
      // que rompió la entrega de HD para todo pedido (ver auditoría en PortalFamiliasModal.tsx).
      // El navegador ya manda grado/turno/división (los mismos que usa para pedir la galería), así
      // que el código de curso se recalcula acá con la MISMA fórmula que usa el resto del sistema
      // para etiquetar las fotos (determinarCodigoCursoServidor) — nunca confiando en el texto
      // suelto `cursoCodigo` del cliente, ni siquiera si el frontend vuelve a tener un bug similar.
      curso_codigo: cursoCodigoServidor,
      grado: acotar(grado, 60) || null,
      division: acotar(division, 60) || null,
      turno: acotar(turno, 60) || null,
      alumno_nombre: acotar(alumnoNombre, 200) || null,
      alumno_numero_lista: numeroListaServidor,
      codigo_alumno: codigoAlumnoServidor,
      kit_nombre: acotar(kitNombre, 120) || null,
      fotos_seleccionadas: acotarJson(fotosSeleccionadas),
      copias_extras: acotarJson(copiasExtras),
      // Auditoría 2026-09-23: el link de descarga HD lo genera SIEMPRE el servidor al confirmarse
      // el pago. Antes se aceptaba el que mandara el navegador: un pedido podía nacer con un link
      // cualquiera, el panel lo mostraba como "HD enviado" y el cron de reintento lo salteaba.
      link_descarga_hd: null,
    };
    void linkDescargaHD;
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

    return res.json({ success: true, pedidoId: pedidoCreado.id, pedidoFriendlyId: filaPedido.pedido_friendly_id, total: totalCalculado });
  } catch (err: any) {
    console.error('Error al registrar pedido:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al registrar el pedido' });
  }
});

// Auditoría 2026-09-16 (pedido de Pablo: "el cliente debe poder hacer multiple pedido en una
// sola sesion, un solo pago"): equivalente a /api/pedidos/crear, pero para el carrito multi-hijo
// del Código Familiar (ver /api/familia/hijos). Registra UNA fila en "pedidos" por cada hijo del
// carrito — la tabla sigue siendo una fila por alumno, eso no cambia — pero todas comparten el
// mismo "grupo_pago_id", que es lo que el webhook de Mercado Pago / Nave usa para marcarlas TODAS
// como pagadas cuando llega una única confirmación de pago. Mismo criterio de seguridad que el
// endpoint de a uno: el monto de cada ítem se recalcula siempre acá con calcularTotalPedido, y el
// pedido nace siempre en "pendiente_pago" — nunca se acepta un total o estado mandado por el
// cliente. No reemplaza a /api/pedidos/crear: una familia con un solo hijo sigue usando ese
// camino exactamente como antes.
app.post('/api/pedidos/crear-multiple', limitarFrecuencia('pedidos-crear-multiple', 60, 10 * 60 * 1000), async (req, res) => {
  try {
    const { tutorNombre, tutorTelefono, tutorEmail, items } = req.body || {};

    if (!Array.isArray(items) || items.length < 2 || items.length > 10) {
      return res.status(400).json({
        success: false,
        error: 'El carrito debe tener entre 2 y 10 hijos para usar el pago conjunto. Con un solo hijo, usá /api/pedidos/crear.',
      });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const acotar = (valor: unknown, maxLen: number): string => String(valor ?? '').trim().slice(0, maxLen);
    const acotarJson = (valor: unknown): Record<string, any> => {
      if (!valor || typeof valor !== 'object' || Array.isArray(valor)) return {};
      const entradas = Object.entries(valor as Record<string, any>).slice(0, 20);
      const limpio: Record<string, any> = {};
      for (const [clave, val] of entradas) {
        if (typeof val === 'string') limpio[clave] = val.slice(0, 200);
        else if (typeof val === 'number' && Number.isFinite(val)) limpio[clave] = val;
        else if (typeof val === 'boolean') limpio[clave] = val;
        else if (Array.isArray(val)) {
          // Auditoría 2026-09-19 (bug real encontrado en auditoría de código): faltaba esta
          // rama — un array (como "otrasIds", los ids de las fotos sueltas/eventos elegidas)
          // no entraba en ninguna de las de arriba y se descartaba en silencio. Consecuencia:
          // ninguna foto suelta quedaba jamás registrada en el pedido guardado, así que ni la
          // generación automática del .zip HD ni el panel de Laboratorio se enteraban de que
          // existían, aunque la familia las hubiera pagado.
          const limpioArray = val
            .filter((item) => typeof item === 'string')
            .map((item) => String(item).slice(0, 200))
            .slice(0, 50);
          if (limpioArray.length > 0) limpio[clave] = limpioArray;
        }
      }
      return limpio;
    };

    // Ver buscarColegioReal: cada hijo del carrito tiene que estar en un colegio real.
    const colegiosReales = new Map<string, { id: string; nombre: string }>();
    for (const item of items) {
      const clave = String(item?.colegioId || '');
      if (colegiosReales.has(clave)) continue;
      const colegio = await buscarColegioReal(supabase, clave);
      if (!colegio) {
        return res.status(400).json({ success: false, error: ERROR_COLEGIO_NO_VALIDO });
      }
      colegiosReales.set(clave, colegio);
    }

    // Un total válido para CADA ítem, calculado siempre del lado del servidor. Si cualquier
    // ítem tiene un kit no reconocido, se corta todo el carrito antes de escribir nada.
    // Auditoría 2026-09-19: ver comentario equivalente en /api/pedidos/crear — la cantidad de
    // "Otras Fotos" sueltas se deriva de la propia lista de ids de cada ítem, no de un número
    // aparte enviado por el cliente.
    const cantidadFotosSueltasDe = (item: any): number =>
      Array.isArray(item?.fotosSeleccionadas?.otrasIds) ? item.fotosSeleccionadas.otrasIds.length : 0;

    let totalGrupo = 0;
    for (const item of items) {
      const totalItem = KITS_COMPRABLES_PORTAL.has(String(item?.kitId)) ? calcularTotalPedido(item?.kitId, item?.carpetasExtras, cantidadFotosSueltasDe(item)) : null;
      if (totalItem === null) {
        return res.status(400).json({
          success: false,
          error: `Kit no reconocido para ${item?.alumnoNombre || 'uno de los hijos'}. No se puede registrar el carrito.`,
        });
      }
      totalGrupo += totalItem;
    }

    let familiaId: string | null = null;
    const nombreTutor = String(tutorNombre || '').trim();
    const telefonoTutor = String(tutorTelefono || '').trim();
    const emailTutor = acotar(tutorEmail, 200);
    if (nombreTutor || telefonoTutor || emailTutor) {
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

    // Referencia compartida por todos los pedidos de este carrito — es lo que Mercado Pago/Nave
    // nos va a devolver como external_reference / external_payment_id de un único pago.
    const grupoPagoId = typeof crypto !== 'undefined' && crypto.randomUUID
      ? crypto.randomUUID()
      : `GRP-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;

    const metodosValidos = ['mercadopago', 'transferencia', 'efectivo', 'nave'];
    const filasPedido: Record<string, any>[] = [];
    // Auditoría 2026-09-22 (Pablo: "¿por qué el código minilab no figura en esos pedidos de
    // prueba?"): este endpoint nunca mandaba `codigoAlumno` desde el navegador (a diferencia de
    // /api/pedidos/crear, el camino de un solo hijo) — cada pedido de un carrito multi-hijo
    // quedaba con `codigo_alumno = null`, invisible en la columna "Código Minilab" del panel.
    // Igual que ahí, ahora se calcula siempre acá, nunca confiando en el navegador. El contador
    // lleva la cuenta por curso DENTRO de este mismo carrito, para que dos hermanos en la misma
    // sección (el caso real de mellizos) no terminen con el mismo número por consultar la base
    // antes de que el hermano anterior del mismo carrito quedara insertado.
    const numeroListaBasePorCurso: Record<string, number> = {};
    const friendlyIdsUsados = new Set<string>();
    for (const item of items) {
      const totalItem = calcularTotalPedido(item?.kitId, item?.carpetasExtras, cantidadFotosSueltasDe(item)) as number;
      const tipoKit = item?.kitId === 'kit-digital' ? 'solo_digital' : 'impreso_digital';
      const extrasValidados = carpetasExtrasValidas(String(item?.kitId), item?.carpetasExtras);
      const metodoPagoValida = metodosValidos.includes(item?.metodoPago) ? item.metodoPago : 'mercadopago';
      const cursoCodigoServidor = determinarCodigoCursoServidor(String(item?.grado || ''), String(item?.turno || ''), String(item?.division || ''));
      if (numeroListaBasePorCurso[cursoCodigoServidor] === undefined) {
        numeroListaBasePorCurso[cursoCodigoServidor] = await obtenerNumeroListaSecuencial(supabase, cursoCodigoServidor) - 1;
      }
      const numeroListaServidor = ++numeroListaBasePorCurso[cursoCodigoServidor];
      const codigoAlumnoServidor = calcularCodigoAlumnoServidor(cursoCodigoServidor, numeroListaServidor, acotar(item?.alumnoNombre, 200));

      const fila: Record<string, any> = {
        familia_id: familiaId,
        tipo_kit: tipoKit,
        estado: 'pendiente_pago',
        total: totalItem,
        carpetas_impresas: item?.kitId === 'kit-clasico' ? extrasValidados + 1 : 0,
        metodo_pago: metodoPagoValida,
        grupo_pago_id: grupoPagoId,
        pedido_friendly_id: await asegurarFriendlyIdUnico(supabase, item?.pedidoFriendlyId, friendlyIdsUsados),
        colegio_id: colegiosReales.get(String(item?.colegioId || ''))!.id,
        colegio_nombre: colegiosReales.get(String(item?.colegioId || ''))!.nombre,
        // Auditoría 2026-09-21: mismo refuerzo que en /api/pedidos/crear — nunca se confía en el
        // curso_codigo que manda el cliente, se deriva siempre de grado/turno/división acá.
        curso_codigo: cursoCodigoServidor,
        grado: acotar(item?.grado, 60) || null,
        division: acotar(item?.division, 60) || null,
        turno: acotar(item?.turno, 60) || null,
        alumno_nombre: acotar(item?.alumnoNombre, 200) || null,
        alumno_numero_lista: numeroListaServidor,
        codigo_alumno: codigoAlumnoServidor,
        kit_nombre: acotar(item?.kitNombre, 120) || null,
        fotos_seleccionadas: acotarJson(item?.fotosSeleccionadas),
        copias_extras: acotarJson(item?.copiasExtras),
        link_descarga_hd: null, // ver /api/pedidos/crear: el link lo genera sólo el servidor
      };
      if (typeof item?.pedidoId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(item.pedidoId)) {
        fila.id = item.pedidoId;
      }
      filasPedido.push(fila);
    }

    const { data: pedidosCreados, error: errorPedidos } = await supabase
      .from('pedidos')
      .insert(filasPedido)
      .select('id');
    if (errorPedidos) throw errorPedidos;

    return res.json({
      success: true,
      grupoPagoId,
      pedidoIds: (pedidosCreados || []).map((p: any) => p.id),
      // Mismo orden que `items`: el número amigable final de cada hijo (puede diferir del que
      // propuso el navegador si ese ya estaba usado — ver asegurarFriendlyIdUnico).
      pedidoFriendlyIds: filasPedido.map((f) => f.pedido_friendly_id),
      total: totalGrupo,
    });
  } catch (err: any) {
    console.error('Error al registrar carrito multi-hijo:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al registrar el carrito' });
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
      // Auditoría 2026-09-19 (bug real encontrado en auditoría de código, BAJO): si faltaba el
      // header x-signature (o venía sin las partes "ts"/"v1" reconocibles), este bloque no
      // hacía nada — ni rechazaba ni advertía — y la notificación se procesaba como si la firma
      // hubiera sido válida. Con MERCADOPAGO_WEBHOOK_SECRET configurado, la intención es
      // rechazar cualquier notificación que no pueda verificarse, no sólo la que tiene una firma
      // presente pero incorrecta.
      if (!xSignature) {
        console.warn('[Mercado Pago Webhook] Falta el header x-signature (con MERCADOPAGO_WEBHOOK_SECRET configurado) — notificación rechazada.');
        return res.status(401).send('Missing signature');
      }
      const parts = xSignature.split(',');
      let ts = '';
      let hash = '';
      for (const part of parts) {
        const [k, v] = part.split('=');
        if (k && k.trim() === 'ts') ts = (v || '').trim();
        if (k && k.trim() === 'v1') hash = (v || '').trim();
      }
      if (!ts || !hash) {
        console.warn('[Mercado Pago Webhook] Header x-signature con formato inesperado — notificación rechazada.');
        return res.status(401).send('Invalid signature format');
      }
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
      if (!compararTimingSafe(hash, expectedHash)) {
        console.warn('[Mercado Pago Webhook] Firma x-signature inválida — notificación rechazada.');
        return res.status(401).send('Invalid signature');
      }
    }

    if ((topic === 'payment' || req.body?.action?.includes('payment')) && paymentId) {
      const payment = new Payment(mpConfig);
      const paymentInfo = await payment.get({ id: String(paymentId) });

      console.log(`[Mercado Pago Webhook] Estado de pago: ${paymentInfo.status}, Ref: ${paymentInfo.external_reference}`);

      const pedidoId = paymentInfo.external_reference;
      const supabase = getServerSupabase();

      if (paymentInfo.status === 'approved') {
        if (pedidoId && supabase) {
          // Auditoría 2026-09-23: toda la lógica de "qué pedidos corresponden a esta referencia"
          // (un pedido suelto por su UUID, o un carrito multi-hijo por grupo_pago_id) + control de
          // monto + marcado idempotente (.neq('estado','pagado'), así un reenvío de Mercado Pago no
          // duplica correos) vive en marcarReferenciaComoPagada — la comparten el webhook de Nave y
          // el respaldo de /api/pedidos/:id/status.
          const orderRows = await marcarReferenciaComoPagada(supabase, String(pedidoId), Number(paymentInfo.transaction_amount), {
            mp_payment_id: String(paymentId),
          });
          await procesarPedidosRecienPagados(supabase, orderRows, paymentInfo.payer?.email, paymentInfo.payer?.first_name);
        }
      } else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
        if (pedidoId && supabase) {
          console.log(`[Mercado Pago Webhook] Marcando pedido ${pedidoId} como rechazado/cancelado.`);
          // Auditoría 2026-09-19 (bug real encontrado en auditoría de código, ALTO): a esta rama
          // le faltaba el mismo ".neq('estado', 'pagado')" que sí tiene la rama "approved" de
          // arriba. Mercado Pago puede reintentar/entregar tarde una notificación de un intento
          // de pago viejo (rechazado) DESPUÉS de que un intento posterior ya haya sido aprobado
          // y el pedido esté "pagado" — sin este guard, esa notificación tardía podía revertir
          // en silencio un pedido ya pagado (y con fotos ya en camino) de vuelta a "cancelado".
          const { data: dataCancelado } = await supabase
            .from('pedidos')
            .update({
              estado: 'cancelado',
              mp_payment_id: String(paymentId),
              updated_at: new Date().toISOString(),
            })
            .eq('id', pedidoId)
            .neq('estado', 'pagado')
            .select('id');
          // Igual que en la rama "approved": si no hay ningún pedido individual con ese id,
          // puede tratarse de un carrito multi-hijo — se cancelan todas las filas del grupo.
          if (!dataCancelado || dataCancelado.length === 0) {
            await supabase
              .from('pedidos')
              .update({
                estado: 'cancelado',
                mp_payment_id: String(paymentId),
                updated_at: new Date().toISOString(),
              })
              .eq('grupo_pago_id', pedidoId)
              .neq('estado', 'pagado');
          }
        }
      }
    }

    return res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Mercado Pago Webhook Error]:', error);
    return res.status(200).send('OK');
  }
});

// Crear intención de pago en Nave (Banco Galicia) — equivalente a
// /api/mercadopago/crear-preferencia, mismo criterio de recalcular siempre el monto en el
// servidor (nunca confiar en un total mandado por el cliente).
app.post('/api/nave/crear-intencion', limitarFrecuencia('nave-crear-intencion', 60, 10 * 60 * 1000), async (req, res) => {
  try {
    const {
      pedidoId, kitId, kitNombre, alumnoNombre, colegioNombre, carpetasExtras, cantidadFotosSueltas,
      tutorNombre, tutorEmail, tutorTelefono,
    } = req.body || {};

    // Auditoría 2026-09-23: el monto sale del pedido ya registrado (ver crear-preferencia de MP).
    void kitId; void carpetasExtras; void cantidadFotosSueltas;
    const supabaseCobro = getServerSupabase();
    if (!supabaseCobro) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const cobro = await obtenerPedidosPendientesParaCobro(supabaseCobro, { pedidoId });
    if (cobro.error) {
      return res.status(cobro.status || 400).json({ success: false, error: cobro.error });
    }
    const totalCalculado = Number(cobro.filas[0].total);

    const credenciales = getNaveCredenciales();
    if (!credenciales) {
      return res.status(200).json({
        success: false,
        notConfigured: true,
        error: 'NAVE_CLIENT_ID / NAVE_CLIENT_SECRET / NAVE_POS_ID no están configuradas en las variables de entorno del servidor.',
      });
    }

    const accessToken = await obtenerNaveAccessToken();
    if (!accessToken) {
      return res.status(502).json({ success: false, error: 'No se pudo autenticar contra la API de Nave.' });
    }

    const hostDetectado = req.get('host') || '';
    const esLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostDetectado);
    const protocoloFinal = esLocal ? req.protocol : 'https';
    const appUrl = (process.env.APP_URL || `${protocoloFinal}://${hostDetectado}`).replace(/\/+$/, '');

    const montoStr = totalCalculado.toFixed(2);
    const { crearIntencion } = getNaveUrls();

    const body: Record<string, any> = {
      // Nave exige un máximo de 36 caracteres para este campo (ver documentación) — un uuid de
      // pedido (36 caracteres exactos) entra justo.
      external_payment_id: String(pedidoId || `PED-${Date.now()}`).slice(0, 36),
      seller: { pos_id: credenciales.posId },
      transactions: [
        {
          amount: { currency: 'ARS', value: montoStr },
          products: [
            {
              name: (kitNombre || 'Kit Fotográfico').slice(0, 100),
              description: `Fotos escolares para ${alumnoNombre || 'alumno'} en ${colegioNombre || 'el colegio'}`.slice(0, 200),
              quantity: 1,
              unit_price: { currency: 'ARS', value: montoStr },
            },
          ],
        },
      ],
      buyer: {
        name: (tutorNombre || 'Familia').slice(0, 100),
        user_id: pedidoId,
      },
      additional_info: {
        callback_url: `${appUrl}/?nave_status=vuelta&pedido_id=${pedidoId}`,
      },
    };
    if (tutorEmail && String(tutorEmail).includes('@')) body.buyer.user_email = tutorEmail;
    if (tutorTelefono) body.buyer.phone = tutorTelefono;

    const resp = await fetch(crearIntencion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok || !data?.checkout_url) {
      console.error('[Nave Crear Intención Error]:', resp.status, data);
      return res.status(502).json({
        success: false,
        error: (data && (data.message || data.error)) || 'Nave rechazó la creación de la intención de pago.',
      });
    }

    // Se guarda el id de la intención (payment_request_id) para poder reconsultarla o cancelarla
    // más adelante — mismo rol que mp_preference_id para Mercado Pago.
    const supabase = getServerSupabase();
    if (supabase && pedidoId) {
      await supabase.from('pedidos').update({ nave_payment_request_id: data.id }).eq('id', pedidoId);
    }

    return res.json({
      success: true,
      checkoutUrl: data.checkout_url,
      qrData: data.qr_data,
      naveId: data.id,
    });
  } catch (error: any) {
    console.error('[Nave Crear Intención Error]:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Error al crear la intención de pago en Nave' });
  }
});

// Auditoría 2026-09-16 (carrito multi-hijo, "un solo pago"): equivalente a
// /api/nave/crear-intencion, pero arma UNA sola intención de pago con un "product" de línea por
// cada hijo del carrito, dentro de la MISMA transacción (Nave sí soporta varios productos por
// transacción) — así Nave cobra el total combinado en un único checkout. Mismo criterio de
// seguridad: cada monto se recalcula siempre acá con calcularTotalPedido. "external_payment_id"
// es el grupoPagoId compartido por todos los pedidos del carrito (ver
// /api/pedidos/crear-multiple) — un uuid entra justo en el límite de 36 caracteres de Nave.
app.post('/api/nave/crear-intencion-multiple', limitarFrecuencia('nave-crear-intencion-multiple', 60, 10 * 60 * 1000), async (req, res) => {
  try {
    const { grupoPagoId, items, tutorNombre, tutorEmail, tutorTelefono } = req.body || {};

    // Los ítems que manda el navegador ya no se usan para cobrar (ver abajo: se cobra lo registrado
    // en la base para este grupo) — sólo hace falta el grupo. Así el portal puede regenerar el link
    // de un carrito sin tener que reconstruir la lista de hijos.
    void items;
    if (!grupoPagoId) {
      return res.status(400).json({ success: false, error: 'Falta el grupo de pago del carrito.' });
    }

    // Auditoría 2026-09-23: montos tomados de las filas ya registradas del carrito (ver MP).
    const supabaseCobro = getServerSupabase();
    if (!supabaseCobro) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }
    const cobro = await obtenerPedidosPendientesParaCobro(supabaseCobro, { grupoPagoId });
    if (cobro.error) {
      return res.status(cobro.status || 400).json({ success: false, error: cobro.error });
    }
    let totalGrupo = 0;
    const products: any[] = cobro.filas.map((fila: any) => {
      const totalItem = Number(fila.total);
      totalGrupo += totalItem;
      return {
        name: (fila.kit_nombre || 'Kit Fotográfico').slice(0, 100),
        description: `Fotos escolares para ${fila.alumno_nombre || 'alumno'} en ${fila.colegio_nombre || 'el colegio'}`.slice(0, 200),
        quantity: 1,
        unit_price: { currency: 'ARS', value: totalItem.toFixed(2) },
      };
    });

    const credenciales = getNaveCredenciales();
    if (!credenciales) {
      return res.status(200).json({
        success: false,
        notConfigured: true,
        error: 'NAVE_CLIENT_ID / NAVE_CLIENT_SECRET / NAVE_POS_ID no están configuradas en las variables de entorno del servidor.',
      });
    }

    const accessToken = await obtenerNaveAccessToken();
    if (!accessToken) {
      return res.status(502).json({ success: false, error: 'No se pudo autenticar contra la API de Nave.' });
    }

    const hostDetectado = req.get('host') || '';
    const esLocal = /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(hostDetectado);
    const protocoloFinal = esLocal ? req.protocol : 'https';
    const appUrl = (process.env.APP_URL || `${protocoloFinal}://${hostDetectado}`).replace(/\/+$/, '');
    const { crearIntencion } = getNaveUrls();

    const body: Record<string, any> = {
      external_payment_id: String(grupoPagoId).slice(0, 36),
      seller: { pos_id: credenciales.posId },
      transactions: [
        {
          amount: { currency: 'ARS', value: totalGrupo.toFixed(2) },
          products,
        },
      ],
      buyer: {
        name: (tutorNombre || 'Familia').slice(0, 100),
        user_id: grupoPagoId,
      },
      additional_info: {
        callback_url: `${appUrl}/?nave_status=vuelta&grupo_pago_id=${grupoPagoId}`,
      },
    };
    if (tutorEmail && String(tutorEmail).includes('@')) body.buyer.user_email = tutorEmail;
    if (tutorTelefono) body.buyer.phone = tutorTelefono;

    const resp = await fetch(crearIntencion, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    });
    const data: any = await resp.json().catch(() => null);
    if (!resp.ok || !data?.checkout_url) {
      console.error('[Nave Crear Intención Multiple Error]:', resp.status, data);
      return res.status(502).json({
        success: false,
        error: (data && (data.message || data.error)) || 'Nave rechazó la creación de la intención de pago combinada.',
      });
    }

    const supabase = getServerSupabase();
    if (supabase) {
      await supabase.from('pedidos').update({ nave_payment_request_id: data.id }).eq('grupo_pago_id', grupoPagoId);
    }

    return res.json({
      success: true,
      checkoutUrl: data.checkout_url,
      qrData: data.qr_data,
      naveId: data.id,
    });
  } catch (error: any) {
    console.error('[Nave Crear Intención Multiple Error]:', error);
    return res.status(500).json({ success: false, error: error?.message || 'Error al crear la intención de pago combinada en Nave' });
  }
});

// Webhook de Nave (Banco Galicia). Se registran dos rutas separadas (producción/sandbox) porque
// así se le pidió a Nave en el alta (dos "notification_url" distintas) — ambas hacen exactamente
// lo mismo, la única diferencia real es contra qué entorno reconsultan (getNaveEntorno() lee la
// misma variable NAVE_ENVIRONMENT para las dos, así que hoy en la práctica sólo una de las dos
// rutas va a coincidir con el entorno configurado; el día que haya credenciales de producción
// separadas convendría separar también esta lógica por ruta en vez de por variable de entorno).
//
// OJO — a diferencia de Resend y de Mercado Pago (que si se le configura MERCADOPAGO_WEBHOOK_SECRET
// firma con HMAC), la documentación de Nave relevada el 15/9/2026 no menciona ningún esquema de
// firma para verificar que esta notificación realmente vino de Nave. Por eso acá NUNCA se usa el
// estado ni el monto que vengan en el cuerpo del POST para decidir nada — sólo se usa para saber
// QUÉ pago hay que reconsultar, y el estado real siempre se obtiene con un GET propio (con
// nuestro access_token) contra la API de Nave. Tampoco se seguye el "payment_check_url" que
// manda la notificación tal cual: se arma la URL nosotros mismos con nuestra propia base
// (sandbox o producción, según NAVE_ENVIRONMENT) + el payment_id, para no arriesgarnos a que
// una notificación falsa con una URL propia nos haga mandarle nuestro access_token a otro lado.
// Auditoría 2026-09-21 (refuerzo): sin límite, una notificación falsa repetida a alta frecuencia
// obligaba a reconsultar la API de Nave una y otra vez (gasto/carga innecesaria). El límite es
// generoso a propósito para no bloquear notificaciones legítimas de Nave en picos de tráfico.
app.post(['/api/nave/webhook', '/api/nave/webhook-sandbox'], limitarFrecuencia('nave-webhook', 1000, 5 * 60 * 1000), async (req, res) => {
  try {
    const credenciales = getNaveCredenciales();
    if (!credenciales) {
      console.warn('[Nave Webhook] Notificación recibida pero NAVE_CLIENT_ID/SECRET/POS_ID no están configuradas.');
      return res.status(200).send('OK');
    }

    const paymentId = req.body?.payment_id;
    if (!paymentId) {
      return res.status(200).send('OK');
    }

    const accessToken = await obtenerNaveAccessToken();
    if (!accessToken) {
      console.error('[Nave Webhook] No se pudo autenticar contra Nave para reconfirmar el pago.');
      return res.status(200).send('OK');
    }

    const { pagos } = getNaveUrls();
    const resp = await fetch(`${pagos}/${encodeURIComponent(String(paymentId))}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const pago: any = await resp.json().catch(() => null);
    if (!resp.ok || !pago) {
      console.error('[Nave Webhook] No se pudo reconsultar el pago', paymentId, resp.status);
      return res.status(200).send('OK');
    }

    const estadoNave: string | undefined = pago?.status?.name;
    const pedidoId: string | undefined = pago?.external_payment_id || req.body?.external_payment_id;
    console.log(`[Nave Webhook] Pago ${paymentId} — estado: ${estadoNave}, pedido: ${pedidoId}`);

    const supabase = getServerSupabase();

    if (estadoNave === 'APPROVED') {
      if (pedidoId && supabase) {
        // Auditoría 2026-09-23: misma lógica compartida que el webhook de Mercado Pago (ver
        // marcarReferenciaComoPagada / procesarPedidosRecienPagados) — incluye el control de que
        // el monto cobrado alcance para lo que vale el pedido y el marcado idempotente.
        const montoPagado = Number(pago?.transactions?.[0]?.amount?.value);
        const orderRows = await marcarReferenciaComoPagada(supabase, String(pedidoId), montoPagado, {
          nave_payment_id: String(paymentId),
        });
        await procesarPedidosRecienPagados(supabase, orderRows);
      }
    } else if (['REJECTED', 'CANCELLED', 'PURCHASE_REVERSED', 'CHARGEBACK_REVIEW', 'CHARGED_BACK'].includes(estadoNave || '')) {
      if (pedidoId && supabase) {
        console.log(`[Nave Webhook] Marcando pedido ${pedidoId} como cancelado (estado Nave: ${estadoNave}).`);
        // Auditoría 2026-09-19 (bug real encontrado en auditoría de código, ALTO): a diferencia
        // de la rama "approved" de arriba, acá no había ningún guard contra una notificación
        // tardía de un intento de pago ya superado. PERO ojo — a diferencia de Mercado Pago, acá
        // "REJECTED"/"CANCELLED" (intento fallido antes de pagar) y
        // "PURCHASE_REVERSED"/"CHARGEBACK_REVIEW"/"CHARGED_BACK" (contracargo DESPUÉS de haber
        // cobrado) son casos distintos: el contracargo debe poder cancelar un pedido que hoy
        // está "pagado" — ahí SÍ es el resultado correcto. El guard sólo aplica a
        // REJECTED/CANCELLED, para no revertir en silencio un pedido que un intento posterior ya
        // dejó pagado.
        const esContracargo = ['PURCHASE_REVERSED', 'CHARGEBACK_REVIEW', 'CHARGED_BACK'].includes(estadoNave || '');
        let queryIndividual = supabase
          .from('pedidos')
          .update({ estado: 'cancelado', nave_payment_id: String(paymentId), updated_at: new Date().toISOString() })
          .eq('id', pedidoId);
        if (!esContracargo) queryIndividual = queryIndividual.neq('estado', 'pagado');
        const { data: dataCancelado } = await queryIndividual.select('id');
        if (!dataCancelado || dataCancelado.length === 0) {
          let queryGrupo = supabase
            .from('pedidos')
            .update({ estado: 'cancelado', nave_payment_id: String(paymentId), updated_at: new Date().toISOString() })
            .eq('grupo_pago_id', pedidoId);
          if (!esContracargo) queryGrupo = queryGrupo.neq('estado', 'pagado');
          await queryGrupo;
        }
      }
    }
    // PENDING no tiene resultado final todavía, y REFUNDED es un reembolso sobre un pedido que
    // ya se dio por pagado/entregado — ninguno de los dos ameríta tocar el estado acá solo.

    return res.status(200).send('OK');
  } catch (error: any) {
    console.error('[Nave Webhook Error]:', error);
    return res.status(200).send('OK');
  }
});

// ==============================================================================
// RUTAS: ZOHO MAIL — CAMPAÑA DE PROSPECCIÓN A COLEGIOS
// ==============================================================================

// 1) Inicia el flujo OAuth: devuelve la URL de consentimiento de Zoho para que el panel
// redirija al navegador. Requiere sesión de admin — solo Pablo puede iniciar esto.
app.get('/api/admin/zoho/connect', requireAdminAuth, (req: Request, res: Response) => {
  const creds = getZohoCredenciales();
  if (!creds) {
    return res.status(500).json({
      success: false,
      error: 'ZOHO_CLIENT_ID / ZOHO_CLIENT_SECRET / ZOHO_REDIRECT_URI no están configuradas en las variables de entorno del servidor.',
    });
  }
  const sessionSecret = getAdminSessionSecret();
  if (!sessionSecret) {
    return res.status(500).json({ success: false, error: 'ADMIN_SESSION_SECRET no configurada en las variables de entorno del servidor.' });
  }
  // El callback de abajo llega como una navegación normal del navegador (Zoho redirige ahí
  // directamente), sin nuestro header de admin — este "state" firmado es lo que prueba que
  // el flujo lo inició una sesión de admin válida, y evita que alguien lo dispare por CSRF.
  const timestamp = Date.now();
  const random = crypto.randomBytes(12).toString('hex');
  const payload = `${timestamp}.${random}`;
  const signature = crypto.createHmac('sha256', sessionSecret).update(payload).digest('hex');
  const state = `${payload}.${signature}`;

  const url = new URL(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/auth`);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', creds.clientId);
  url.searchParams.set('scope', ZOHO_SCOPES);
  url.searchParams.set('redirect_uri', creds.redirectUri);
  url.searchParams.set('access_type', 'offline'); // imprescindible para recibir refresh_token
  url.searchParams.set('prompt', 'consent');
  url.searchParams.set('state', state);
  res.json({ success: true, url: url.toString() });
});

// 2) Callback: Zoho redirige el navegador acá después de que Pablo acepta el consentimiento.
// Ruta pública (no puede llevar el header de admin), protegida por la firma del "state".
app.get('/api/zoho/callback', async (req: Request, res: Response) => {
  const redirigirConError = (mensaje: string) => res.redirect(`/?zoho=error&mensaje=${encodeURIComponent(mensaje)}`);
  try {
    const { code, state, error: zohoError } = req.query as { code?: string; state?: string; error?: string };
    if (zohoError) return redirigirConError(`Zoho rechazó la conexión: ${zohoError}`);
    if (!code || !state) return redirigirConError('Falta el código o el estado de la conexión.');

    const sessionSecret = getAdminSessionSecret();
    if (!sessionSecret) return redirigirConError('ADMIN_SESSION_SECRET no configurada en el servidor.');
    const partes = state.split('.');
    if (partes.length !== 3) return redirigirConError('Estado de conexión inválido.');
    const [timestampStr, random, signature] = partes;
    const timestamp = parseInt(timestampStr, 10);
    if (isNaN(timestamp) || Date.now() - timestamp > 10 * 60 * 1000) {
      return redirigirConError('El enlace de conexión expiró — iniciá el proceso de nuevo desde el panel.');
    }
    const esperada = crypto.createHmac('sha256', sessionSecret).update(`${timestampStr}.${random}`).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(esperada);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      return redirigirConError('Estado de conexión inválido.');
    }

    const creds = getZohoCredenciales();
    if (!creds) return redirigirConError('Credenciales de Zoho no configuradas en el servidor.');

    const tokenResp = await fetch(`${ZOHO_ACCOUNTS_BASE}/oauth/v2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: creds.clientId,
        client_secret: creds.clientSecret,
        redirect_uri: creds.redirectUri,
        grant_type: 'authorization_code',
      }),
    });
    const tokenData: any = await tokenResp.json().catch(() => ({}));
    if (!tokenResp.ok || !tokenData.access_token || !tokenData.refresh_token) {
      console.error('[Zoho] Error al intercambiar código por tokens:', tokenResp.status, tokenData);
      return redirigirConError('Zoho no devolvió un token válido.');
    }
    // OJO — bug real encontrado el 22/9/2026: el "api_domain" que devuelve el token de OAuth es
    // el dominio genérico de la API de Zoho (el que usan CRM, Books, etc., algo como
    // www.zohoapis.com), NO el de Zoho Mail. Zoho Mail vive en un dominio propio y separado
    // por datacenter (mail.zoho.com para EE.UU., mail.zoho.eu, mail.zoho.in, etc.) — nunca hay
    // que derivarlo del "api_domain" del token. Como la cuenta de Pablo es del datacenter de
    // EE.UU. (confirmado al crear la app en la consola de Zoho), queda fijo en mail.zoho.com.
    const apiDomain = 'https://mail.zoho.com';

    // Con el access_token recién obtenido pedimos el accountId (lo exige el endpoint de envío)
    // y el email de la cuenta, para poder mostrarlo en el panel.
    const cuentasResp = await fetch(`${apiDomain}/api/accounts`, {
      headers: { Authorization: `Zoho-oauthtoken ${tokenData.access_token}` },
    });
    const cuentasData: any = await cuentasResp.json().catch(() => ({}));
    const primeraCuenta = cuentasData?.data?.[0];
    if (!cuentasResp.ok || !primeraCuenta?.accountId) {
      console.error('[Zoho] Error al obtener accountId:', cuentasResp.status, cuentasData);
      const detalle = cuentasData?.data?.errorCode || cuentasData?.data?.moreInfo || cuentasData?.message;
      return redirigirConError(`No se pudo obtener la cuenta de Zoho conectada.${detalle ? ` (${detalle})` : ''}`);
    }

    await guardarZohoTokens({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      accountId: String(primeraCuenta.accountId),
      apiDomain,
      cuentaEmail: primeraCuenta.primaryEmailAddress || null,
      expiresAt: Date.now() + (Number(tokenData.expires_in) || 3600) * 1000,
    });

    return res.redirect('/?zoho=conectado');
  } catch (err) {
    console.error('[Zoho] Error en callback OAuth:', err);
    return redirigirConError('Error inesperado al conectar con Zoho.');
  }
});

// 3) Estado de la conexión — usado por el panel para mostrar "conectado como X" o el botón de
// conectar.
app.get('/api/admin/zoho/estado', requireAdminAuth, async (req: Request, res: Response) => {
  const tokens = await obtenerZohoTokensGuardados();
  res.json({
    success: true,
    conectado: Boolean(tokens),
    cuentaEmail: tokens?.cuentaEmail || null,
    remitentesPermitidos: ZOHO_REMITENTES_PERMITIDOS,
    zohoConfigurado: Boolean(getZohoCredenciales()),
  });
});

// 4) Desconectar (borra los tokens guardados; no revoca el permiso del lado de Zoho, pero deja
// a esta app sin forma de mandar correos hasta reconectar).
app.post('/api/admin/zoho/desconectar', requireAdminAuth, async (req: Request, res: Response) => {
  const supabase = getServerSupabase();
  if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
  const { error } = await supabase.from('zoho_oauth_tokens').delete().eq('id', true);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true });
});

// 5) Correo de prueba — SIEMPRE manda a un único destinatario que se pasa explícitamente
// (nunca a un colegio real), usando los datos del primer colegio de ejemplo para previsualizar
// cómo quedan las variables personalizadas. Es un paso obligatorio antes de habilitar el envío
// real (ver el chequeo en /api/admin/zoho/enviar más abajo).
app.post('/api/admin/zoho/prueba', requireAdminAuth, limitarFrecuencia('zoho-prueba', 15, 10 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { destinatarioEjemplo, asunto, cuerpoHtml, remitente, emailPrueba } = req.body || {};
    if (typeof remitente !== 'string' || !ZOHO_REMITENTES_PERMITIDOS.includes(remitente)) {
      return res.status(400).json({ success: false, error: 'Remitente no permitido.' });
    }
    if (typeof asunto !== 'string' || !asunto.trim() || typeof cuerpoHtml !== 'string' || !cuerpoHtml.trim()) {
      return res.status(400).json({ success: false, error: 'Falta el asunto o el cuerpo del correo.' });
    }
    if (typeof emailPrueba !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailPrueba.trim())) {
      return res.status(400).json({ success: false, error: 'Falta un email de destino válido para la prueba.' });
    }
    const destinatario: DestinatarioCampanaZoho = destinatarioEjemplo || {};
    const asuntoPersonalizado = personalizarPlantillaZoho(asunto, destinatario);
    const cuerpoPersonalizado = personalizarPlantillaZoho(cuerpoHtml, destinatario);
    const resultado = await enviarZohoMail({
      fromAddress: remitente,
      toAddress: emailPrueba.trim(),
      subject: `[PRUEBA] ${asuntoPersonalizado}`,
      content: cuerpoPersonalizado,
    });
    const supabase = getServerSupabase();
    if (supabase) {
      await supabase.from('zoho_campana_envios').insert({
        destinatario_email: emailPrueba.trim().toLowerCase(),
        institucion: destinatario.institucion || null,
        asunto: asuntoPersonalizado,
        tipo: 'prueba',
        estado: resultado.ok ? 'enviado' : 'error',
        zoho_message_id: resultado.messageId || null,
        error: resultado.error || null,
      });
    }
    if (!resultado.ok) return res.status(502).json({ success: false, error: resultado.error });
    res.json({ success: true });
  } catch (err: any) {
    console.error('[Zoho] Error al mandar correo de prueba:', err);
    res.status(500).json({ success: false, error: err?.message || 'Error inesperado al mandar el correo de prueba.' });
  }
});

// 6) Envío real — en lotes chicos (máx. 15 por llamada, el panel los va encadenando) para no
// pisar el límite de 60s de la función serverless. Salvaguardas: exige un remitente de la
// lista blanca, exige que haya al menos una prueba exitosa en las últimas 24hs, salta
// destinatarios a los que ya se les mandó un correo real antes (dedup), y espera un poco entre
// cada envío para no disparar límites de tasa / filtros antispam de Zoho.
app.post('/api/admin/zoho/enviar', requireAdminAuth, limitarFrecuencia('zoho-enviar', 40, 10 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    const { destinatarios, asunto, cuerpoHtml, remitente } = req.body || {};
    if (typeof remitente !== 'string' || !ZOHO_REMITENTES_PERMITIDOS.includes(remitente)) {
      return res.status(400).json({ success: false, error: 'Remitente no permitido.' });
    }
    if (typeof asunto !== 'string' || !asunto.trim() || typeof cuerpoHtml !== 'string' || !cuerpoHtml.trim()) {
      return res.status(400).json({ success: false, error: 'Falta el asunto o el cuerpo del correo.' });
    }
    if (!Array.isArray(destinatarios) || destinatarios.length === 0) {
      return res.status(400).json({ success: false, error: 'No hay destinatarios para enviar.' });
    }
    if (destinatarios.length > 15) {
      return res.status(400).json({ success: false, error: 'Máximo 15 destinatarios por llamada — el panel los manda en lotes automáticamente.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });

    const { data: pruebaReciente } = await supabase
      .from('zoho_campana_envios')
      .select('id')
      .eq('tipo', 'prueba')
      .eq('estado', 'enviado')
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1);
    if (!pruebaReciente || pruebaReciente.length === 0) {
      return res.status(412).json({
        success: false,
        error: 'Mandá primero un correo de prueba exitoso (en las últimas 24hs) antes de habilitar el envío real.',
      });
    }

    const resultados: { email: string; estado: 'enviado' | 'error' | 'omitido'; error?: string }[] = [];
    for (const destinatario of destinatarios as DestinatarioCampanaZoho[]) {
      const email = String(destinatario?.email || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        resultados.push({ email: destinatario?.email || '(vacío)', estado: 'error', error: 'Email inválido.' });
        continue;
      }
      // Dedup: si ya le mandamos una campaña real exitosa a este email, lo salteamos — evita
      // reescribirle a la misma institución si Pablo repite el envío tras un corte a mitad de
      // camino.
      const { data: yaEnviado } = await supabase
        .from('zoho_campana_envios')
        .select('id')
        .eq('destinatario_email', email)
        .eq('tipo', 'real')
        .eq('estado', 'enviado')
        .limit(1);
      if (yaEnviado && yaEnviado.length > 0) {
        resultados.push({ email, estado: 'omitido' });
        continue;
      }
      const asuntoPersonalizado = personalizarPlantillaZoho(asunto, destinatario);
      const cuerpoPersonalizado = personalizarPlantillaZoho(cuerpoHtml, destinatario);
      const resultado = await enviarZohoMail({
        fromAddress: remitente,
        toAddress: email,
        subject: asuntoPersonalizado,
        content: cuerpoPersonalizado,
      });
      await supabase.from('zoho_campana_envios').insert({
        destinatario_email: email,
        institucion: destinatario.institucion || null,
        asunto: asuntoPersonalizado,
        tipo: 'real',
        estado: resultado.ok ? 'enviado' : 'error',
        zoho_message_id: resultado.messageId || null,
        error: resultado.error || null,
      });
      resultados.push({ email, estado: resultado.ok ? 'enviado' : 'error', error: resultado.error });
      // Pausa entre envíos — no vamos a mandar 15 de una sola vez sin respiro.
      await new Promise((resolve) => setTimeout(resolve, 600));
    }
    res.json({ success: true, resultados });
  } catch (err: any) {
    console.error('[Zoho] Error al mandar campaña real:', err);
    res.status(500).json({ success: false, error: err?.message || 'Error inesperado al mandar la campaña.' });
  }
});

// 7) Historial — bitácora de lo mandado (de prueba y real) para el panel.
app.get('/api/admin/zoho/historial', requireAdminAuth, async (req: Request, res: Response) => {
  const supabase = getServerSupabase();
  if (!supabase) return res.status(500).json({ success: false, error: 'Supabase no configurado.' });
  const { data, error } = await supabase
    .from('zoho_campana_envios')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) return res.status(500).json({ success: false, error: error.message });
  res.json({ success: true, envios: data });
});

// Endpoint público para que el cliente consulte el estado de pago actualizado de su pedido
// Auditoría 2026-09-21 (refuerzo): la pantalla de "preparando tu descarga" lo consulta en un
// intervalo corto mientras espera, así que el límite tiene que ser generoso para no cortar esa
// consulta legítima — pero sin límite, se podía usar para probar IDs de pedido al voleo.
app.get('/api/pedidos/:id/status', limitarFrecuencia('pedidos-status', 300, 10 * 60 * 1000), async (req, res) => {
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
    // Un id que no tiene forma de UUID nunca puede existir (y Postgres respondería con un error de
    // sintaxis en vez de "no encontrado").
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(id))) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }
    const columnasStatus = 'id, estado, total, updated_at, mp_payment_id, metodo_pago, nave_payment_request_id, mp_preference_id, grupo_pago_id, pedido_friendly_id, link_descarga_hd';
    let { data, error } = await supabase
      .from('pedidos')
      .select(columnasStatus)
      .eq('id', id)
      .maybeSingle();
    // Auditoría 2026-09-23 (bug real): al volver de Mercado Pago/Nave con un carrito multi-hijo en
    // otro dispositivo (sin los pedidos en localStorage), el portal sólo conoce el grupo_pago_id y
    // consulta con ese valor — antes eso daba 404 para siempre (y el portal seguía consultando
    // cada 4 s hasta chocar con el límite de frecuencia). Ahora se resuelve por el grupo.
    if (!error && !data) {
      ({ data, error } = await supabase
        .from('pedidos')
        .select(columnasStatus)
        .eq('grupo_pago_id', id)
        .order('created_at', { ascending: true })
        .limit(1)
        .maybeSingle());
    }

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }

    // Nave no firma sus webhooks (ver comentario en /api/nave/webhook) y, en teoría, una
    // notificación puede perderse — la propia documentación de Nave recomienda esta consulta
    // activa como respaldo ("Consultar una intención de pago... alternativa cuando la
    // notificación no se recibe"). Se aprovecha este endpoint (que el Portal de Familias ya
    // consulta con polling mientras el pago está pendiente) para hacer ese respaldo: si el
    // pedido es de Nave, sigue pendiente, y tenemos el id de la intención, se reconsulta contra
    // Nave y se autocorrige el estado en la base antes de responder.
    let estadoFinal = data.estado;
    if (data.metodo_pago === 'nave' && data.estado === 'pendiente_pago' && data.nave_payment_request_id) {
      try {
        const accessToken = await obtenerNaveAccessToken();
        if (accessToken) {
          const { intenciones } = getNaveUrls();
          const resp = await fetch(`${intenciones}/${encodeURIComponent(data.nave_payment_request_id)}`, {
            headers: { Authorization: `Bearer ${accessToken}` },
          });
          const intencion: any = await resp.json().catch(() => null);
          const estadoIntencion = intencion?.status?.name;
          // Auditoría 2026-09-23: antes esto actualizaba sólo `.eq('id', id)` — en un carrito
          // multi-hijo (varias filas con el mismo grupo_pago_id y UNA sola intención de Nave) sólo
          // el hermano que estaba en pantalla quedaba pagado y los demás seguían "pendiente_pago".
          // Además, al marcarlo pagado acá no se armaba el .zip ni se mandaba el correo, y el
          // webhook que llegaba después ya no lo procesaba (lo encontraba "pagado"). Ahora usa la
          // misma lógica compartida que los webhooks.
          const referencia = data.grupo_pago_id || data.id;
          if (resp.ok && estadoIntencion === 'SUCCESS_PROCESSED') {
            const pagoAprobadoId = intencion?.payment_attempts?.payments?.find((p: any) => p.status === 'APPROVED')?.payment_id;
            const filasPagadas = await marcarReferenciaComoPagada(supabase, referencia, NaN, pagoAprobadoId ? { nave_payment_id: String(pagoAprobadoId) } : {});
            await procesarPedidosRecienPagados(supabase, filasPagadas);
            estadoFinal = 'pagado';
          } else if (resp.ok && (estadoIntencion === 'FAILURE_PROCESSED' || estadoIntencion === 'EXPIRED' || estadoIntencion === 'BLOCKED')) {
            await supabase
              .from('pedidos')
              .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
              .eq(data.grupo_pago_id ? 'grupo_pago_id' : 'id', referencia)
              .neq('estado', 'pagado');
            estadoFinal = 'cancelado';
          }
        }
      } catch (errNave) {
        console.warn('[Nave] No se pudo reconsultar la intención de pago como respaldo:', errNave);
      }
    }

    // Auditoría 2026-09-19 (bug real encontrado en auditoría de código, MEDIO): Mercado Pago SÍ
    // firma sus webhooks (a diferencia de Nave), pero un webhook igual puede perderse por una
    // caída puntual, un timeout, o quedar bloqueado por un error de configuración temporal — y
    // hasta ahora no había ningún respaldo: un pedido pagado en Mercado Pago cuyo webhook no
    // llegara se quedaba en "pendiente_pago" para siempre del lado nuestro, aunque el dinero sí
    // se hubiera acreditado. Mismo criterio que el respaldo de Nave de arriba: si el pedido es
    // de Mercado Pago, sigue pendiente y ya se intentó generar una preferencia de pago
    // (mp_preference_id), se reconsulta directo contra la API de Mercado Pago por
    // external_reference (el id del pedido, o el grupo_pago_id si es un carrito multi-hijo) y se
    // autocorrige el estado antes de responder.
    if (data.metodo_pago === 'mercadopago' && estadoFinal === 'pendiente_pago' && data.mp_preference_id) {
      try {
        const mpConfig = getMercadoPagoConfig();
        if (mpConfig) {
          const referenciaBusqueda = data.grupo_pago_id || data.id;
          const resultadoBusqueda = await new Payment(mpConfig).search({
            options: { external_reference: referenciaBusqueda, sort: 'date_created', criteria: 'desc' },
          });
          const pagos = resultadoBusqueda?.results || [];
          const pagoAprobado = pagos.find((p) => p.status === 'approved');
          // Auditoría 2026-09-23 (bug real): antes alcanzaba con que CUALQUIER intento viejo
          // estuviera rechazado para cancelar el pedido — ej. la tarjeta rebotó y la familia pagó
          // después en efectivo (Rapipago/Pago Fácil, queda "pending" hasta acreditarse): el portal
          // le mostraba "pago rechazado" aunque tuviera un pago en curso. Sólo cuenta el intento
          // MÁS RECIENTE (la búsqueda viene ordenada por fecha, descendente).
          const ultimoPago = pagos[0];
          const pagoRechazado = ultimoPago && (ultimoPago.status === 'rejected' || ultimoPago.status === 'cancelled') ? ultimoPago : undefined;
          if (pagoAprobado) {
            // Auditoría 2026-09-23: misma lógica compartida que el webhook (control de monto +
            // .zip HD + correo). Antes acá sólo se cambiaba el estado y el correo con las fotos no
            // salía nunca por este camino.
            const filasPagadas = await marcarReferenciaComoPagada(
              supabase,
              data.grupo_pago_id || data.id,
              Number(pagoAprobado.transaction_amount),
              pagoAprobado.id ? { mp_payment_id: String(pagoAprobado.id) } : {}
            );
            await procesarPedidosRecienPagados(supabase, filasPagadas, pagoAprobado.payer?.email);
            const { data: releido } = await supabase.from('pedidos').select('estado').eq('id', data.id).maybeSingle();
            estadoFinal = releido?.estado || estadoFinal;
          } else if (pagoRechazado) {
            const filtroActualizacion = data.grupo_pago_id
              ? { columna: 'grupo_pago_id' as const, valor: data.grupo_pago_id }
              : { columna: 'id' as const, valor: data.id };
            await supabase
              .from('pedidos')
              .update({ estado: 'cancelado', updated_at: new Date().toISOString() })
              .eq(filtroActualizacion.columna, filtroActualizacion.valor)
              .neq('estado', 'pagado');
            estadoFinal = 'cancelado';
          }
        }
      } catch (errMp) {
        console.warn('[Mercado Pago] No se pudo reconsultar el pago como respaldo:', errMp);
      }
    }

    const esAprobado = estadoFinal === 'pagado' || estadoFinal === 'entregado';
    const esRechazado = estadoFinal === 'cancelado';

    // Auditoría 2026-09-19: refirma el link de descarga HD contra el mismo .zip ya generado en
    // cada consulta (ver refirmarLinkDescargaHDSiExiste) — así nunca se le devuelve a la familia
    // un link firmado hace más de 90 días que ya dejó de funcionar.
    const linkDescargaHD = await refirmarLinkDescargaHDSiExiste(supabase, data);

    // Monto del pedido (o de todo el carrito, si es un pago combinado): el portal lo usa para
    // completar la pantalla de confirmación cuando la familia vuelve del pago en otro navegador
    // y no tiene el pedido guardado (antes mostraba "$0").
    let totalReferencia = Number(data.total) || 0;
    if (data.grupo_pago_id) {
      const { data: filasGrupo } = await supabase.from('pedidos').select('total').eq('grupo_pago_id', data.grupo_pago_id);
      if (filasGrupo && filasGrupo.length > 0) {
        totalReferencia = filasGrupo.reduce((acc: number, f: any) => acc + (Number(f.total) || 0), 0);
      }
    }

    // Auditoría 2026-09-18 (reporte de Pablo): el Portal de Familias deja de consultar este
    // endpoint apenas el pago queda "aprobado" (ver PortalFamiliasModal.tsx), así que el botón
    // "Descarga Inmediata" se quedaba para siempre en "Preparando..." si el .zip HD tardaba
    // aunque sea unos segundos más que el pago en confirmarse — nunca había una segunda consulta
    // que pudiera enterarse de que el link ya estaba listo. Se agrega el link acá para que el
    // portal pueda activarlo sin esperar al email.
    return res.json({
      success: true,
      pedidoId: data.id,
      estado: estadoFinal,
      estadoPago: esAprobado ? 'aprobado' : esRechazado ? 'rechazado' : 'pendiente',
      actualizadoEl: data.updated_at,
      total: totalReferencia,
      pedidoFriendlyId: data.pedido_friendly_id || undefined,
      linkDescargaHD: linkDescargaHD || undefined,
    });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al consultar estado del pedido' });
  }
});

// Auditoría 2026-09-21 (pedido real de Pablo, probado en producción): empezó a pagar con
// Mercado Pago, canceló la ventana de pago justo antes de confirmar, y volvió a la pantalla de
// "Pendiente de Pago" del Portal de Familias — pero ahí el único botón disponible era "Ir a
// Pagar en Mercado Pago" (regenera el mismo link), sin ninguna forma de elegir Nave o
// Transferencia en su lugar. El método de pago quedaba fijo para siempre en lo que se haya
// elegido al crear el pedido, aunque el pago nunca se hubiera completado. Este endpoint permite
// cambiar el método de pago de un pedido TODAVÍA NO PAGADO — el Portal de Familias lo llama
// cuando la familia elige otro método desde esa misma pantalla de "Pendiente de Pago".
app.post('/api/pedidos/:id/cambiar-metodo-pago', limitarFrecuencia('pedidos-cambiar-metodo-pago', 40, 10 * 60 * 1000), async (req, res) => {
  try {
    const { id } = req.params;
    const { metodoPago } = req.body;
    const metodosPermitidos = ['mercadopago', 'nave', 'transferencia'];
    if (!metodosPermitidos.includes(metodoPago)) {
      return res.status(400).json({ success: false, error: 'Método de pago no reconocido.' });
    }

    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(503).json({ success: false, error: 'Servicio de base de datos no disponible' });
    }

    const { data: pedidoActual, error: errorLectura } = await supabase
      .from('pedidos')
      .select('id, estado, metodo_pago, grupo_pago_id')
      .eq('id', id)
      .maybeSingle();

    if (errorLectura) {
      return res.status(400).json({ success: false, error: errorLectura.message });
    }
    if (!pedidoActual) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }
    // Nunca se permite tocar el método de pago de un pedido que ya se cobró (o que ya se
    // canceló/entregó) — solo tiene sentido mientras sigue "pendiente_pago".
    if (pedidoActual.estado !== 'pendiente_pago') {
      return res.status(409).json({
        success: false,
        error: 'Este pedido ya no está pendiente de pago, así que no se puede cambiar el método.',
      });
    }

    // Un carrito multi-hijo comparte grupo_pago_id entre varias filas de "pedidos" que se cobran
    // juntas en un solo pago — el cambio de método tiene que aplicarse a todo el grupo, no solo a
    // la fila que la familia tenía en pantalla, para no terminar con hermanos del mismo carrito
    // apuntando a métodos de pago distintos.
    const filtroActualizacion = pedidoActual.grupo_pago_id
      ? { columna: 'grupo_pago_id' as const, valor: pedidoActual.grupo_pago_id }
      : { columna: 'id' as const, valor: pedidoActual.id };

    // Se limpian los identificadores del método anterior (el intento de pago viejo queda
    // abandonado, no debería seguir influyendo en la reconciliación automática del /status).
    const { error: errorUpdate } = await supabase
      .from('pedidos')
      .update({
        metodo_pago: metodoPago,
        nave_payment_request_id: null,
        mp_preference_id: null,
        updated_at: new Date().toISOString(),
      })
      .eq(filtroActualizacion.columna, filtroActualizacion.valor)
      .eq('estado', 'pendiente_pago');

    if (errorUpdate) {
      return res.status(400).json({ success: false, error: errorUpdate.message });
    }

    return res.json({ success: true, metodoPago });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err?.message || 'Error al cambiar el método de pago' });
  }
});

// Auditoría 2026-09-22 (pedido de Pablo, viendo la galería de Benjamin Alderete con un pedido
// previo ya hecho: "por qué me deja volver a comprar si ya tengo un pedido hecho? está bien que
// me permita hacer otro pedido, pero primero debería mostrarme el pedido que ya realicé, y un
// cartel preguntarme si deseo hacer otro pedido"). Antes, tocar "Abrir Galería de Fotos" llevaba
// directo al Paso 2 sin importar si ese alumno/a ya tenía un pedido — una familia podía terminar
// pagando dos veces por accidente sin darse cuenta de que ya tenía uno hecho.
//
// Este endpoint se llama justo antes de abrir la galería (ver `handleAbrirGaleria` en
// PortalFamiliasModal.tsx) para avisar si ya existe un pedido para ese alumno puntual en ese
// curso. No requiere login porque, para llegar a este punto, la familia ya pasó por el único
// camino real que desbloquea la galería de ese alumno (código de sección real, o identificación
// por nombre+DNI del tutor) — este chequeo no expone nada que esa familia no pueda ya ver. Aun
// así se devuelve sólo un resumen mínimo (sin teléfono/email/link de descarga) y se rate-limitea
// como el resto de los endpoints públicos de pedidos.
app.get('/api/pedidos/existente', limitarFrecuencia('pedidos-existente', 100, 10 * 60 * 1000), async (req: Request, res: Response) => {
  try {
    // Auditoría 2026-09-23 (bug: el aviso de "ya tenés un pedido" NUNCA aparecía): el portal
    // mandaba acá el código SECRETO de la sección (ej. "88BU-M8TF") como `cursoCodigo`, pero
    // `pedidos.curso_codigo` guarda el código DETERMINÍSTICO de curso (ej. "GRADO1-ATM") que
    // calcula el servidor al crear el pedido — dos valores que nunca coinciden, así que la
    // respuesta era siempre `existe: false`. Ahora se reciben colegio/grado/turno/división y el
    // código de curso se recalcula acá con la misma fórmula que usa /api/pedidos/crear. Además se
    // filtra por colegio (el código de curso se repite entre colegios distintos).
    const colegioId = String(req.query.colegioId || '').trim().slice(0, 100);
    const grado = String(req.query.grado || '').trim().slice(0, 60);
    const turno = String(req.query.turno || '').trim().slice(0, 60);
    const division = String(req.query.division || '').trim().slice(0, 60);
    const alumnoNombre = String(req.query.alumnoNombre || '').trim().slice(0, 200);
    if (!colegioId || !grado || !turno || !alumnoNombre) {
      return res.status(400).json({ success: false, error: 'Faltan datos del alumno.' });
    }
    const cursoCodigo = determinarCodigoCursoServidor(grado, turno, division);

    const supabase = getServerSupabase();
    if (!supabase) return res.status(503).json({ success: false, error: 'Servicio de base de datos no disponible' });

    const nombreBuscado = normalizarNombrePorPalabras(alumnoNombre);
    const { data, error } = await supabase
      .from('pedidos')
      .select('id, pedido_friendly_id, alumno_nombre, kit_nombre, total, estado, created_at')
      .eq('curso_codigo', cursoCodigo)
      .eq('colegio_id', colegioId)
      .neq('estado', 'cancelado')
      .order('created_at', { ascending: false })
      .limit(50);
    if (error) throw error;

    const encontrado = (data || []).find((p) => normalizarNombrePorPalabras(p.alumno_nombre) === nombreBuscado);
    if (!encontrado) {
      return res.json({ success: true, existe: false });
    }

    return res.json({
      success: true,
      existe: true,
      pedido: {
        id: encontrado.pedido_friendly_id || encontrado.id,
        kit: encontrado.kit_nombre,
        // Siempre número: el portal hace total.toLocaleString() y un null rompía la pantalla.
        total: Number(encontrado.total) || 0,
        estado: encontrado.estado,
        fecha: encontrado.created_at,
      },
    });
  } catch (err: any) {
    console.error('Error al verificar pedido existente:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al verificar si ya existe un pedido.' });
  }
});

// Auditoría 2026-09-09 (revisión a fondo): el buscador de "seguimiento de pedido" del Portal de
// Familias buscaba únicamente en el localStorage del navegador — una familia que entrara desde
// otro dispositivo o hubiera borrado los datos del navegador no encontraba su pedido, aunque
// estuviera pagado y guardado en Supabase. Este endpoint público (sin login, como corresponde a
// una búsqueda que hace la propia familia con su número de pedido o teléfono) permite buscar
// contra los datos reales.
//
// Auditoría 2026-09-19 (bug real encontrado en auditoría de seguridad): el diseño original de
// este endpoint decía ser "deliberadamente angosto para no poder usarse para barrer la base de
// pedidos de otras familias", pero no lo era: buscaba con `ilike('%query%')` (coincide con
// CUALQUIER parte del texto) contra un número de pedido con sólo ~9.000 combinaciones posibles
// (se genera en el navegador como IFS-2026-<4 dígitos al azar>) y devolvía nombre, teléfono y un
// link de descarga de fotos HD válido por 90 días — bastaba probar "0000".."9999" como número de
// 4 dígitos para ir sacando, pedido por pedido, los datos de cualquier familia. Se corrige así:
//   1) Coincidencia EXACTA del número de pedido completo (ya no alcanza con un fragmento) y con
//      el formato validado (IFS-2026-XXXX) — ya no sirve probar únicamente 4 dígitos sueltos.
//   2) Para la búsqueda por teléfono, se exige el número casi completo (8+ dígitos en vez de 6)
//      — sigue permitiendo que una familia lo tipee sin el 0 o el 15 iniciales, pero ya no
//      alcanza con adivinar sólo 6 dígitos al azar.
//   3) El límite de intentos por IP baja de 15 cada 10 minutos a 5 cada 30 minutos, específico
//      para este endpoint, para que ni siquiera intentando desde una sola IP real (que además
//      Vercel no deja falsificar, ver x-forwarded-for) sea práctico recorrer las combinaciones
//      posibles.
const FORMATO_PEDIDO_FRIENDLY_ID = /^[A-Z]{2,4}-\d{4}-\d{3,5}$/;

app.get('/api/pedidos/buscar', limitarFrecuencia('pedidos-buscar', 10, 30 * 60 * 1000), async (req, res) => {
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

    const columnas = 'id, pedido_friendly_id, colegio_nombre, alumno_nombre, grado, division, kit_nombre, total, estado, created_at, link_descarga_hd, familias(nombre, whatsapp)';
    let fila: any = null;

    if (FORMATO_PEDIDO_FRIENDLY_ID.test(query)) {
      const { data } = await supabase
        .from('pedidos')
        .select(columnas)
        .ilike('pedido_friendly_id', query)
        .order('created_at', { ascending: false })
        .limit(1);
      if (data && data.length > 0) fila = data[0];
    }

    // Auditoría 2026-09-23 (privacidad): el teléfono de una familia NO es un secreto (lo tiene
    // todo el grupo de WhatsApp del curso — mismo criterio que ya se aplica en
    // /api/inscripciones/buscar). Antes, buscando por teléfono se devolvía el link de descarga de
    // las fotos HD pagadas y el teléfono completo. Ahora, por teléfono sólo se informa el estado
    // del pedido; el link HD se devuelve únicamente buscando por el número de pedido exacto (que
    // sólo tiene la familia, en su correo/comprobante), y el link igual le llega por email.
    let encontradoPorTelefono = false;
    if (!fila && soloDigitos.length >= 8) {
      const { data, error } = await supabase
        .from('pedidos')
        .select('id, pedido_friendly_id, colegio_nombre, alumno_nombre, grado, division, kit_nombre, total, estado, created_at, link_descarga_hd, familias!inner(nombre, whatsapp)')
        .ilike('familias.whatsapp', `%${soloDigitos}%`)
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) console.warn('[pedidos/buscar] búsqueda por teléfono falló:', error.message);
      if (data && data.length > 0) {
        fila = data[0];
        encontradoPorTelefono = true;
      }
    }

    if (!fila) {
      return res.status(404).json({ success: false, error: 'No se encontró ningún pedido registrado con ese número o teléfono.' });
    }

    // Auditoría 2026-09-19: ver comentario de refirmarLinkDescargaHDSiExiste en
    // /api/pedidos/:id/status — mismo criterio acá, para que este buscador tampoco devuelva un
    // link de descarga vencido después de 90 días.
    const linkDescargaHD = encontradoPorTelefono ? undefined : await refirmarLinkDescargaHDSiExiste(supabase, fila);
    const telefonoCompleto = String(fila.familias?.whatsapp || '');
    // El teléfono se muestra siempre enmascarado: la familia ya lo conoce, y el número de pedido
    // (4 dígitos) no es un secreto lo bastante fuerte como para devolver un dato de contacto.
    const telefonoMostrado = telefonoCompleto ? `***${telefonoCompleto.replace(/\D/g, '').slice(-4)}` : null;

    return res.json({
      success: true,
      pedido: {
        id: fila.pedido_friendly_id || fila.id,
        colegio: fila.colegio_nombre,
        alumno: fila.alumno_nombre,
        grado: fila.grado,
        division: fila.division,
        tutor: fila.familias?.nombre || null,
        telefono: telefonoMostrado,
        kit: fila.kit_nombre,
        total: Number(fila.total) || 0,
        fecha: fila.created_at,
        estado: fila.estado,
        linkDescargaHD: linkDescargaHD || null,
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
