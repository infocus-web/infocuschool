import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import PortalFamiliasModal from '../PortalFamiliasModal';
import {
  CODIGO_FAMILIAR,
  familiaActivaMellizos,
  mockearFetchFamiliaYGaleria,
} from '../../test/fixtures/familiaMellizos';

// Estas pruebas cubren, de punta a punta (renderizando el modal real, sin mockear su lógica
// interna), la serie de bugs de "carrito multi-hijo" encontrados en septiembre de 2026 — todos
// reportados por Pablo usando el caso real de sus mellizos (2 hijos en la MISMA sección: mismo
// grado, turno y división, por lo tanto la MISMA galería de fotos). Antes de estas pruebas, los
// únicos controles eran auditorías de lectura de código (que no ven este tipo de bug, porque sólo
// aparece siguiendo una secuencia concreta de clics) y el propio uso real de Pablo en producción.
//
// Cada test deja seteada `localStorage` como si la familia ya se hubiera identificado con su
// Código Familiar (así el Paso 1 se salta directo a la pantalla de confirmación de datos) y
// registra en el `fetch` global las dos respuestas que el modal necesita: la lista de hijos y la
// galería de fotos de la sección compartida.

function prepararFamiliaActivaEnLocalStorage() {
  localStorage.setItem('infocus_familia_activa_v1', JSON.stringify(familiaActivaMellizos));
}

/** Abre el modal ya con la familia identificada y avanza del Paso 1 al Paso 2 (Galería). */
async function abrirGaleriaConDosHijos() {
  const user = userEvent.setup();
  render(<PortalFamiliasModal isOpen={true} onClose={() => {}} />);

  // Paso 1: para una familia ya verificada con más de un hijo, el botón "Abrir Galería de Fotos"
  // está disponible en cuanto termina de cargar `hijosFamilia` (ver useEffect en el componente).
  const botonAbrirGaleria = await screen.findByRole('button', { name: /abrir galería de fotos/i });
  await user.click(botonAbrirGaleria);

  // Confirma que ya estamos en el Paso 2 con los 2 hermanos listados.
  await screen.findByRole('group', { name: /tus hijos\/as en este colegio/i });
  return user;
}

/** Click en el selector "Tus hijos/as" para pasar al hermano con ese nombre. */
async function cambiarAHijo(user: ReturnType<typeof userEvent.setup>, nombre: string) {
  const contenedor = screen.getByRole('group', { name: /tus hijos\/as en este colegio/i });
  const boton = within(contenedor).getByRole('button', { name: new RegExp(nombre, 'i') });
  await user.click(boton);
}

async function elegirFoto(user: ReturnType<typeof userEvent.setup>, categoria: 'grupal' | 'individual' | 'docente', titulo: RegExp) {
  // Las 3 categorías tienen su propio "slot" arriba (Foto 1/2/3 de 3) que cambia la pestaña activa.
  const slotLabels: Record<typeof categoria, RegExp> = {
    grupal: /^1\/3 grupal$/i,
    individual: /^2\/3 retrato$/i,
    docente: /^3\/3 con seño$/i,
  };
  const slot = screen.getByText(slotLabels[categoria]).closest('div')!.parentElement!;
  await user.click(slot);

  const tarjeta = (await screen.findAllByText(titulo))[0].closest('div.relative')!;
  const botonElegir = within(tarjeta as HTMLElement).getByRole('button', { name: /^elegir$/i });
  await user.click(botonElegir);
}

