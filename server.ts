import express, { Request, Response, NextFunction } from 'express';
import path from 'path';
import crypto from 'crypto';
import { createServer as createViteServer } from 'vite';
import { Resend } from 'resend';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { MercadoPagoConfig, Preference, Payment } from 'mercadopago';
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
