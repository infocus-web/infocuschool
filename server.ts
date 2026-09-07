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

app.use(express.json());

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
app.post('/api/admin/login', (req, res) => {
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
    const { data, error } = await supabase.from('pedidos').select('*, pedido_fotos(*)').order('created_at', { ascending: false });
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

    const updates: Record<string, any> = {
      updated_at: new Date().toISOString(),
    };
    if (estadoPago) {
      updates.estado_pago = estadoPago;
      updates.estado = estadoPago === 'aprobado' ? 'pagado' : 'pendiente';
    }
    if (estadoEntrega) {
      updates.estado_entrega = estadoEntrega;
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

// Galería pública: fotos reales de un curso puntual (grado+turno+división) para el portal de familias.
// Si todavía no hay fotos reales cargadas para ese curso, el frontend usa fotos de muestra.
app.get('/api/fotos', async (req: Request, res: Response) => {
  try {
    const { grado, turno, division } = req.query as Record<string, string | undefined>;
    if (!grado || !turno) {
      return res.status(400).json({ success: false, error: 'Faltan grado y turno para buscar la galería' });
    }
    const supabase = getServerSupabase();
    if (!supabase) {
      return res.status(500).json({ success: false, error: 'Supabase no configurado en el servidor' });
    }

    const codigoCurso = determinarCodigoCursoServidor(grado, turno, division || '');
    const { data, error } = await supabase
      .from('fotos')
      .select('*')
      .eq('codigo_curso', codigoCurso)
      .order('created_at', { ascending: true });
    if (error) throw error;

    return res.json({ success: true, fotos: data || [] });
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
function determinarCodigoCursoServidor(grado: string, turno: string, division: string): string {
  const g = (grado || '').toLowerCase();
  const t = (turno || '').toLowerCase();
  const d = (division || '').toLowerCase();

  if (g.includes('3')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA3JE';
    if (t.includes('tarde') || d.includes('b')) return 'SALA3TT';
    return 'SALA3TM';
  }
  if (g.includes('4')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA4JE';
    if (d.includes('c')) return 'SALA4C';
    if (t.includes('tarde') || d.includes('b')) return 'SALA4TT';
    return 'SALA4A';
  }
  if (g.includes('5')) {
    if (t.includes('jornada') || t.includes('extendida') || d.includes('extendida')) return 'SALA5JE';
    if (d.includes('c')) return 'SALA5C';
    if (t.includes('tarde') || d.includes('b')) return 'SALA5B';
    return 'SALA5A';
  }
  return 'SALA3TM';
}

function normalizarTelefonoServidor(tel: string): string {
  return (tel || '').replace(/\D/g, '');
}

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
      grado,
      division,
      turno,
      solicitaFotoHermanos,
      hermanos
    } = req.body || {};

    if (!padreNombre || !alumnoNombre || !colegioId || !telefonoWhatsApp || !email) {
      return res.status(400).json({ success: false, error: 'Faltan datos obligatorios para la inscripción' });
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

    if (estado !== 'aceptado' && matchPadre) {
      estado = 'aceptado';
      codigoAcceso = String(
        matchPadre.codigo_asignado || determinarCodigoCursoServidor(grado, turno, division)
      ).trim().toUpperCase();
    }

    const inscripcionRow: Record<string, any> = {
      padre_nombre: String(padreNombre).trim(),
      telefono_whatsapp: String(telefonoWhatsApp).trim(),
      email: cleanEmail,
      alumno_nombre: String(alumnoNombre).trim(),
      alumno_apellido: String(alumnoApellido || '').trim(),
      turno: String(turno || 'Mañana').trim(),
      grado: String(grado || 'Sala 3 años').trim(),
      division: String(division || 'A').trim(),
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
      notificacion_email_enviada: inscripcionExistente ? Boolean(inscripcionExistente.notificacion_email_enviada) : false,
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

    if (matchPadre && matchPadre.id) {
      await supabase
        .from('padres_autorizados')
        .update({ usado: true, updated_at: new Date().toISOString() })
        .eq('id', matchPadre.id);
    }

    return res.json({
      success: true,
      estado,
      codigoAcceso,
      inscripcion: resultadoFila,
    });
  } catch (err: any) {
    console.error('Error al validar inscripción:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error interno al procesar inscripción' });
  }
});

// Recuperar mi inscripción por teléfono, email o código (público). Devuelve como máximo UN registro
// propio — nunca la tabla completa — y usa siempre comparaciones exactas/parametrizadas (nada de
// interpolar el texto del usuario en un filtro .or() crudo, que sería explotable).
app.post('/api/inscripciones/buscar', async (req: Request, res: Response) => {
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

    let encontrada: any = null;

    const tryEq = async (column: string, value: string) => {
      if (encontrada || !value) return;
      const { data } = await supabase.from('inscripciones').select('*').eq(column, value).limit(1);
      if (data && data.length > 0) encontrada = data[0];
    };

    await tryEq('codigo_asignado', qUpper);
    await tryEq('codigo_familiar', qUpper);
    await tryEq('email', qEmail);

    if (!encontrada && qTel.length >= 6) {
      const { data } = await supabase.from('inscripciones').select('*').ilike('telefono_whatsapp', `%${qTel}%`).limit(1);
      if (data && data.length > 0) encontrada = data[0];
    }

    if (!encontrada) {
      return res.json({ success: false });
    }

    return res.json({ success: true, inscripcion: encontrada });
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

    const codigoFinal = String(
      codigo || existente.codigo_asignado || determinarCodigoCursoServidor(existente.grado, existente.turno, existente.division)
    ).trim().toUpperCase();

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

// Recibe la lista pegada por la secretaría del colegio y la guarda en padres_autorizados,
// evitando duplicados (por teléfono o email) contra lo ya cargado para ese colegio.
app.post('/api/padron/institucion/:colegioId', async (req: Request, res: Response) => {
  try {
    const { colegioId } = req.params;
    const { codigo, filas } = req.body || {};

    const resultado = await validarTokenPadronInstitucion(colegioId, codigo);
    if (!resultado.ok) {
      return res.status(resultado.status).json({ success: false, error: resultado.error });
    }
    const { supabase } = resultado;

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
  } catch (err: any) {
    console.error('Error al cargar padrón desde la institución:', err);
    return res.status(500).json({ success: false, error: err?.message || 'Error al guardar los datos' });
  }
});

// ==============================================================================
// 5. HELPER PARA ENVÍO DE EMAIL CON RESEND
// ==============================================================================
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
  const nombreDestinatario = tutorNombre?.trim() || 'Familia';
  const nombreAlumnoStr = alumnoNombre?.trim() || 'el alumno/a';
  const colegioStr = colegioNombre?.trim() || 'la institución';
  const enlaceHD =
    linkDescargaHD ||
    `https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/${cursoCodigo || '2026'}/${pedidoId || 'pedido'}.zip`;

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
        ${colegioStr} • Curso: ${cursoCodigo || '2026'}
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

      <div style="margin: 28px 0; text-align: center;">
        <a href="${enlaceHD}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.35);">
          ⬇️ Descargar Fotos en Alta Resolución (HD)
        </a>
        <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
          Formato original (.ZIP / JPEG 300 DPI) listo para imprimir o guardar
        </div>
      </div>

      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px; margin: 24px 0;">
        <div style="font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1px; color: #64748b; margin-bottom: 12px;">
          Resumen de tu Pedido
        </div>
        <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
          <tr>
            <td style="padding: 6px 0; color: #64748b;">N° de Pedido:</td>
            <td style="padding: 6px 0; font-weight: 700; text-align: right; font-family: monospace; color: #0f172a;">${pedidoId || 'IFS-2026'}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Alumno/a:</td>
            <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #0f172a;">${nombreAlumnoStr}</td>
          </tr>
          <tr>
            <td style="padding: 6px 0; color: #64748b;">Kit Seleccionado:</td>
            <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #0f172a;">${kitNombre || 'Kit Escolar'}</td>
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
        ${whatsappContacto ? `
        <p style="margin: 0;">
          ¿Tienes alguna duda con la descarga? Puedes contactar directamente a nuestro equipo por WhatsApp al <strong>+${whatsappContacto}</strong>.
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
  const nombreDestinatario = padreNombre?.trim() || 'Familia';
  const colegioStr = colegioNombre?.trim() || 'la institución';

  const listaHijosHtml = alumnos
    .map(
      (a) =>
        `<li style="margin-bottom:4px;">${a.nombre} ${a.apellido} — ${a.grado} "${a.division}", Turno ${a.turno}</li>`
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

app.get(['/api/resend/status', '/resend/status'], (req, res) => {
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

app.post(['/api/enviar-fotos-hd', '/enviar-fotos-hd'], async (req, res) => {
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

app.post(['/api/resend/test', '/resend/test'], async (req, res) => {
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

// Crear preferencia de pago en Mercado Pago
app.post('/api/mercadopago/crear-preferencia', async (req, res) => {
  try {
    const {
      pedidoId,
      kitNombre,
      alumnoNombre,
      colegioNombre,
      total,
      tutorNombre,
      tutorEmail,
      tutorTelefono,
    } = req.body;

    const mpConfig = getMercadoPagoConfig();
    if (!mpConfig) {
      return res.status(200).json({
        success: false,
        notConfigured: true,
        error: 'MERCADOPAGO_ACCESS_TOKEN no está configurada en las variables de entorno del servidor.',
      });
    }

    const appUrl = (process.env.APP_URL || `${req.protocol}://${req.get('host')}`).replace(/\/+$/, '');
    const preference = new Preference(mpConfig);

    const preferenceData = {
      body: {
        items: [
          {
            id: pedidoId || `PED-${Date.now()}`,
            title: `Retrato Escolar 2026 - ${kitNombre || 'Kit Fotográfico'} (${alumnoNombre || 'Alumno'})`,
            description: `Fotos escolares para ${alumnoNombre} en ${colegioNombre}`,
            quantity: 1,
            unit_price: Number(total) || 1,
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
          if (hash !== expectedHash) {
            console.warn('[Mercado Pago Webhook] Advertencia: La firma x-signature no coincide.');
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
            // Actualizar el pedido en Supabase
            const { data, error } = await supabase
              .from('pedidos')
              .update({
                estado_pago: 'aprobado',
                estado: 'pagado',
                mercadopago_payment_id: String(paymentId),
                updated_at: new Date().toISOString(),
              })
              .eq('id', pedidoId)
              .select();

            if (error) {
              console.error('[Mercado Pago Webhook] Error al actualizar pedido en Supabase:', error);
            } else if (data && data.length > 0) {
              orderData = data[0];
            }
          }

          // Disparar email automático con fotos HD y comprobante
          const emailDestino = paymentInfo.payer?.email || orderData?.tutor_email;
          if (emailDestino && emailDestino.includes('@')) {
            console.log(`[Mercado Pago Webhook] Enviando fotos HD para pedido ${pedidoId} a ${emailDestino}`);
            await enviarCorreoFotosHD({
              to: emailDestino,
              tutorNombre: orderData?.tutor_nombre || paymentInfo.payer?.first_name || 'Familia',
              alumnoNombre: orderData?.alumno_nombre || 'Alumno/a',
              colegioNombre: orderData?.colegio_nombre || 'Colegio',
              cursoCodigo: orderData?.curso_codigo || 'Curso',
              pedidoId: pedidoId,
              kitNombre: orderData?.kit_nombre || 'Kit Digital Escolar',
              total: paymentInfo.transaction_amount || 0,
              linkDescargaHD: `https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/${orderData?.curso_codigo || '2026'}/${pedidoId}.zip`,
              whatsappContacto: orderData?.tutor_telefono || '',
            });
          }
        }
      } else if (paymentInfo.status === 'rejected' || paymentInfo.status === 'cancelled') {
        if (pedidoId && supabase) {
          console.log(`[Mercado Pago Webhook] Marcando pedido ${pedidoId} como rechazado/cancelado.`);
          await supabase
            .from('pedidos')
            .update({
              estado_pago: 'rechazado',
              estado: 'cancelado',
              mercadopago_payment_id: String(paymentId),
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

    const { data, error } = await supabase
      .from('pedidos')
      .select('id, estado, estado_pago, updated_at, mercadopago_payment_id')
      .eq('id', id)
      .maybeSingle();

    if (error) {
      return res.status(400).json({ success: false, error: error.message });
    }

    if (!data) {
      return res.status(404).json({ success: false, error: 'Pedido no encontrado' });
    }

    const esAprobado = data.estado_pago === 'aprobado' || data.estado === 'pagado';
    const esRechazado = data.estado_pago === 'rechazado' || data.estado === 'cancelado';

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
