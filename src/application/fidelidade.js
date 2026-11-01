import { agora, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel } from '../domain/papeis.js';
import { descontoDoResgate, pontosGanhos, REGRA_FIDELIDADE, StatusResgate, TipoLancamento, valorDosPontos } from '../domain/fidelidade.js';

const FINALIDADE = 'PROGRAMA_FIDELIDADE';

function paraLancamento(l) {
  return { id: l.id, tipo: l.tipo, pontos: l.pontos, saldoApos: l.saldo_apos, pedidoId: l.pedido_id, descricao: l.descricao, criadoEm: l.criado_em };
}

// pontos so existem com consentimento ativo. revogar nao apaga o saldo: ele
// fica congelado (sem credito novo e sem resgate) ate o cliente consentir de
// novo ou pedir a anonimizacao, que zera a conta.
export function criarServicoFidelidade({ db, config, auditoria }) {
  const ultimoConsentimento = db.prepare('SELECT * FROM consentimentos WHERE usuario_id = ? AND finalidade = ? ORDER BY id DESC LIMIT 1');
  const inserirConsentimento = db.prepare(`INSERT INTO consentimentos (usuario_id, finalidade, versao_termo, acao, origem, request_id, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const buscarConta = db.prepare('SELECT * FROM fidelidade_contas WHERE usuario_id = ?');
  const criarConta = db.prepare('INSERT INTO fidelidade_contas (usuario_id, saldo_pontos, criado_em, atualizado_em) VALUES (?, 0, ?, ?) ON CONFLICT DO NOTHING');
  const alterarSaldo = db.prepare('UPDATE fidelidade_contas SET saldo_pontos = saldo_pontos + ?, atualizado_em = ? WHERE usuario_id = ? AND saldo_pontos + ? >= 0');
  const inserirLancamento = db.prepare(`INSERT INTO fidelidade_lancamentos (usuario_id, pedido_id, tipo, pontos, saldo_apos, descricao, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const lancamentoDoPedido = db.prepare('SELECT id FROM fidelidade_lancamentos WHERE pedido_id = ? AND tipo = ?');
  const buscarPedido = db.prepare('SELECT * FROM pedidos WHERE id = ?');

  function consentimentoAtivo(usuarioId) {
    return ultimoConsentimento.get(usuarioId, FINALIDADE)?.acao === 'CONCEDIDO';
  }

  function saldoDe(usuarioId) {
    return buscarConta.get(usuarioId)?.saldo_pontos ?? 0;
  }

  // unico caminho que mexe no saldo: UPDATE condicionado (saldo nunca negativo)
  // e lancamento no extrato na mesma transacao
  function lancar(usuarioId, pedidoId, tipo, pontos, descricao) {
    return transacao(db, () => {
      const instante = agora();
      criarConta.run(usuarioId, instante, instante);
      const r = alterarSaldo.run(pontos, instante, usuarioId, pontos);
      if (r.changes !== 1) {
        throw erros.conflito('PONTOS_INSUFICIENTES', 'Saldo de pontos insuficiente.', [
          { field: 'pontosResgatar', issue: `Saldo disponivel: ${saldoDe(usuarioId)} pontos.` },
        ]);
      }
      const saldoApos = saldoDe(usuarioId);
      inserirLancamento.run(usuarioId, pedidoId, tipo, pontos, saldoApos, descricao, instante);
      return saldoApos;
    });
  }

  function exigirCliente(ator) {
    if (ator.papel !== Papel.CLIENTE) throw erros.proibido('O programa de fidelidade e exclusivo para clientes.');
  }

  function estadoConsentimento(usuarioId) {
    const ultimo = ultimoConsentimento.get(usuarioId, FINALIDADE);
    return {
      finalidade: FINALIDADE,
      ativo: ultimo?.acao === 'CONCEDIDO',
      versaoTermo: ultimo?.versao_termo ?? null,
      atualizadoEm: ultimo?.criado_em ?? null,
    };
  }

  function registrarConsentimento(usuarioId, acao, { origem = 'TITULAR', requestId = null, ator = null } = {}) {
    inserirConsentimento.run(usuarioId, FINALIDADE, config.versaoTermoFidelidade, acao, origem, requestId, agora());
    auditoria.registrar({
      ator, acao: `CONSENTIMENTO_${acao}`, recursoTipo: 'CONSENTIMENTO', recursoId: usuarioId, requestId: requestId ?? 'sistema',
      detalhes: { finalidade: FINALIDADE, versaoTermo: config.versaoTermoFidelidade, origem },
    });
  }

  // conceder ou revogar de novo nao cria linha repetida: devolve o estado atual
  function conceder(ator, requestId) {
    exigirCliente(ator);
    return transacao(db, () => {
      if (!consentimentoAtivo(ator.id)) {
        registrarConsentimento(ator.id, 'CONCEDIDO', { requestId, ator });
        criarConta.run(ator.id, agora(), agora());
      }
      return estadoConsentimento(ator.id);
    });
  }

  function revogar(ator, requestId) {
    exigirCliente(ator);
    return transacao(db, () => {
      if (consentimentoAtivo(ator.id)) registrarConsentimento(ator.id, 'REVOGADO', { requestId, ator });
      return estadoConsentimento(ator.id);
    });
  }

  function saldo(ator) {
    exigirCliente(ator);
    const pontos = saldoDe(ator.id);
    return {
      saldoPontos: pontos,
      valorResgatavelCentavos: valorDosPontos(pontos),
      consentimento: estadoConsentimento(ator.id),
      regra: {
        pontosPorReal: 1,
        multiploResgate: REGRA_FIDELIDADE.multiploResgate,
        centavosPorMultiplo: REGRA_FIDELIDADE.centavosPorBlocoResgate,
        creditoQuando: 'ENTREGUE',
      },
    };
  }

  function historico(ator, { pagina, limite }) {
    exigirCliente(ator);
    const total = db.prepare('SELECT COUNT(*) AS total FROM fidelidade_lancamentos WHERE usuario_id = ?').get(ator.id).total;
    const linhas = db.prepare('SELECT * FROM fidelidade_lancamentos WHERE usuario_id = ? ORDER BY id DESC LIMIT ? OFFSET ?')
      .all(ator.id, limite, (pagina - 1) * limite);
    return { dados: linhas.map(paraLancamento), paginacao: { pagina, limite, total } };
  }

  // chamado dentro da transacao de criacao do pedido: debita os pontos na hora,
  // pra dois pedidos simultaneos nao gastarem o mesmo saldo
  function reservarResgate({ ator, clienteId, pedidoId, pontos, subtotalCentavos }) {
    if (ator.papel !== Papel.CLIENTE) throw erros.proibido('O resgate de pontos e feito pelo proprio cliente.');
    const desconto = descontoDoResgate(pontos, subtotalCentavos);
    if (!consentimentoAtivo(clienteId)) {
      throw erros.conflito('CONSENTIMENTO_FIDELIDADE_AUSENTE', 'Para usar pontos e preciso aceitar o termo do programa de fidelidade.', [
        { field: 'pontosResgatar', issue: 'Consentimento do programa de fidelidade nao esta ativo.' },
      ]);
    }
    lancar(clienteId, pedidoId, TipoLancamento.RESGATE, -pontos, `Resgate no pedido ${pedidoId}`);
    return desconto;
  }

  function confirmarResgate(pedidoId) {
    db.prepare('UPDATE pedidos SET resgate_status = ? WHERE id = ? AND resgate_status = ?')
      .run(StatusResgate.CONFIRMADO, pedidoId, StatusResgate.RESERVADO);
  }

  // pedido cancelado, recusado ou expirado devolve os pontos uma vez so
  function liberarResgate(pedidoId) {
    const r = db.prepare('UPDATE pedidos SET resgate_status = ? WHERE id = ? AND resgate_status = ?')
      .run(StatusResgate.LIBERADO, pedidoId, StatusResgate.RESERVADO);
    if (r.changes !== 1) return false;
    const pedido = buscarPedido.get(pedidoId);
    lancar(pedido.cliente_id, pedidoId, TipoLancamento.ESTORNO_RESGATE, pedido.pontos_resgatados, `Devolucao do resgate do pedido ${pedidoId} cancelado`);
    return true;
  }

  // credito na entrega: so cliente identificado, com consentimento ativo, e uma
  // vez por pedido (o indice unico pedido+tipo garante mesmo em corrida)
  function creditarEntrega(pedidoId, { ator, requestId }) {
    const pedido = buscarPedido.get(pedidoId);
    if (!pedido.cliente_id || !consentimentoAtivo(pedido.cliente_id)) return 0;
    const pontos = pontosGanhos(pedido.total_centavos);
    if (pontos <= 0 || lancamentoDoPedido.get(pedidoId, TipoLancamento.CREDITO)) return 0;
    lancar(pedido.cliente_id, pedidoId, TipoLancamento.CREDITO, pontos, `Credito do pedido ${pedidoId} entregue`);
    auditoria.registrar({
      ator, acao: 'FIDELIDADE_CREDITO', recursoTipo: 'PEDIDO', recursoId: pedidoId, unidadeId: pedido.unidade_id, requestId,
      detalhes: { pontos },
    });
    return pontos;
  }

  // usado pela anonimizacao: revoga o consentimento e zera o saldo
  function encerrarParaAnonimizacao(usuarioId, { ator, requestId }) {
    if (consentimentoAtivo(usuarioId)) registrarConsentimento(usuarioId, 'REVOGADO', { origem: 'ANONIMIZACAO', requestId, ator });
    const pontos = saldoDe(usuarioId);
    if (pontos > 0) lancar(usuarioId, null, TipoLancamento.BAIXA_ANONIMIZACAO, -pontos, 'Baixa do saldo por anonimizacao');
    return pontos;
  }

  return {
    conceder, revogar, saldo, historico, consentimentoAtivo,
    reservarResgate, confirmarResgate, liberarResgate, creditarEntrega, encerrarParaAnonimizacao,
  };
}
