import { erros } from './erros.js';

export const TipoMovimento = Object.freeze({
  ENTRADA: 'ENTRADA',
  AJUSTE: 'AJUSTE',
  RESERVA: 'RESERVA',
  CONSUMO: 'CONSUMO',
  LIBERACAO: 'LIBERACAO',
});

export function disponivel(saldo) {
  return saldo.total - saldo.reservada;
}

// regra central do estoque: recebe o saldo atual e devolve o novo, ou lanca
// erro se o movimento deixaria algo negativo ou reservaria mais que o disponivel.
// a reserva separa a unidade pro pedido; o consumo baixa total e reserva juntos
// quando o pagamento aprova; a liberacao devolve a reserva sem mexer no total.
export function aplicarMovimento(saldo, tipo, quantidade) {
  if (!Number.isSafeInteger(quantidade) || quantidade === 0) throw new RangeError('quantidade invalida');
  if (tipo !== TipoMovimento.AJUSTE && quantidade < 0) throw new RangeError('quantidade deve ser positiva');
  const novo = { ...saldo };
  switch (tipo) {
    case TipoMovimento.ENTRADA:
      novo.total += quantidade;
      break;
    case TipoMovimento.AJUSTE:
      novo.total += quantidade;
      if (novo.total < novo.reservada) {
        throw erros.conflito('AJUSTE_INVALIDO', 'O ajuste deixaria o estoque abaixo do que ja esta reservado ou negativo.', [
          { field: 'quantidade', issue: `Disponivel para baixa: ${disponivel(saldo)}` },
        ]);
      }
      break;
    case TipoMovimento.RESERVA:
      if (quantidade > disponivel(saldo)) {
        throw erros.conflito('ESTOQUE_INSUFICIENTE', 'Estoque insuficiente para um dos itens.', [
          { field: 'quantidade', issue: `Disponivel: ${disponivel(saldo)}` },
        ]);
      }
      novo.reservada += quantidade;
      break;
    case TipoMovimento.CONSUMO:
      if (quantidade > saldo.reservada) throw new Error('consumo maior que a reserva');
      novo.total -= quantidade;
      novo.reservada -= quantidade;
      break;
    case TipoMovimento.LIBERACAO:
      if (quantidade > saldo.reservada) throw new Error('liberacao maior que a reserva');
      novo.reservada -= quantidade;
      break;
    default:
      throw new Error(`tipo de movimento desconhecido: ${tipo}`);
  }
  return novo;
}
