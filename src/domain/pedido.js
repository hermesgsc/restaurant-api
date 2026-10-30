export const CANAIS_PEDIDO = Object.freeze(['APP', 'TOTEM', 'BALCAO', 'PICKUP', 'WEB']);

export const StatusPedido = Object.freeze({
  AGUARDANDO_PAGAMENTO: 'AGUARDANDO_PAGAMENTO',
  EM_PREPARO: 'EM_PREPARO',
  PRONTO: 'PRONTO',
  ENTREGUE: 'ENTREGUE',
  CANCELADO: 'CANCELADO',
});

export const STATUS_PEDIDO = Object.freeze(Object.values(StatusPedido));

export const ReservaEstoque = Object.freeze({ ATIVA: 'ATIVA', CONSUMIDA: 'CONSUMIDA', LIBERADA: 'LIBERADA' });

export const LIMITES_PEDIDO = Object.freeze({ maxLinhas: 20, maxQuantidade: 99 });
