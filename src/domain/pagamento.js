export const StatusPagamento = Object.freeze({
  PROCESSANDO: 'PROCESSANDO',
  APROVADO: 'APROVADO',
  RECUSADO: 'RECUSADO',
  INDEFINIDO: 'INDEFINIDO',
  APROVADO_TARDIO: 'APROVADO_TARDIO',
});

export const STATUS_PAGAMENTO_VIVO = Object.freeze([StatusPagamento.PROCESSANDO, StatusPagamento.INDEFINIDO, StatusPagamento.APROVADO]);
