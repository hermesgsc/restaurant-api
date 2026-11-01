import { erros } from './erros.js';
import { Papel } from './papeis.js';
import { StatusPedido } from './pedido.js';

const { AGUARDANDO_PAGAMENTO, EM_PREPARO, PRONTO, ENTREGUE, CANCELADO } = StatusPedido;

// transicoes possiveis e por onde cada uma acontece.
// PAGAMENTO e SISTEMA nao sao papeis: sao o fluxo de pagamento e o cancelamento/expiracao.
export const TRANSICOES = Object.freeze([
  { de: AGUARDANDO_PAGAMENTO, para: EM_PREPARO, via: 'PAGAMENTO', papeis: [] },
  { de: AGUARDANDO_PAGAMENTO, para: CANCELADO, via: 'CANCELAMENTO', papeis: [Papel.CLIENTE, Papel.ATENDENTE, Papel.GERENTE, Papel.ADMIN] },
  { de: EM_PREPARO, para: PRONTO, via: 'STATUS', papeis: [Papel.COZINHA, Papel.GERENTE, Papel.ADMIN] },
  { de: PRONTO, para: ENTREGUE, via: 'STATUS', papeis: [Papel.ATENDENTE, Papel.GERENTE, Papel.ADMIN] },
]);

// usado pelo PATCH /pedidos/{id}/status. so EM_PREPARO -> PRONTO -> ENTREGUE
// passa por aqui; qualquer outra combinacao (pular etapa, voltar, repetir
// ENTREGUE) e 409. papel sem permissao pra transicao e 403.
export function validarTransicaoManual(de, para, papel) {
  const transicao = TRANSICOES.find((t) => t.de === de && t.para === para);
  if (!transicao || transicao.via !== 'STATUS') {
    throw erros.conflito('TRANSICAO_INVALIDA', `Transicao de ${de} para ${para} nao permitida.`, [
      { field: 'status', issue: proximaEtapa(de) ? `Proximo status valido: ${proximaEtapa(de)}` : `Pedido em ${de} nao avanca por esta rota.` },
    ]);
  }
  if (!transicao.papeis.includes(papel)) throw erros.proibido(`O papel ${papel} nao pode mudar o pedido para ${para}.`);
  return transicao;
}

export function proximaEtapa(status) {
  return TRANSICOES.find((t) => t.de === status && t.via === 'STATUS')?.para ?? null;
}
