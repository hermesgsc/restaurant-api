import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente, EMAILS, novaChave } from '../apoio/ambiente.js';
import { criarGatewayMock } from '../../src/infrastructure/pagamento/gateway-mock.js';
import { carregarConfig } from '../../src/config.js';

const consulta = { resultado: 'APROVADO' };
const mock = criarGatewayMock({ latenciaMs: 5, cenarioPadrao: 'APROVAR', resultadoConsulta: 'APROVADO' });
const gateway = {
  autorizar: mock.autorizar,
  async consultar({ referencia }) {
    if (consulta.resultado === 'TIMEOUT') return new Promise(() => {});
    if (consulta.resultado === 'RECUSADO') return { status: 'RECUSADO', referencia, motivo: 'RECUSA_NA_CONSULTA', mock: true };
    return { status: 'APROVADO', referencia, codigoAutorizacao: 'MOCK-CONSULTA', mock: true };
  },
};

let amb;
let centro;
let p;
before(async () => {
  amb = await criarAmbiente({}, { gateway });
  centro = amb.ids.unidadeId['Unidade Centro'];
  p = amb.ids.produtoId;
});
after(() => amb.fechar());

const saldo = (produtoId) => amb.saldo(centro, produtoId);

async function novoPedido(email = EMAILS.ana, itens = [{ produtoId: p['X-Burger'], quantidade: 2 }]) {
  const token = await amb.login(email);
  const r = await amb.chamar('POST', '/pedidos', {
    token, corpo: { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens }, cabecalhos: { 'idempotency-key': novaChave() },
  });
  assert.equal(r.status, 201);
  return r.corpo;
}

async function pagar(pedidoId, { email = EMAILS.ana, cenario, k = novaChave(), corpo } = {}) {
  const token = await amb.login(email);
  const cabecalhos = { 'idempotency-key': k };
  if (cenario) cabecalhos['x-mock-cenario'] = cenario;
  return amb.chamar('POST', `/pedidos/${pedidoId}/pagamentos`, { token, cabecalhos, corpo });
}

const pagamentosDoPedido = (pedidoId) => amb.db.prepare('SELECT * FROM pagamentos WHERE pedido_id = ? ORDER BY id').all(pedidoId);
const movimentos = (pedidoId, tipo) => amb.db.prepare('SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE pedido_id = ? AND tipo = ?').get(pedidoId, tipo).n;

describe('pagamento aprovado', () => {
  test('aprova, confirma o pedido e consome a reserva uma vez', async () => {
    const antes = saldo(p['X-Burger']);
    const pedido = await novoPedido();
    const r = await pagar(pedido.id, { cenario: 'APROVAR' });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.pagamento.status, 'APROVADO');
    assert.equal(r.corpo.pagamento.valorCentavos, pedido.totalCentavos);
    assert.match(r.corpo.pagamento.codigoAutorizacao, /^MOCK-/);
    assert.equal(r.corpo.pedido.status, 'EM_PREPARO');
    assert.equal(r.corpo.pedido.reservaEstoque, 'CONSUMIDA');
    assert.ok(r.corpo.pedido.pagoEm);
    assert.equal(r.headers.get('location'), `/pagamentos/${r.corpo.pagamento.id}`);

    const depois = saldo(p['X-Burger']);
    assert.equal(depois.total, antes.total - 2);
    assert.equal(depois.reservada, antes.reservada);
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 1);
  });

  test('tentativa guarda payload enviado e recebido, sem dado de cartao', async () => {
    const pedido = await novoPedido();
    const r = await pagar(pedido.id);
    const token = await amb.login(EMAILS.ana);
    const detalhe = await amb.chamar('GET', `/pagamentos/${r.corpo.pagamento.id}`, { token });
    assert.equal(detalhe.status, 200);
    assert.equal(detalhe.corpo.tentativas.length, 1);
    const [t] = detalhe.corpo.tentativas;
    assert.equal(t.operacao, 'AUTORIZACAO');
    assert.equal(t.resultado, 'APROVADO');
    assert.equal(t.payloadRequisicao.valorCentavos, pedido.totalCentavos);
    assert.equal(t.payloadRequisicao.referencia, detalhe.corpo.referenciaGateway);
    assert.equal(t.payloadResposta.status, 'APROVADO');
    assert.doesNotMatch(JSON.stringify(t), /cartao|card|cvv|numero/i);
  });

  test('auditoria registra o pagamento aprovado', async () => {
    const pedido = await novoPedido();
    const r = await pagar(pedido.id);
    const linha = amb.db.prepare("SELECT * FROM auditorias WHERE acao = 'PAGAMENTO_APROVADO' AND recurso_id = ?").get(String(r.corpo.pagamento.id));
    assert.ok(linha);
    assert.equal(linha.unidade_id, centro);
  });
});

