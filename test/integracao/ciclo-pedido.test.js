import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { criarAmbiente, EMAILS, novaChave } from '../apoio/ambiente.js';

let amb;
let centro;
let shopping;
let p;
before(async () => {
  amb = await criarAmbiente();
  centro = amb.ids.unidadeId['Unidade Centro'];
  shopping = amb.ids.unidadeId['Unidade Shopping'];
  p = amb.ids.produtoId;
});
after(() => amb.fechar());


async function novoPedido({ email = EMAILS.ana, unidadeId = centro, itens = [{ produtoId: p['X-Salada'], quantidade: 1 }] } = {}) {
  const token = await amb.login(email);
  const r = await amb.chamar('POST', '/pedidos', {
    token, corpo: { unidadeId, canalPedido: 'APP', formaPagamento: 'MOCK', itens }, cabecalhos: { 'idempotency-key': novaChave() },
  });
  assert.equal(r.status, 201);
  return r.corpo;
}

async function pedidoPago(opcoes) {
  const pedido = await novoPedido(opcoes);
  const token = await amb.login(opcoes?.email ?? EMAILS.ana);
  const r = await amb.chamar('POST', `/pedidos/${pedido.id}/pagamentos`, { token, cabecalhos: { 'idempotency-key': novaChave(), 'x-mock-cenario': 'APROVAR' } });
  assert.equal(r.status, 201);
  return r.corpo.pedido;
}

async function mudarStatus(email, pedidoId, status) {
  return amb.chamar('PATCH', `/pedidos/${pedidoId}/status`, { token: await amb.login(email), corpo: { status } });
}

async function cancelar(email, pedidoId, corpo = {}) {
  return amb.chamar('POST', `/pedidos/${pedidoId}/cancelamentos`, { token: await amb.login(email), corpo });
}

describe('progressao do pedido', () => {
  test('cozinha marca PRONTO e atendente marca ENTREGUE', async () => {
    const pedido = await pedidoPago();
    const pronto = await mudarStatus(EMAILS.cozinhaCentro, pedido.id, 'PRONTO');
    assert.equal(pronto.status, 200);
    assert.equal(pronto.corpo.status, 'PRONTO');
    assert.ok(pronto.corpo.prontoEm);
    const entregue = await mudarStatus(EMAILS.atendenteCentro, pedido.id, 'ENTREGUE');
    assert.equal(entregue.status, 200);
    assert.equal(entregue.corpo.status, 'ENTREGUE');
    assert.ok(entregue.corpo.entregueEm);
    const auditorias = amb.db.prepare("SELECT detalhes FROM auditorias WHERE acao = 'PEDIDO_STATUS_ALTERADO' AND recurso_id = ? ORDER BY id").all(String(pedido.id));
    assert.deepEqual(auditorias.map((a) => JSON.parse(a.detalhes)), [{ de: 'EM_PREPARO', para: 'PRONTO' }, { de: 'PRONTO', para: 'ENTREGUE' }]);
  });

  test('entrega repetida retorna 409', async () => {
    const pedido = await pedidoPago();
    await mudarStatus(EMAILS.cozinhaCentro, pedido.id, 'PRONTO');
    await mudarStatus(EMAILS.atendenteCentro, pedido.id, 'ENTREGUE');
    const r = await mudarStatus(EMAILS.atendenteCentro, pedido.id, 'ENTREGUE');
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'TRANSICAO_INVALIDA');
  });

  test('entregas simultaneas: so uma muda o pedido', async () => {
    const pedido = await pedidoPago();
    await mudarStatus(EMAILS.cozinhaCentro, pedido.id, 'PRONTO');
    const respostas = await Promise.all([1, 2, 3].map(() => mudarStatus(EMAILS.atendenteCentro, pedido.id, 'ENTREGUE')));
    assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409, 409]);
    const n = amb.db.prepare("SELECT COUNT(*) AS n FROM auditorias WHERE acao = 'PEDIDO_STATUS_ALTERADO' AND recurso_id = ? AND detalhes LIKE '%ENTREGUE%'").get(String(pedido.id)).n;
    assert.equal(n, 1);
  });

  test('pular etapa ou mexer em pedido nao pago retorna 409', async () => {
    const pago = await pedidoPago();
    const pular = await mudarStatus(EMAILS.gerenteCentro, pago.id, 'ENTREGUE');
    assert.equal(pular.status, 409);
    assert.equal(pular.corpo.error, 'TRANSICAO_INVALIDA');
    assert.deepEqual(pular.corpo.details, [{ field: 'status', issue: 'Proximo status valido: PRONTO' }]);

    const naoPago = await novoPedido();
    const r = await mudarStatus(EMAILS.cozinhaCentro, naoPago.id, 'PRONTO');
    assert.equal(r.status, 409);
  });

  test('status fora das etapas manuais retorna 422', async () => {
    const pedido = await pedidoPago();
    for (const status of ['EM_PREPARO', 'CANCELADO', 'AGUARDANDO_PAGAMENTO', 'pronto']) {
      const r = await mudarStatus(EMAILS.gerenteCentro, pedido.id, status);
      assert.equal(r.status, 422, status);
    }
  });

  test('papel sem permissao para a etapa retorna 403', async () => {
    const pedido = await pedidoPago();
    const atendente = await mudarStatus(EMAILS.atendenteCentro, pedido.id, 'PRONTO');
    assert.equal(atendente.status, 403);
    await mudarStatus(EMAILS.cozinhaCentro, pedido.id, 'PRONTO');
    const cozinha = await mudarStatus(EMAILS.cozinhaCentro, pedido.id, 'ENTREGUE');
    assert.equal(cozinha.status, 403);
    const cliente = await mudarStatus(EMAILS.ana, pedido.id, 'ENTREGUE');
    assert.equal(cliente.status, 403);
  });

  test('cozinha de outra unidade nao mexe no pedido', async () => {
    const pedido = await pedidoPago();
    const r = await mudarStatus(EMAILS.cozinhaShopping, pedido.id, 'PRONTO');
    assert.equal(r.status, 403);
  });
});

