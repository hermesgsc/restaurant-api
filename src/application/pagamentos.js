import crypto from 'node:crypto';
import { agora, placeholders, transacao } from '../infrastructure/banco.js';
import { chamarComTimeout, TimeoutGateway } from '../infrastructure/pagamento/gateway.js';
import { erros } from '../domain/erros.js';
import { Papel } from '../domain/papeis.js';
import { StatusPedido } from '../domain/pedido.js';
import { STATUS_PAGAMENTO_VIVO, StatusPagamento } from '../domain/pagamento.js';
import { MotivoCancelamento } from './ciclo-pedido.js';

// status http da resposta de POST /pedidos/{id}/pagamentos. recusa de negocio
// nao e erro de transporte: o pagamento foi registrado, so que recusado.
const STATUS_HTTP = { APROVADO: 201, RECUSADO: 201, APROVADO_TARDIO: 201, INDEFINIDO: 202 };

function paraPagamento(l, tentativas) {
  const pagamento = {
    id: l.id,
    pedidoId: l.pedido_id,
    forma: l.forma,
    valorCentavos: l.valor_centavos,
    status: l.status,
    motivoRecusa: l.motivo_recusa,
    referenciaGateway: l.referencia_gateway,
    codigoAutorizacao: l.codigo_autorizacao,
    reconciliacao: l.reconciliacao,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    finalizadoEm: l.finalizado_em,
  };
  if (tentativas) {
    pagamento.tentativas = tentativas.map((t) => ({
      id: t.id,
      operacao: t.operacao,
      resultado: t.resultado,
      payloadRequisicao: JSON.parse(t.payload_requisicao),
      payloadResposta: t.payload_resposta ? JSON.parse(t.payload_resposta) : null,
      iniciadoEm: t.iniciado_em,
      finalizadoEm: t.finalizado_em,
    }));
  }
  return pagamento;
}