describe('pagamento duplicado', () => {
  test('retry com a mesma chave devolve o mesmo pagamento sem cobrar de novo', async () => {
    const pedido = await novoPedido();
    const k = novaChave();
    const primeiro = await pagar(pedido.id, { k });
    const segundo = await pagar(pedido.id, { k });
    assert.equal(primeiro.status, 201);
    assert.equal(segundo.status, 201);
    assert.equal(segundo.headers.get('idempotent-replayed'), 'true');
    assert.equal(segundo.corpo.pagamento.id, primeiro.corpo.pagamento.id);
    assert.equal(pagamentosDoPedido(pedido.id).length, 1);
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 1);
  });

  test('mesma chave com outro pedido retorna 409', async () => {
    const a = await novoPedido();
    const b = await novoPedido();
    const k = novaChave();
    await pagar(a.id, { k });
    const r = await pagar(b.id, { k });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'IDEMPOTENCY_KEY_REUTILIZADA');
    assert.equal(pagamentosDoPedido(b.id).length, 0);
  });

  test('chave nova depois de aprovado retorna 409 PEDIDO_JA_PAGO', async () => {
    const pedido = await novoPedido();
    await pagar(pedido.id);
    const r = await pagar(pedido.id);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'PEDIDO_JA_PAGO');
    assert.equal(pagamentosDoPedido(pedido.id).length, 1);
  });

  test('pagamentos simultaneos com chaves diferentes: so um passa', async () => {
    const pedido = await novoPedido();
    const respostas = await Promise.all(Array.from({ length: 5 }, () => pagar(pedido.id)));
    const status = respostas.map((r) => r.status).sort();
    assert.deepEqual(status, [201, 409, 409, 409, 409]);
    for (const r of respostas.filter((x) => x.status === 409)) {
      assert.ok(['PAGAMENTO_EM_ANDAMENTO', 'PEDIDO_JA_PAGO'].includes(r.corpo.error));
    }
    assert.equal(pagamentosDoPedido(pedido.id).length, 1);
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 1);
  });

  test('retries simultaneos com a mesma chave geram um pagamento so', async () => {
    const pedido = await novoPedido();
    const k = novaChave();
    const respostas = await Promise.all(Array.from({ length: 4 }, () => pagar(pedido.id, { k })));
    assert.equal(pagamentosDoPedido(pedido.id).length, 1);
    for (const r of respostas) assert.ok([201, 409].includes(r.status));
    assert.ok(respostas.some((r) => r.status === 201));
  });
});

