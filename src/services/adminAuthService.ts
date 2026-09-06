/**
 * Servicio de autenticación segura del Panel de Administración contra el servidor
 */

const ADMIN_TOKEN_KEY = 'infocus_admin_session_token';

export interface LoginResult {
  success: boolean;
  token?: string;
  error?: string;
}

export async function loginAdminConServidor(pin: string): Promise<LoginResult> {
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ pin }),
    });

    const data = await res.json();
    if (res.ok && data.success && data.token) {
      if (typeof window !== 'undefined') {
        sessionStorage.setItem(ADMIN_TOKEN_KEY, data.token);
      }
      return { success: true, token: data.token };
    }

    return {
      success: false,
      error: data.error || 'PIN de fotógrafo incorrecto.',
    };
  } catch (err: any) {
    console.error('Error al autenticar admin en servidor:', err);
    return {
      success: false,
      error: 'Error al conectar con el servidor de autenticación.',
    };
  }
}

export function obtenerTokenAdmin(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(ADMIN_TOKEN_KEY);
}

export function cerrarSesionAdmin(): void {
  if (typeof window !== 'undefined') {
    sessionStorage.removeItem(ADMIN_TOKEN_KEY);
  }
}

export async function verificarSesionAdmin(): Promise<boolean> {
  const token = obtenerTokenAdmin();
  if (!token) return false;

  try {
    const res = await fetch('/api/admin/verify', {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!res.ok) {
      cerrarSesionAdmin();
      return false;
    }
    const data = await res.json();
    return Boolean(data.valid);
  } catch {
    return false;
  }
}

export async function fetchAdminAutenticado(url: string, options: RequestInit = {}): Promise<Response> {
  const token = obtenerTokenAdmin();
  const headers = new Headers(options.headers || {});
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  return fetch(url, {
    ...options,
    headers,
  });
}

/**
 * Actualiza el estado de un pedido en Supabase mediante el servidor Express con token admin
 */
export async function actualizarEstadoPedidoAdmin(
  pedidoId: string,
  updates: { estadoPago?: string; estadoEntrega?: string }
): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/pedidos/${encodeURIComponent(pedidoId)}/estado`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(updates),
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}

/**
 * Elimina un pedido mediante el servidor Express con token admin
 */
export async function eliminarPedidoAdmin(pedidoId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/pedidos/${encodeURIComponent(pedidoId)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}

/**
 * Elimina una foto mediante el servidor Express con token admin
 */
export async function eliminarFotoAdmin(fotoId: string): Promise<{ success: boolean; error?: string }> {
  try {
    const res = await fetchAdminAutenticado(`/api/admin/fotos/${encodeURIComponent(fotoId)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    return data;
  } catch (err: any) {
    return { success: false, error: err?.message || 'Error de red' };
  }
}