export function criarServicoPagamentos({ db, config, auditoria, pedidos, ciclo, idempotencia, gateway }) {
  const buscar = db.prepare('SELECT * FROM pagamentos WHERE id = ?');
  const buscarTentativas = db.prepare('SELECT * FROM pagamento_tentativas WHERE pagamento_id = ? ORDER BY id');
  const buscarPorIdempotencia = db.prepare('SELECT id, status FROM pagamentos WHERE idempotencia_id = ?');
  const buscarDoPedido = db.prepare('SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY id');
  const pagamentoVivo = db.prepare(`SELECT * FROM pagamentos WHERE pedido_id = ? AND status IN (${placeholders(STATUS_PAGAMENTO_VIVO)})`);
  const inserirTentativa = db.prepare(`INSERT INTO pagamento_tentativas (pagamento_id, operacao, payload_requisicao, iniciado_em)
    VALUES (?, ?, ?, ?)`);
  const fecharTentativa = db.prepare('UPDATE pagamento_tentativas SET resultado = ?, payload_resposta = ?, finalizado_em = ? WHERE id = ?');

  function detalhar(id) {
    return paraPagamento(buscar.get(id), buscarTentativas.all(id));
  }

  function exigirPodePagar(ator, linhaPedido, requestId) {
    pedidos.exigirAcesso(ator, linhaPedido, requestId);
    if (![Papel.CLIENTE, Papel.ATENDENTE, Papel.GERENTE, Papel.ADMIN].includes(ator.papel)) {
      throw erros.proibido('Este papel nao registra pagamentos.');
    }
  }

  function exigirPedidoPagavel(linha) {
    if (linha.status === StatusPedido.CANCELADO) {
      throw erros.conflito('PEDIDO_CANCELADO', 'O pedido esta cancelado e nao aceita pagamento.', [{ field: 'status', issue: linha.motivo_cancelamento }]);
    }
    if (linha.status !== StatusPedido.AGUARDANDO_PAGAMENTO) {
      throw erros.conflito('PEDIDO_JA_PAGO', 'O pedido ja tem pagamento confirmado.', [{ field: 'status', issue: `Status atual: ${linha.status}` }]);
    }
    const vivo = pagamentoVivo.get(linha.id, ...STATUS_PAGAMENTO_VIVO);
    if (vivo?.status === StatusPagamento.PROCESSANDO) {
      throw erros.conflito('PAGAMENTO_EM_ANDAMENTO', 'Ja existe um pagamento em processamento para este pedido.', [{ field: 'pagamentoId', issue: String(vivo.id) }]);
    }
    if (vivo?.status === StatusPagamento.INDEFINIDO) {
      throw erros.conflito('PAGAMENTO_INDEFINIDO', 'O ultimo pagamento ficou sem resposta do gateway e aguarda reconciliacao. Nao e possivel cobrar de novo.', [
        { field: 'pagamentoId', issue: String(vivo.id) },
      ]);
    }
  }

  // fase 1 (transacao curta): confere tudo, grava a chave de idempotencia como
  // EM_PROCESSAMENTO, o pagamento como PROCESSANDO e a tentativa com o payload.
  // o indice unico de pagamento vivo impede dois pagamentos ao mesmo tempo.
  function registrarIntencao(ator, pedidoId, { chave, cenario, requestId }) {
    const dadosIdem = { pedidoId, cenario: cenario ?? null };
    return transacao(db, () => {
      const { hash, registro } = idempotencia.consultar({ usuarioId: ator.id, operacao: 'PAGAR_PEDIDO', chave, dados: dadosIdem });
      if (registro?.estado === 'CONCLUIDO') {
        return { repetida: true, status: registro.status_http, corpo: JSON.parse(registro.corpo_resposta) };
      }
      if (registro) {
        // retry depois de timeout: devolve o estado atual (INDEFINIDO) sem cobrar de novo
        const anterior = buscarPorIdempotencia.get(registro.id);
        if (anterior?.status === StatusPagamento.INDEFINIDO) {
          return { repetida: true, status: STATUS_HTTP.INDEFINIDO, corpo: respostaPagamento(anterior.id) };
        }
        throw erros.conflito('IDEMPOTENCIA_EM_PROCESSAMENTO', 'Uma requisicao com esta Idempotency-Key ainda esta em processamento.');
      }

      const linha = pedidos.obterLinha(pedidoId);
      exigirPodePagar(ator, linha, requestId);
      exigirPedidoPagavel(linha);

      const instante = agora();
      const idemId = idempotencia.iniciar({ usuarioId: ator.id, operacao: 'PAGAR_PEDIDO', chave, hash });
      const referencia = `pag-${crypto.randomUUID()}`;
      const pagamentoId = Number(db.prepare(`INSERT INTO pagamentos
        (pedido_id, forma, valor_centavos, status, referencia_gateway, idempotencia_id, solicitado_por_id, criado_em, atualizado_em)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        pedidoId, linha.forma_pagamento, linha.total_centavos, StatusPagamento.PROCESSANDO, referencia, idemId, ator.id, instante, instante,
      ).lastInsertRowid);
      const payload = { referencia, pedidoId, valorCentavos: linha.total_centavos, moeda: 'BRL', ...(cenario ? { cenarioMock: cenario } : {}) };
      const tentativaId = Number(inserirTentativa.run(pagamentoId, 'AUTORIZACAO', JSON.stringify(payload), instante).lastInsertRowid);
      return { repetida: false, pagamentoId, tentativaId, referencia, valorCentavos: linha.total_centavos, unidadeId: linha.unidade_id };
    });
  }

  // chamada ao gateway sem nenhuma transacao aberta
  async function chamarGateway(operacao, dados) {
    try {
      const resposta = await chamarComTimeout((signal) => gateway[operacao](dados, { signal }), config.pagamentoTimeoutMs);
      return { resultado: resposta.status, resposta };
    } catch (erro) {
      if (erro instanceof TimeoutGateway) return { resultado: 'TIMEOUT', resposta: { erro: 'TIMEOUT', timeoutMs: config.pagamentoTimeoutMs } };
      return { resultado: 'ERRO', resposta: { erro: 'FALHA_COMUNICACAO' } };
    }
  }

  // fase 2 (transacao curta): aplica o resultado com UPDATE condicionado ao
  // status anterior. se dois processos tentarem finalizar o mesmo pagamento
  // (resposta original e reconciliacao), so um aplica os efeitos.
  function finalizar(pagamentoId, tentativaId, { resultado, resposta }, { ator, requestId }) {
    return transacao(db, () => {
      const instante = agora();
      fecharTentativa.run(resultado, JSON.stringify(resposta), instante, tentativaId);
      const pagamento = buscar.get(pagamentoId);
      if (![StatusPagamento.PROCESSANDO, StatusPagamento.INDEFINIDO].includes(pagamento.status)) return pagamento.status;

      let novoStatus;
      let motivo = null;
      let reconciliacao = null;
      if (resultado === 'APROVADO') {
        const confirmou = ciclo.confirmarPagamento(pagamento.pedido_id, ator?.id ?? null);
        novoStatus = confirmou ? StatusPagamento.APROVADO : StatusPagamento.APROVADO_TARDIO;
        // pedido ja cancelado/expirado: nao volta a existir. a cobranca fica
        // marcada pra estorno manual, que esta fora do escopo do mvp
        if (!confirmou) reconciliacao = 'ESTORNO_MANUAL_PENDENTE';
      } else if (resultado === 'RECUSADO') {
        novoStatus = StatusPagamento.RECUSADO;
        motivo = resposta.motivo ?? 'RECUSADO_PELO_GATEWAY';
      } else {
        // timeout ou erro de comunicacao: nao sabemos o resultado
        novoStatus = StatusPagamento.INDEFINIDO;
        // reconciliacao que tambem ficou sem resposta: continua como estava
        if (pagamento.status === StatusPagamento.INDEFINIDO) {
          db.prepare('UPDATE pagamentos SET atualizado_em = ? WHERE id = ?').run(instante, pagamentoId);
          return novoStatus;
        }
      }

      const r = db.prepare(`UPDATE pagamentos SET status = ?, motivo_recusa = ?, codigo_autorizacao = ?, reconciliacao = ?,
          atualizado_em = ?, finalizado_em = ? WHERE id = ? AND status = ?`).run(
        novoStatus, motivo, resposta.codigoAutorizacao ?? null, reconciliacao, instante,
        novoStatus === StatusPagamento.INDEFINIDO ? null : instante, pagamentoId, pagamento.status,
      );
      if (r.changes !== 1) throw new Error('pagamento mudou durante a finalizacao');
      if (novoStatus === StatusPagamento.RECUSADO) {
        ciclo.cancelarNoBanco(pagamento.pedido_id, MotivoCancelamento.PAGAMENTO_RECUSADO, { ator, requestId, detalhe: motivo });
      }
      const pedido = pedidos.obterLinha(pagamento.pedido_id);
      auditoria.registrar({
        ator, acao: `PAGAMENTO_${novoStatus}`, recursoTipo: 'PAGAMENTO', recursoId: pagamentoId, unidadeId: pedido.unidade_id,
        requestId: requestId ?? 'reconciliacao', detalhes: { pedidoId: pedido.id, valorCentavos: pagamento.valor_centavos, resultadoGateway: resultado },
      });
      if (pagamento.idempotencia_id && novoStatus !== StatusPagamento.INDEFINIDO) {
        idempotencia.concluir(pagamento.idempotencia_id, STATUS_HTTP[novoStatus], respostaPagamento(pagamentoId));
      }
      return novoStatus;
    });
  }

  function respostaPagamento(pagamentoId) {
    const pagamento = detalhar(pagamentoId);
    return { pagamento, pedido: pedidos.detalhar(pagamento.pedidoId) };
  }

  async function pagar(ator, pedidoId, { chave, cenario, requestId }) {
    // se o pedido ja venceu, expira antes de tentar cobrar
    pedidos.exigirAcesso(ator, pedidos.obterLinha(pedidoId), requestId);
    ciclo.expirarSeVencido(pedidoId);

    const intencao = registrarIntencao(ator, pedidoId, { chave, cenario, requestId });
    if (intencao.repetida) return { status: intencao.status, corpo: intencao.corpo, repetida: true };

    const retorno = await chamarGateway('autorizar', { referencia: intencao.referencia, valorCentavos: intencao.valorCentavos, cenario });
    const status = finalizar(intencao.pagamentoId, intencao.tentativaId, retorno, { ator, requestId });
    // no timeout (INDEFINIDO, 202) a chave continua EM_PROCESSAMENTO ate a reconciliacao decidir
    return { status: STATUS_HTTP[status], corpo: respostaPagamento(intencao.pagamentoId), repetida: false };
  }

  function obter(ator, id, requestId) {
    const linha = buscar.get(id);
    if (!linha) throw erros.naoEncontrado('PAGAMENTO_NAO_ENCONTRADO', 'Pagamento nao encontrado.');
    pedidos.exigirAcesso(ator, pedidos.obterLinha(linha.pedido_id), requestId);
    return detalhar(id);
  }

  function listarDoPedido(ator, pedidoId, requestId) {
    pedidos.exigirAcesso(ator, pedidos.obterLinha(pedidoId), requestId);
    return { dados: buscarDoPedido.all(pedidoId).map((l) => paraPagamento(l)) };
  }

  // consulta o gateway pros pagamentos INDEFINIDO e pros PROCESSANDO parados
  // ha mais tempo que `idadeMinimaMs` (ex.: processo caiu entre as fases).
  async function reconciliar({ idadeMinimaMs = config.pagamentoTimeoutMs * 2 } = {}) {
    const limite = new Date(Date.now() - idadeMinimaMs).toISOString();
    const pendentes = db.prepare(`SELECT id, referencia_gateway FROM pagamentos
      WHERE status = ? OR (status = ? AND atualizado_em <= ?) ORDER BY id`).all(StatusPagamento.INDEFINIDO, StatusPagamento.PROCESSANDO, limite);
    const resumo = { verificados: pendentes.length, resultados: {} };
    for (const p of pendentes) {
      const tentativaId = transacao(db, () => Number(inserirTentativa.run(
        p.id, 'CONSULTA', JSON.stringify({ referencia: p.referencia_gateway }), agora(),
      ).lastInsertRowid));
      const retorno = await chamarGateway('consultar', { referencia: p.referencia_gateway });
      const status = finalizar(p.id, tentativaId, retorno, { ator: null, requestId: 'reconciliacao' });
      resumo.resultados[status] = (resumo.resultados[status] ?? 0) + 1;
    }
    return resumo;
  }

  return { pagar, obter, listarDoPedido, reconciliar };
}