describe('pagamento recusado', () => {
  test('grava o motivo, cancela o pedido e devolve o estoque', async () => {
    const antes = saldo(p['X-Burger']);
    const pedido = await novoPedido();
    const r = await pagar(pedido.id, { cenario: 'RECUSAR' });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.pagamento.status, 'RECUSADO');
    assert.equal(r.corpo.pagamento.motivoRecusa, 'RECUSA_SIMULADA_SALDO_INSUFICIENTE');
    assert.equal(r.corpo.pedido.status, 'CANCELADO');
    assert.equal(r.corpo.pedido.reservaEstoque, 'LIBERADA');
    assert.match(r.corpo.pedido.motivoCancelamento, /^PAGAMENTO_RECUSADO/);
    assert.deepEqual(saldo(p['X-Burger']), antes);
    assert.equal(movimentos(pedido.id, 'LIBERACAO'), 1);
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 0);
  });

  test('pedido recusado nao aceita novo pagamento', async () => {
    const pedido = await novoPedido();
    await pagar(pedido.id, { cenario: 'RECUSAR' });
    const r = await pagar(pedido.id, { cenario: 'APROVAR' });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'PEDIDO_CANCELADO');
  });
});

describe('timeout do gateway', () => {
  test('retorna 202 INDEFINIDO sem aprovar nem cancelar o pedido', async () => {
    const pedido = await novoPedido();
    const r = await pagar(pedido.id, { cenario: 'TIMEOUT' });
    assert.equal(r.status, 202);
    assert.equal(r.corpo.pagamento.status, 'INDEFINIDO');
    assert.equal(r.corpo.pagamento.codigoAutorizacao, null);
    assert.equal(r.corpo.pagamento.finalizadoEm, null);
    assert.equal(r.corpo.pedido.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(r.corpo.pedido.reservaEstoque, 'ATIVA');
    const [t] = amb.db.prepare('SELECT * FROM pagamento_tentativas WHERE pagamento_id = ?').all(r.corpo.pagamento.id);
    assert.equal(t.resultado, 'TIMEOUT');
  });

  test('nova cobranca com outra chave e bloqueada enquanto esta indefinido', async () => {
    const pedido = await novoPedido();
    await pagar(pedido.id, { cenario: 'TIMEOUT' });
    const r = await pagar(pedido.id, { cenario: 'APROVAR' });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'PAGAMENTO_INDEFINIDO');
    assert.equal(pagamentosDoPedido(pedido.id).length, 1);
  });

  test('retry com a mesma chave devolve o estado indefinido sem chamar o gateway de novo', async () => {
    const pedido = await novoPedido();
    const k = novaChave();
    const primeiro = await pagar(pedido.id, { cenario: 'TIMEOUT', k });
    const segundo = await pagar(pedido.id, { cenario: 'TIMEOUT', k });
    assert.equal(segundo.status, 202);
    assert.equal(segundo.headers.get('idempotent-replayed'), 'true');
    assert.equal(segundo.corpo.pagamento.id, primeiro.corpo.pagamento.id);
    assert.equal(amb.db.prepare('SELECT COUNT(*) AS n FROM pagamento_tentativas WHERE pagamento_id = ?').get(primeiro.corpo.pagamento.id).n, 1);
  });
});