describe('cancelamento', () => {
  test('cliente cancela antes do pagamento e o estoque volta', async () => {
    const antes = amb.saldo(centro, p['X-Salada']);
    const pedido = await novoPedido();
    assert.equal(amb.saldo(centro, p['X-Salada']).reservada, antes.reservada + 1);
    const r = await cancelar(EMAILS.ana, pedido.id, { motivo: 'Pedi errado' });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.status, 'CANCELADO');
    assert.equal(r.corpo.reservaEstoque, 'LIBERADA');
    assert.equal(r.corpo.motivoCancelamento, 'SOLICITADO: Pedi errado');
    assert.deepEqual(amb.saldo(centro, p['X-Salada']), antes);
  });

  test('cancelar de novo retorna 409 e nao devolve estoque duas vezes', async () => {
    const antes = amb.saldo(centro, p['X-Salada']);
    const pedido = await novoPedido();
    await cancelar(EMAILS.ana, pedido.id);
    const r = await cancelar(EMAILS.ana, pedido.id);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'PEDIDO_JA_CANCELADO');
    assert.deepEqual(amb.saldo(centro, p['X-Salada']), antes);
  });

  test('cancelamentos simultaneos liberam o estoque uma vez so', async () => {
    const antes = amb.saldo(centro, p['X-Salada']);
    const pedido = await novoPedido();
    const respostas = await Promise.all([1, 2, 3].map(() => cancelar(EMAILS.ana, pedido.id)));
    assert.deepEqual(respostas.map((r) => r.status).sort(), [200, 409, 409]);
    assert.deepEqual(amb.saldo(centro, p['X-Salada']), antes);
  });

  test('cancelar depois do pagamento retorna 409', async () => {
    const pedido = await pedidoPago();
    const r = await cancelar(EMAILS.ana, pedido.id);
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'CANCELAMENTO_APOS_PAGAMENTO');
  });

  test('cozinha e outro cliente nao cancelam', async () => {
    const pedido = await novoPedido();
    assert.equal((await cancelar(EMAILS.cozinhaCentro, pedido.id)).status, 403);
    assert.equal((await cancelar(EMAILS.bruno, pedido.id)).status, 403);
    assert.equal((await cancelar(EMAILS.gerenteShopping, pedido.id)).status, 403);
  });

  test('atendente da unidade cancela', async () => {
    const pedido = await novoPedido();
    const r = await cancelar(EMAILS.atendenteCentro, pedido.id, { motivo: 'Cliente desistiu no balcao' });
    assert.equal(r.status, 200);
  });

  test('motivo com campo extra ou curto demais retorna 422', async () => {
    const pedido = await novoPedido();
    assert.equal((await cancelar(EMAILS.ana, pedido.id, { motivo: 'x' })).status, 422);
    assert.equal((await cancelar(EMAILS.ana, pedido.id, { status: 'CANCELADO' })).status, 422);
  });
});

describe('expiracao', () => {
  test('pedido vencido e cancelado como EXPIRADO e devolve a reserva', async () => {
    const antes = amb.saldo(shopping, p['X-Burger']);
    const pedido = await novoPedido({ unidadeId: shopping, itens: [{ produtoId: p['X-Burger'], quantidade: 3 }] });
    const vigente = await novoPedido({ unidadeId: shopping, itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    amb.db.prepare('UPDATE pedidos SET expira_em = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', pedido.id);

    const resumo = amb.servicos.ciclo.expirarVencidos();
    assert.equal(resumo.expirados, 1);
    const linha = amb.db.prepare('SELECT status, motivo_cancelamento, reserva_estoque_status FROM pedidos WHERE id = ?').get(pedido.id);
    assert.deepEqual({ ...linha }, { status: 'CANCELADO', motivo_cancelamento: 'EXPIRADO', reserva_estoque_status: 'LIBERADA' });
    assert.equal(amb.db.prepare('SELECT status FROM pedidos WHERE id = ?').get(vigente.id).status, 'AGUARDANDO_PAGAMENTO');
    assert.deepEqual(amb.saldo(shopping, p['X-Burger']), { total: antes.total, reservada: antes.reservada + 1 });

    // rodar de novo nao faz nada
    assert.equal(amb.servicos.ciclo.expirarVencidos().expirados, 0);
  });

  test('pedido com pagamento em processamento nao expira', async () => {
    const pedido = await novoPedido();
    amb.db.prepare('UPDATE pedidos SET expira_em = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', pedido.id);
    const instante = new Date().toISOString();
    const usuario = amb.db.prepare('SELECT cliente_id FROM pedidos WHERE id = ?').get(pedido.id).cliente_id;
    amb.db.prepare(`INSERT INTO pagamentos (pedido_id, forma, valor_centavos, status, referencia_gateway, solicitado_por_id, criado_em, atualizado_em)
      VALUES (?, 'MOCK', ?, 'PROCESSANDO', ?, ?, ?, ?)`).run(pedido.id, pedido.totalCentavos, `teste-${crypto.randomUUID()}`, usuario, instante, instante);
    amb.servicos.ciclo.expirarVencidos();
    assert.equal(amb.db.prepare('SELECT status FROM pedidos WHERE id = ?').get(pedido.id).status, 'AGUARDANDO_PAGAMENTO');
  });
});