describe('PortalFamiliasModal — carrito multi-hijo (mellizos, misma sección)', () => {
  beforeEach(() => {
    prepararFamiliaActivaEnLocalStorage();
    mockearFetchFamiliaYGaleria();
  });

  it('no cruza fotos entre hermanos cuando uno tiene selección parcial (fix definitivo del 21/9)', async () => {
    const user = await abrirGaleriaConDosHijos();

    // Pablo Alder (hijo activo por defecto) elige SOLO la foto individual — selección parcial,
    // que es justo el caso que el primer intento de fix (sólo limpiar si "no había nada guardado")
    // no cubría.
    await elegirFoto(user, 'individual', /foto individual/i);

    // Cambia a Sofia Alder: como comparte la misma sección (mismo array `fotosDisponibles`), antes
    // del fix definitivo la foto individual de Pablo quedaba visible como si Sofia ya la hubiera
    // elegido.
    await cambiarAHijo(user, 'Sofia');
    expect(screen.queryByText(/elegida/i)).not.toBeInTheDocument();

    // Sofia elige su propia foto grupal (categoría distinta a la que había elegido Pablo).
    await elegirFoto(user, 'grupal', /foto grupal/i);

    // Vuelve a Pablo: su individual debe seguir marcada, pero la grupal de Sofia NO debe
    // aparecer como si Pablo también la hubiera elegido.
    await cambiarAHijo(user, 'Pablo');
    const slotIndividualPablo = screen.getByText(/^2\/3 retrato$/i).closest('div')!.parentElement!;
    expect(within(slotIndividualPablo).queryByText(/sin elegir/i)).not.toBeInTheDocument();
    const slotGrupalPablo = screen.getByText(/^1\/3 grupal$/i).closest('div')!.parentElement!;
    expect(within(slotGrupalPablo).getByText(/sin elegir/i)).toBeInTheDocument();
  });

  it('bloquea el avance a Kit/Formato si un hermano no eligió sus 3 fotos', async () => {
    const user = await abrirGaleriaConDosHijos();

    // Pablo (activo) completa sus 3 fotos.
    await elegirFoto(user, 'grupal', /foto grupal/i);
    await elegirFoto(user, 'individual', /foto individual/i);
    await elegirFoto(user, 'docente', /foto.*seño|foto docente/i);

    // Sofia no eligió nada todavía. Intentar avanzar estando parado en Pablo (que sí está
    // completo) no debe dejar pasar al Paso 3 — este era exactamente el bug reportado.
    const botonContinuar = screen.getByRole('button', { name: /elegir kit y formato/i });
    await user.click(botonContinuar);

    // No debe haber avanzado al Paso 3 (el selector de kits no aparece) y sí debe haber cambiado
    // automáticamente a la pantalla de Sofia — el botón ahora refleja SU conteo (0/3), no el de
    // Pablo — con un mensaje pidiendo elegir sus fotos.
    expect(await screen.findByText(/tenés que elegir las 3 fotos de sofia alder/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /elegí las 3 fotos \(0\/3\)/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /elegir kit y formato/i })).not.toBeInTheDocument();
  });

  it('permite avanzar a Kit/Formato cuando AMBOS hermanos completaron sus 3 fotos', async () => {
    const user = await abrirGaleriaConDosHijos();

    await elegirFoto(user, 'grupal', /foto grupal/i);
    await elegirFoto(user, 'individual', /foto individual/i);
    await elegirFoto(user, 'docente', /foto.*seño|foto docente/i);

    await cambiarAHijo(user, 'Sofia');
    await elegirFoto(user, 'grupal', /foto grupal/i);
    await elegirFoto(user, 'individual', /foto individual/i);
    await elegirFoto(user, 'docente', /foto.*seño|foto docente/i);

    const botonContinuar = screen.getByRole('button', { name: /elegir kit y formato/i });
    await user.click(botonContinuar);

    // Ya en el Paso 3: aparece el selector de Kits ("Elegí tu Kit Fotográfico").
    await screen.findByText(/elegí tu kit fotográfico/i);
  });

  it('un hermano cuyo curso todavía no tiene fotos no bloquea la compra del otro (25/9)', async () => {
    // Mismo escenario, pero el servidor informa que el curso de Sofia todavía no tiene fotos: antes
    // "Elegir Kit y Formato" exigía sus 3 fotos (imposible) y la familia no podía comprar nunca.
    const fetchBase = global.fetch as unknown as ReturnType<typeof vi.fn>;
    const implementacionBase = fetchBase.getMockImplementation() as (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>;
    fetchBase.mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input.toString();
      if (url.includes('/api/reservas/pendiente') && decodeURIComponent(url).includes('Sofia')) {
        return { ok: true, status: 200, json: async () => ({ success: true, reserva: null, fotosDisponibles: false, tienePedidoPagado: false }) } as Response;
      }
      return implementacionBase(input, init);
    });
    const user = await abrirGaleriaConDosHijos();

    await elegirFoto(user, 'grupal', /foto grupal/i);
    await elegirFoto(user, 'individual', /foto individual/i);
    await elegirFoto(user, 'docente', /foto.*seño|foto docente/i);

    await user.click(screen.getByRole('button', { name: /elegir kit y formato/i }));
    await screen.findByText(/elegí tu kit fotográfico/i);
  });
});
