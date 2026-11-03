export const StatusPagamento = Object.freeze({
  PROCESSANDO: 'PROCESSANDO',
  APROVADO: 'APROVADO',
  RECUSADO: 'RECUSADO',
  INDEFINIDO: 'INDEFINIDO',
  APROVADO_TARDIO: 'APROVADO_TARDIO',
});

// pagamento que ainda pode cobrar ou ja cobrou: bloqueia um segundo pagamento
// do mesmo pedido e decide se o pedido pode ser cancelado ou expirar
export const STATUS_PAGAMENTO_VIVO = Object.freeze([StatusPagamento.PROCESSANDO, StatusPagamento.INDEFINIDO, StatusPagamento.APROVADO]);
