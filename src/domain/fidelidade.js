import { erros } from './erros.js';

export const REGRA_FIDELIDADE = Object.freeze({
  centavosPorPonto: 100,
  multiploResgate: 10,
  centavosPorBlocoResgate: 100,
});

export const TipoLancamento = Object.freeze({
  CREDITO: 'CREDITO',
  RESGATE: 'RESGATE',
  ESTORNO_RESGATE: 'ESTORNO_RESGATE',
  BAIXA_ANONIMIZACAO: 'BAIXA_ANONIMIZACAO',
});

export const StatusResgate = Object.freeze({ RESERVADO: 'RESERVADO', CONFIRMADO: 'CONFIRMADO', LIBERADO: 'LIBERADO' });

export function pontosGanhos(valorPagoCentavos) {
  return Math.floor(valorPagoCentavos / REGRA_FIDELIDADE.centavosPorPonto);
}

export function valorDosPontos(pontos) {
  return Math.floor(pontos / REGRA_FIDELIDADE.multiploResgate) * REGRA_FIDELIDADE.centavosPorBlocoResgate;
}

export function descontoDoResgate(pontos, subtotalCentavos) {
  if (!Number.isInteger(pontos) || pontos <= 0 || pontos % REGRA_FIDELIDADE.multiploResgate !== 0) {
    throw erros.validacao('RESGATE_INVALIDO', 'Os pontos devem ser resgatados em multiplos de 10.', [
      { field: 'pontosResgatar', issue: 'Use um multiplo de 10 maior que zero.' },
    ]);
  }
  const desconto = valorDosPontos(pontos);
  if (desconto > subtotalCentavos) {
    const maximo = Math.floor(subtotalCentavos / REGRA_FIDELIDADE.centavosPorBlocoResgate) * REGRA_FIDELIDADE.multiploResgate;
    throw erros.validacao('RESGATE_ACIMA_DO_SUBTOTAL', 'O desconto do resgate nao pode passar do subtotal do pedido.', [
      { field: 'pontosResgatar', issue: `Maximo para este pedido: ${maximo} pontos.` },
    ]);
  }
  return desconto;
}
