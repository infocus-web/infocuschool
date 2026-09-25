/**
 * ¿La familia volvió de Mercado Pago SIN pagar ("Volver a la tienda", cerrar el checkout, pago
 * rechazado)? Mercado Pago lo indica en la URL de vuelta: usa la back_url de "failure"
 * (mp_status=rejected) y/o agrega status/collection_status/payment_id en "null". Caso real (25/9):
 * sin esto, la pantalla quedaba "Confirmando tu pago…" esperando un pago que nunca existió.
 */
export function volvioSinPagar(search: string): boolean {
  const params = new URLSearchParams(search);
  const mpStatus = params.get('mp_status');
  if (mpStatus === 'rejected' || mpStatus === 'failure') return true;
  const estadosSinPago = new Set(['null', 'rejected', 'cancelled', 'canceled']);
  const status = params.get('collection_status') ?? params.get('status');
  if (status && estadosSinPago.has(status)) return true;
  const paymentId = params.get('payment_id') ?? params.get('collection_id');
  return paymentId === 'null';
}
