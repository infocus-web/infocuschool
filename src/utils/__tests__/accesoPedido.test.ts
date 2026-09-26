import { beforeEach, describe, expect, it } from 'vitest';
import { guardarLlavePedido, obtenerLlavePedido, urlEstadoPedido } from '../accesoPedido';

describe('llave de acceso del pedido', () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.history.replaceState(null, '', '/');
  });

  it('sin llave, consulta el estado sin parámetro t', () => {
    expect(urlEstadoPedido('abc')).toBe('/api/pedidos/abc/status');
  });

  it('usa la llave guardada al crear el pedido', () => {
    guardarLlavePedido(['grupo-1', 'pedido-1'], 'LLAVE123');
    expect(urlEstadoPedido('pedido-1')).toBe('/api/pedidos/pedido-1/status?t=LLAVE123');
    expect(obtenerLlavePedido('grupo-1')).toBe('LLAVE123');
  });

  it('toma la llave de la URL de vuelta de la pasarela sólo para ese pedido', () => {
    window.history.replaceState(null, '', '/?mp_status=approved&grupo_pago_id=g-9&t=DESDEURL');
    expect(obtenerLlavePedido('g-9')).toBe('DESDEURL');
    expect(obtenerLlavePedido('otro')).toBeNull();
    window.history.replaceState(null, '', '/');
    expect(obtenerLlavePedido('g-9')).toBe('DESDEURL');
  });
});
