import { describe, expect, it } from 'vitest';
import { volvioSinPagar } from '../pagoRetorno';

describe('volvioSinPagar', () => {
  it('detecta la vuelta sin pago de Mercado Pago', () => {
    expect(volvioSinPagar('?mp_status=rejected&grupo_pago_id=G1&reserva=1')).toBe(true);
    expect(volvioSinPagar('?mp_status=pending&grupo_pago_id=G1&collection_id=null&collection_status=null&payment_id=null&status=null')).toBe(true);
    expect(volvioSinPagar('?mp_status=pending&grupo_pago_id=G1&status=rejected')).toBe(true);
  });

  it('no marca como abandonado un pago aprobado o en proceso real', () => {
    expect(volvioSinPagar('?mp_status=approved&grupo_pago_id=G1&payment_id=123&status=approved')).toBe(false);
    expect(volvioSinPagar('?mp_status=pending&grupo_pago_id=G1&payment_id=123&status=in_process')).toBe(false);
    expect(volvioSinPagar('?nave_status=vuelta&grupo_pago_id=G1')).toBe(false);
  });
});