describe('reconciliacao', () => {
  test('consulta aprovada confirma o pedido e conclui a chave', async () => {
    const pedido = await novoPedido();
    const k = novaChave();
    const r = await pagar(pedido.id, { cenario: 'TIMEOUT', k });
    consulta.resultado = 'APROVADO';
    const resumo = await amb.servicos.pagamentos.reconciliar();
    assert.ok(resumo.verificados >= 1);

    const [pag] = pagamentosDoPedido(pedido.id);
    assert.equal(pag.status, 'APROVADO');
    assert.equal(pag.codigo_autorizacao, 'MOCK-CONSULTA');
    assert.equal(amb.db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedido.id).status, 'EM_PREPARO');
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 1);

    const retry = await pagar(pedido.id, { cenario: 'TIMEOUT', k });
    assert.equal(retry.status, 201);
    assert.equal(retry.corpo.pagamento.id, r.corpo.pagamento.id);
    assert.equal(retry.corpo.pagamento.status, 'APROVADO');
  });

  test('consulta recusada cancela o pedido e libera o estoque', async () => {
    const antes = saldo(p['X-Burger']);
    const pedido = await novoPedido();
    await pagar(pedido.id, { cenario: 'TIMEOUT' });
    consulta.resultado = 'RECUSADO';
    await amb.servicos.pagamentos.reconciliar();
    const [pag] = pagamentosDoPedido(pedido.id);
    assert.equal(pag.status, 'RECUSADO');
    assert.equal(pag.motivo_recusa, 'RECUSA_NA_CONSULTA');
    assert.equal(amb.db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedido.id).status, 'CANCELADO');
    assert.deepEqual(saldo(p['X-Burger']), antes);
  });

  test('consulta sem resposta mantem INDEFINIDO e registra a tentativa', async () => {
    const pedido = await novoPedido();
    await pagar(pedido.id, { cenario: 'TIMEOUT' });
    consulta.resultado = 'TIMEOUT';
    await amb.servicos.pagamentos.reconciliar();
    const [pag] = pagamentosDoPedido(pedido.id);
    assert.equal(pag.status, 'INDEFINIDO');
    const tentativas = amb.db.prepare('SELECT operacao, resultado FROM pagamento_tentativas WHERE pagamento_id = ? ORDER BY id').all(pag.id);
    assert.deepEqual(tentativas.map((t) => ({ ...t })), [
      { operacao: 'AUTORIZACAO', resultado: 'TIMEOUT' },
      { operacao: 'CONSULTA', resultado: 'TIMEOUT' },
    ]);
    consulta.resultado = 'RECUSADO';
    await amb.servicos.pagamentos.reconciliar();
  });

  test('aprovacao depois do cancelamento vira APROVADO_TARDIO e o pedido continua cancelado', async () => {
    const antes = saldo(p['X-Burger']);
    const pedido = await novoPedido();
    await pagar(pedido.id, { cenario: 'TIMEOUT' });
    const token = await amb.login(EMAILS.ana);
    const cancel = await amb.chamar('POST', `/pedidos/${pedido.id}/cancelamentos`, { token, corpo: { motivo: 'Desisti da compra' } });
    assert.equal(cancel.status, 200);

    consulta.resultado = 'APROVADO';
    await amb.servicos.pagamentos.reconciliar();
    const [pag] = pagamentosDoPedido(pedido.id);
    assert.equal(pag.status, 'APROVADO_TARDIO');
    assert.equal(pag.reconciliacao, 'ESTORNO_MANUAL_PENDENTE');
    const linha = amb.db.prepare('SELECT status, reserva_estoque_status FROM pedidos WHERE id = ?').get(pedido.id);
    assert.equal(linha.status, 'CANCELADO');
    assert.equal(linha.reserva_estoque_status, 'LIBERADA');
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 0);
    assert.deepEqual(saldo(p['X-Burger']), antes);
  });

  test('reconciliar duas vezes nao aplica efeito duas vezes', async () => {
    const pedido = await novoPedido();
    await pagar(pedido.id, { cenario: 'TIMEOUT' });
    consulta.resultado = 'APROVADO';
    await Promise.all([amb.servicos.pagamentos.reconciliar(), amb.servicos.pagamentos.reconciliar()]);
    await amb.servicos.pagamentos.reconciliar();
    assert.equal(pagamentosDoPedido(pedido.id)[0].status, 'APROVADO');
    assert.equal(movimentos(pedido.id, 'CONSUMO'), 1);
  });
});

