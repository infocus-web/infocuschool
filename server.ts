import express from 'express';
import path from 'path';
import { createServer as createViteServer } from 'vite';
import { Resend } from 'resend';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

// Helper para inicialización lazy de Resend
function getResendClient(): Resend | null {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey || apiKey.trim() === '') {
    return null;
  }
  return new Resend(apiKey);
}

// 1. Estado de la integración de Resend
app.get('/api/resend/status', (req, res) => {
  const apiKey = process.env.RESEND_API_KEY;
  const isConfigured = Boolean(apiKey && apiKey.trim().length > 0);
  const fromEmail = process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>';
  
  res.json({
    configured: isConfigured,
    fromEmail,
    maskedKey: isConfigured ? `${apiKey!.substring(0, 6)}...${apiKey!.slice(-4)}` : null,
    domain: 'retratoescolar.com.ar'
  });
});

// 2. Endpoint para enviar las fotos en HD a la familia automáticamente
app.post('/api/enviar-fotos-hd', async (req, res) => {
  try {
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
      esImpreso
    } = req.body;

    if (!to || !to.includes('@')) {
      return res.status(400).json({
        success: false,
        error: 'Debe proporcionarse un correo electrónico de destino válido.'
      });
    }

    const resend = getResendClient();
    if (!resend) {
      console.warn('[Resend] API Key no configurada. El pedido se registró pero el email requiere RESEND_API_KEY en .env');
      return res.json({
        success: false,
        warning: 'RESEND_API_KEY no está configurada en las variables de entorno.',
        simulated: true,
        previewLink: linkDescargaHD
      });
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'Retrato Escolar <fotos@retratoescolar.com.ar>';
    const nombreDestinatario = tutorNombre?.trim() || 'Familia';
    const nombreAlumno = alumnoNombre?.trim() || 'el alumno/a';
    const colegio = colegioNombre?.trim() || 'la institución';
    const enlaceHD = linkDescargaHD || `https://ntkqypxvrljuihbxdrtx.supabase.co/storage/v1/object/public/fotos-hd/2026/${cursoCodigo}/${pedidoId}.zip`;

    const htmlContent = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Tus fotos en Alta Resolución - ${nombreAlumno}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
  <div style="max-width: 600px; margin: 24px auto; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
    
    <!-- Encabezado de marca -->
    <div style="background-color: #0f172a; padding: 32px 24px; text-align: center; border-bottom: 3px solid #f59e0b;">
      <div style="font-size: 11px; font-weight: 800; letter-spacing: 2px; color: #f59e0b; text-transform: uppercase; margin-bottom: 6px;">
        RETRATO ESCOLAR • EDICIÓN 2026
      </div>
      <h1 style="color: #ffffff; margin: 0; font-size: 22px; font-weight: 800; letter-spacing: -0.5px;">
        ¡Tus Fotografías en Alta Resolución ya están listas!
      </h1>
      <p style="color: #94a3b8; font-size: 13px; margin: 6px 0 0 0;">
        ${colegio} • Curso: ${cursoCodigo || '2026'}
      </p>
    </div>

    <!-- Contenido principal -->
    <div style="padding: 28px 24px;">
      <p style="font-size: 15px; line-height: 1.6; margin-top: 0;">
        Hola <strong>${nombreDestinatario}</strong>,
      </p>
      <p style="font-size: 14px; line-height: 1.6; color: #334155;">
        Confirmamos con éxito el pedido de las fotografías escolares de <strong>${nombreAlumno}</strong>. 
        A continuación tienes acceso directo a tus archivos digitales en calidad original de imprenta (300 DPI, Ultra HD y sin marcas de agua).
      </p>

      <!-- Botón de Descarga HD -->
      <div style="margin: 28px 0; text-align: center;">
        <a href="${enlaceHD}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #d97706; color: #ffffff; font-size: 15px; font-weight: 700; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(217, 119, 6, 0.35);">
          ⬇️ Descargar Fotos en Alta Resolución (HD)
        </a>
        <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
          Formato original (.ZIP / JPEG 300 DPI) listo para imprimir o guardar
        </div>
      </div>

      <!-- Resumen del Pedido -->
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
            <td style="padding: 6px 0; font-weight: 700; text-align: right; color: #0f172a;">${nombreAlumno}</td>
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
      <!-- Nota para Kit Impreso -->
      <div style="background-color: #fffbeb; border: 1px solid #fde68a; border-radius: 12px; padding: 14px 16px; margin-bottom: 24px;">
        <div style="font-size: 12px; font-weight: 700; color: #92400e; margin-bottom: 4px;">
          📦 Entrega de Material Impreso:
        </div>
        <div style="font-size: 12px; color: #78350f; line-height: 1.5;">
          Tu kit incluye las fotos reveladas en papel fotográfico profesional y carpeta institucional. Serán enviadas directamente al colegio para ser entregadas en mano en el plazo informado.
        </div>
      </div>
      ` : ''}

      <!-- Instrucciones de descarga -->
      <div style="font-size: 12px; color: #64748b; line-height: 1.6; border-top: 1px solid #e2e8f0; padding-top: 16px;">
        <p style="margin: 0 0 8px 0;">
          💡 <strong>Recomendación:</strong> Guarda una copia de las fotos en tu Google Drive, Google Fotos o en tu computadora para conservarlas siempre con su máxima calidad.
        </p>
        ${whatsappContacto ? `
        <p style="margin: 0;">
          ¿Tienes alguna duda con la descarga? Puedes contactar directamente a nuestro equipo por WhatsApp al <strong>+${whatsappContacto}</strong>.
        </p>
        ` : ''}
      </div>
    </div>

    <!-- Pie de página institucional -->
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
      subject: `📸 Tus fotos en Alta Resolución - ${nombreAlumno} (${colegio})`,
      html: htmlContent
    });

    console.log('[Resend] Email enviado con éxito:', data);
    return res.json({
      success: true,
      messageId: data.data?.id,
      from: fromEmail,
      to
    });
  } catch (error: any) {
    console.error('[Resend] Error al enviar email:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error inesperado al enviar el correo mediante Resend'
    });
  }
});

// 3. Endpoint para probar el envío de un correo desde el panel de administración
app.post('/api/resend/test', async (req, res) => {
  try {
    const { to } = req.body;
    if (!to || !to.includes('@')) {
      return res.status(400).json({ success: false, error: 'Email de destino inválido' });
    }

    const resend = getResendClient();
    if (!resend) {
      return res.status(400).json({
        success: false,
        error: 'No se detectó RESEND_API_KEY en las variables de entorno. Configúrala en Settings o en tu archivo .env.'
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
      `
    });

    return res.json({
      success: true,
      messageId: data.data?.id,
      from: fromEmail
    });
  } catch (error: any) {
    console.error('[Resend Test] Error:', error);
    return res.status(500).json({
      success: false,
      error: error?.message || 'Error al enviar email de prueba'
    });
  }
});

// Vite middleware para servir la SPA en desarrollo o estáticos en producción
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
