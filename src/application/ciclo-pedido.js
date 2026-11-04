import { agora, placeholders, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { ehFuncionario, Papel } from '../domain/papeis.js';
import { TipoMovimento } from '../domain/estoque.js';
import { ReservaEstoque, StatusPedido } from '../domain/pedido.js';
import { STATUS_PAGAMENTO_VIVO, StatusPagamento } from '../domain/pagamento.js';
import { validarTransicaoManual } from '../domain/maquina-estados.js';

export const MotivoCancelamento = Object.freeze({
  SOLICITADO: 'SOLICITADO',
  PAGAMENTO_RECUSADO: 'PAGAMENTO_RECUSADO',
  EXPIRADO: 'EXPIRADO',
});

export function criarCicloPedido({ db, auditoria, estoque, pedidos, fidelidade }) {
  const buscarItens = db.prepare('SELECT produto_id, quantidade FROM pedido_itens WHERE pedido_id = ? ORDER BY id');
  const pagamentoVivo = db.prepare(`SELECT id, status FROM pagamentos WHERE pedido_id = ? AND status IN (${placeholders(STATUS_PAGAMENTO_VIVO)})`);

  function movimentarItens(pedido, tipo, usuarioId) {
    for (const item of buscarItens.all(pedido.id)) {
      estoque.movimentar({ unidadeId: pedido.unidade_id, produtoId: item.produto_id, tipo, quantidade: item.quantidade, pedidoId: pedido.id, usuarioId });
    }
  }

  function confirmarPagamento(pedidoId, usuarioId) {
    const instante = agora();
    const r = db.prepare(`UPDATE pedidos SET status = ?, reserva_estoque_status = ?, pago_em = ?, atualizado_em = ?
      WHERE id = ? AND status = ? AND reserva_estoque_status = ?`).run(
      StatusPedido.EM_PREPARO, ReservaEstoque.CONSUMIDA, instante, instante,
      pedidoId, StatusPedido.AGUARDANDO_PAGAMENTO, ReservaEstoque.ATIVA,
    );
    if (r.changes !== 1) return false;
    movimentarItens(pedidos.obterLinha(pedidoId), TipoMovimento.CONSUMO, usuarioId);
    fidelidade.confirmarResgate(pedidoId);
    return true;
  }

  function cancelarNoBanco(pedidoId, motivo, { ator = null, requestId, detalhe = null } = {}) {
    const instante = agora();
    const r = db.prepare(`UPDATE pedidos SET status = ?, reserva_estoque_status = ?, motivo_cancelamento = ?, cancelado_em = ?, atualizado_em = ?
      WHERE id = ? AND status = ? AND reserva_estoque_status = ?`).run(
      StatusPedido.CANCELADO, ReservaEstoque.LIBERADA, detalhe ? `${motivo}: ${detalhe}` : motivo, instante, instante,
      pedidoId, StatusPedido.AGUARDANDO_PAGAMENTO, ReservaEstoque.ATIVA,
    );
    if (r.changes !== 1) return false;
    const pedido = pedidos.obterLinha(pedidoId);
    movimentarItens(pedido, TipoMovimento.LIBERACAO, ator?.id ?? null);
    fidelidade.liberarResgate(pedidoId);
    auditoria.registrar({
      ator, acao: 'PEDIDO_CANCELADO', recursoTipo: 'PEDIDO', recursoId: pedidoId, unidadeId: pedido.unidade_id,
      requestId: requestId ?? 'sistema', detalhes: { motivo },
    });
    return true;
  }

  function cancelar(ator, pedidoId, { motivo }, requestId) {
    const linha = pedidos.obterLinha(pedidoId);
    pedidos.exigirAcesso(ator, linha, requestId);
    if (ator.papel === Papel.COZINHA) throw erros.proibido('A cozinha nao cancela pedidos.');
    return transacao(db, () => {
      const atual = pedidos.obterLinha(pedidoId);
      if (atual.status === StatusPedido.CANCELADO) {
        throw erros.conflito('PEDIDO_JA_CANCELADO', 'O pedido ja esta cancelado.', [{ field: 'status', issue: atual.motivo_cancelamento }]);
      }
      if (atual.status !== StatusPedido.AGUARDANDO_PAGAMENTO) {
        throw erros.conflito('CANCELAMENTO_APOS_PAGAMENTO', 'Pedido com pagamento confirmado nao pode ser cancelado por aqui. Estorno esta fora do escopo deste MVP.', [
          { field: 'status', issue: `Status atual: ${atual.status}` },
        ]);
      }
      const vivo = pagamentoVivo.get(pedidoId, ...STATUS_PAGAMENTO_VIVO);
      if (vivo?.status === StatusPagamento.PROCESSANDO) {
        throw erros.conflito('PAGAMENTO_EM_ANDAMENTO', 'Ha um pagamento em processamento. Aguarde o resultado antes de cancelar.');
      }
      cancelarNoBanco(pedidoId, MotivoCancelamento.SOLICITADO, { ator, requestId, detalhe: motivo });
      return pedidos.detalhar(pedidoId);
    });
  }

  function mudarStatus(ator, pedidoId, novoStatus, requestId) {
    const linha = pedidos.obterLinha(pedidoId);
    if (!ehFuncionario(ator) && ator.papel !== Papel.ADMIN) throw erros.proibido();
    pedidos.exigirAcesso(ator, linha, requestId);
    return transacao(db, () => {
      const atual = pedidos.obterLinha(pedidoId);
      validarTransicaoManual(atual.status, novoStatus, ator.papel);
      const instante = agora();
      const coluna = novoStatus === StatusPedido.PRONTO ? 'pronto_em' : 'entregue_em';
      const r = db.prepare(`UPDATE pedidos SET status = ?, ${coluna} = ?, atualizado_em = ? WHERE id = ? AND status = ?`)
        .run(novoStatus, instante, instante, pedidoId, atual.status);
      if (r.changes !== 1) throw erros.conflito('TRANSICAO_INVALIDA', 'O pedido mudou de status durante a operacao.');
      auditoria.registrar({
        ator, acao: 'PEDIDO_STATUS_ALTERADO', recursoTipo: 'PEDIDO', recursoId: pedidoId, unidadeId: atual.unidade_id, requestId,
        detalhes: { de: atual.status, para: novoStatus },
      });
      if (novoStatus === StatusPedido.ENTREGUE) fidelidade.creditarEntrega(pedidoId, { ator, requestId });
      return pedidos.detalhar(pedidoId);
    });
  }

  function expirarVencidos(instante = agora()) {
    const vencidos = db.prepare(`SELECT p.id FROM pedidos p
      WHERE p.status = ? AND p.expira_em <= ?
        AND NOT EXISTS (SELECT 1 FROM pagamentos g WHERE g.pedido_id = p.id AND g.status = ?)
      ORDER BY p.id`).all(StatusPedido.AGUARDANDO_PAGAMENTO, instante, StatusPagamento.PROCESSANDO);
    let expirados = 0;
    for (const { id } of vencidos) {
      if (transacao(db, () => cancelarNoBanco(id, MotivoCancelamento.EXPIRADO, { requestId: 'expiracao-automatica' }))) expirados += 1;
    }
    return { verificados: vencidos.length, expirados };
  }

  function expirarSeVencido(pedidoId) {
    const linha = pedidos.obterLinha(pedidoId);
    if (linha.status !== StatusPedido.AGUARDANDO_PAGAMENTO || linha.expira_em > agora()) return false;
    return transacao(db, () => {
      if (pagamentoVivo.get(pedidoId, ...STATUS_PAGAMENTO_VIVO)?.status === StatusPagamento.PROCESSANDO) return false;
      return cancelarNoBanco(pedidoId, MotivoCancelamento.EXPIRADO, { requestId: 'expiracao-automatica' });
    });
  }

  return { confirmarPagamento, cancelarNoBanco, cancelar, mudarStatus, expirarVencidos, expirarSeVencido };
}