describe('validacao e permissao no pagamento', () => {
  test('sem Idempotency-Key, cenario invalido ou valor no corpo retornam 422', async () => {
    const pedido = await novoPedido();
    const token = await amb.login(EMAILS.ana);
    const semChave = await amb.chamar('POST', `/pedidos/${pedido.id}/pagamentos`, { token });
    assert.equal(semChave.status, 422);
    assert.equal(semChave.corpo.error, 'IDEMPOTENCY_KEY_INVALIDA');

    const cenario = await pagar(pedido.id, { cenario: 'APROVAR_TUDO' });
    assert.equal(cenario.status, 422);
    assert.equal(cenario.corpo.error, 'CENARIO_MOCK_INVALIDO');

    const valor = await pagar(pedido.id, { corpo: { valorCentavos: 1 } });
    assert.equal(valor.status, 422);
    assert.deepEqual(valor.corpo.details, [{ field: 'valorCentavos', issue: 'Campo nao permitido.' }]);
    assert.equal(pagamentosDoPedido(pedido.id).length, 0);
  });

  test('outro cliente e a cozinha nao pagam o pedido', async () => {
    const pedido = await novoPedido();
    const outro = await pagar(pedido.id, { email: EMAILS.bruno });
    assert.equal(outro.status, 403);
    const cozinha = await pagar(pedido.id, { email: EMAILS.cozinhaCentro });
    assert.equal(cozinha.status, 403);
    assert.equal(pagamentosDoPedido(pedido.id).length, 0);
  });

  test('atendente registra pagamento de pedido da sua unidade', async () => {
    const pedido = await novoPedido();
    const r = await pagar(pedido.id, { email: EMAILS.atendenteCentro });
    assert.equal(r.status, 201);
  });

  test('pedido inexistente retorna 404 e outro cliente nao ve o pagamento', async () => {
    const r = await pagar(999999);
    assert.equal(r.status, 404);
    assert.equal(r.corpo.error, 'PEDIDO_NAO_ENCONTRADO');

    const pedido = await novoPedido();
    const pago = await pagar(pedido.id);
    const token = await amb.login(EMAILS.bruno);
    const ver = await amb.chamar('GET', `/pagamentos/${pago.corpo.pagamento.id}`, { token });
    assert.equal(ver.status, 403);
    const lista = await amb.chamar('GET', `/pedidos/${pedido.id}/pagamentos`, { token: await amb.login(EMAILS.ana) });
    assert.equal(lista.status, 200);
    assert.equal(lista.corpo.dados.length, 1);
  });

  test('pedido vencido e expirado antes de cobrar', async () => {
    const antes = saldo(p['X-Burger']);
    const pedido = await novoPedido();
    amb.db.prepare('UPDATE pedidos SET expira_em = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', pedido.id);
    const r = await pagar(pedido.id);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'PEDIDO_CANCELADO');
    assert.deepEqual(saldo(p['X-Burger']), antes);
    assert.equal(pagamentosDoPedido(pedido.id).length, 0);
  });
});

describe('seletor de cenario fora de dev/teste', () => {
  test('em producao a configuracao desliga o X-Mock-Cenario', () => {
    const config = carregarConfig({
      NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(40), MOCK_PAGAMENTO_PERMITIR_CENARIO: 'true',
    }, { lerEnv: false });
    assert.equal(config.mockPagamento.permitirCenario, false);
  });

  test('com o seletor desligado o cabecalho e rejeitado', async () => {
    const outro = await criarAmbiente({ MOCK_PAGAMENTO_PERMITIR_CENARIO: 'false' });
    try {
      const token = await outro.login(EMAILS.ana);
      const pedido = await outro.chamar('POST', '/pedidos', {
        token, cabecalhos: { 'idempotency-key': novaChave() },
        corpo: { unidadeId: outro.ids.unidadeId['Unidade Centro'], canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: outro.ids.produtoId['X-Burger'], quantidade: 1 }] },
      });
      const r = await outro.chamar('POST', `/pedidos/${pedido.corpo.id}/pagamentos`, {
        token, cabecalhos: { 'idempotency-key': novaChave(), 'x-mock-cenario': 'APROVAR' },
      });
      assert.equal(r.status, 422);
      assert.equal(r.corpo.error, 'CENARIO_MOCK_NAO_PERMITIDO');
    } finally {
      await outro.fechar();
    }
  });
});
