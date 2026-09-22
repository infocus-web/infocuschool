import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
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

  // Confirma que ya estamos en el Paso 2 con los 2 hermanos listados. Auditoría 2026-09-22: la
  // fila de datos del alumno y el selector de hermanos/as se unificaron en una sola tarjeta
  // compacta (antes eran dos tarjetas separadas, la segunda con el título "Tus hijos/as en este
  // colegio" que hacía de marcador para esta prueba) — ahora el marcador es directamente el botón
  // del segundo hermano, que sólo existe cuando `hijosFamilia.length > 1`. El nombre se ancla
  // exacto (^...$) porque también existe, más abajo, un botón "Restar carpeta extra de Sofia
  // Alder" cuyo accesible-name contiene el mismo nombre como substring.
  await screen.findByRole('button', { name: /^sofia alder$/i });
  return user;
}

/** Click en el selector de hermano/a para pasar al que tiene ese nombre. */
async function cambiarAHijo(user: ReturnType<typeof userEvent.setup>, nombre: string) {
  const boton = screen.getByRole('button', { name: new RegExp(`^${nombre} alder$`, 'i') });
  await user.click(boton);
}

async function elegirFoto(user: ReturnType<typeof userEvent.setup>, categoria: 'grupal' | 'individual' | 'docente', titulo: RegExp) {
  // Las 3 categorías tienen su propio "slot" arriba (Foto 1/2/3 de 3) que cambia la pestaña activa.
  const slotLabels: Record<typeof categoria, RegExp> = {
    grupal: /foto 1 de 3 \(grupal/i,
    individual: /foto 2 de 3 \(retrato/i,
    docente: /foto 3 de 3 \(con seño/i,
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
    const slotIndividualPablo = screen.getByText(/foto 2 de 3 \(retrato/i).closest('div')!.parentElement!;
    expect(within(slotIndividualPablo).getByText(/clic para cambiar/i)).toBeInTheDocument();
    const slotGrupalPablo = screen.getByText(/foto 1 de 3 \(grupal/i).closest('div')!.parentElement!;
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
});
