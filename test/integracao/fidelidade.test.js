import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { criarAmbiente, EMAILS } from '../apoio/ambiente.js';

let amb;
let centro;
let p;
before(async () => {
  amb = await criarAmbiente();
  centro = amb.ids.unidadeId['Unidade Centro'];
  p = amb.ids.produtoId;
});
after(() => amb.fechar());

const chave = () => `teste-${crypto.randomUUID()}`;

let contador = 0;
// cada teste usa um cliente novo pra o saldo de um nao interferir no outro
async function novoCliente() {
  contador += 1;
  const email = `fiel${contador}-${crypto.randomUUID().slice(0, 8)}@teste.local`;
  const r = await amb.chamar('POST', '/usuarios', { corpo: { nome: `Cliente ${contador}`, email, senha: 'Senha@12345' } });
  assert.equal(r.status, 201);
  const token = await amb.login(email, 'Senha@12345');
  return { id: r.corpo.id, email, token };
}

async function consentir(token) {
  const r = await amb.chamar('PUT', '/fidelidade/consentimento', { token });
  assert.equal(r.status, 200);
  return r.corpo;
}

async function criarPedido(token, { itens = [{ produtoId: p['X-Burger'], quantidade: 2 }], pontosResgatar, k = chave() } = {}) {
  const corpo = { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens };
  if (pontosResgatar !== undefined) corpo.pontosResgatar = pontosResgatar;
  return amb.chamar('POST', '/pedidos', { token, corpo, cabecalhos: { 'idempotency-key': k } });
}

async function pagar(token, pedidoId, cenario = 'APROVAR') {
  return amb.chamar('POST', `/pedidos/${pedidoId}/pagamentos`, { token, cabecalhos: { 'idempotency-key': chave(), 'x-mock-cenario': cenario } });
}

async function entregar(pedidoId) {
  const cozinha = await amb.login(EMAILS.cozinhaCentro);
  const atendente = await amb.login(EMAILS.atendenteCentro);
  assert.equal((await amb.chamar('PATCH', `/pedidos/${pedidoId}/status`, { token: cozinha, corpo: { status: 'PRONTO' } })).status, 200);
  return amb.chamar('PATCH', `/pedidos/${pedidoId}/status`, { token: atendente, corpo: { status: 'ENTREGUE' } });
}

async function pedidoEntregue(token, opcoes) {
  const pedido = (await criarPedido(token, opcoes)).corpo;
  assert.equal((await pagar(token, pedido.id)).status, 201);
  const r = await entregar(pedido.id);
  assert.equal(r.status, 200);
  return r.corpo;
}

const saldo = async (token) => (await amb.chamar('GET', '/fidelidade/saldo', { token })).corpo;

// da pontos direto pelo servico, como se viessem de pedidos antigos
function darPontos(usuarioId, pontos) {
  amb.db.prepare("INSERT INTO fidelidade_contas (usuario_id, saldo_pontos, criado_em, atualizado_em) VALUES (?, 0, 'x', 'x') ON CONFLICT DO NOTHING").run(usuarioId);
  amb.db.prepare('UPDATE fidelidade_contas SET saldo_pontos = saldo_pontos + ? WHERE usuario_id = ?').run(pontos, usuarioId);
}

describe('consentimento', () => {
  test('cliente comeca sem consentimento e sem pontos', async () => {
    const c = await novoCliente();
    const s = await saldo(c.token);
    assert.equal(s.saldoPontos, 0);
    assert.equal(s.consentimento.ativo, false);
    assert.equal(s.regra.creditoQuando, 'ENTREGUE');
  });

  test('conceder e revogar sao idempotentes e o historico so cresce', async () => {
    const c = await novoCliente();
    const primeiro = await consentir(c.token);
    assert.equal(primeiro.ativo, true);
    assert.equal(primeiro.versaoTermo, 'FIDELIDADE-v1');
    await consentir(c.token);
    const revogado = await amb.chamar('DELETE', '/fidelidade/consentimento', { token: c.token });
    assert.equal(revogado.corpo.ativo, false);
    await amb.chamar('DELETE', '/fidelidade/consentimento', { token: c.token });
    const linhas = amb.db.prepare('SELECT acao, origem FROM consentimentos WHERE usuario_id = ? ORDER BY id').all(c.id);
    assert.deepEqual(linhas.map((l) => l.acao), ['CONCEDIDO', 'REVOGADO']);
  });

  test('consentimento nao pode ser alterado nem apagado no banco', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    assert.throws(() => amb.db.prepare("UPDATE consentimentos SET acao = 'REVOGADO' WHERE usuario_id = ?").run(c.id), /somente insercao/);
    assert.throws(() => amb.db.prepare('DELETE FROM consentimentos WHERE usuario_id = ?').run(c.id), /somente insercao/);
  });

  test('funcionario nao participa do programa', async () => {
    const token = await amb.login(EMAILS.atendenteCentro);
    assert.equal((await amb.chamar('GET', '/fidelidade/saldo', { token })).status, 403);
    assert.equal((await amb.chamar('PUT', '/fidelidade/consentimento', { token })).status, 403);
  });

  test('sem token retorna 401', async () => {
    assert.equal((await amb.chamar('GET', '/fidelidade/saldo')).status, 401);
  });
});

describe('credito na entrega', () => {
  test('credita 1 ponto por real inteiro so quando o pedido e ENTREGUE', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    // 2 x 25,90 + 1 x 6,90 = 58,70 -> 58 pontos
    const pedido = (await criarPedido(c.token, { itens: [{ produtoId: p['X-Burger'], quantidade: 2 }, { produtoId: p['Refrigerante Lata'], quantidade: 1 }] })).corpo;
    assert.equal(pedido.totalCentavos, 5870);
    await pagar(c.token, pedido.id);
    assert.equal((await saldo(c.token)).saldoPontos, 0, 'pagamento sozinho nao credita');
    const cozinha = await amb.login(EMAILS.cozinhaCentro);
    await amb.chamar('PATCH', `/pedidos/${pedido.id}/status`, { token: cozinha, corpo: { status: 'PRONTO' } });
    assert.equal((await saldo(c.token)).saldoPontos, 0, 'PRONTO nao credita');
    await amb.chamar('PATCH', `/pedidos/${pedido.id}/status`, { token: await amb.login(EMAILS.atendenteCentro), corpo: { status: 'ENTREGUE' } });

    const s = await saldo(c.token);
    assert.equal(s.saldoPontos, 58);
    assert.equal(s.valorResgatavelCentavos, 500);
    const h = (await amb.chamar('GET', '/fidelidade/historico', { token: c.token })).corpo;
    assert.equal(h.dados.length, 1);
    assert.deepEqual({ tipo: h.dados[0].tipo, pontos: h.dados[0].pontos, saldoApos: h.dados[0].saldoApos, pedidoId: h.dados[0].pedidoId },
      { tipo: 'CREDITO', pontos: 58, saldoApos: 58, pedidoId: pedido.id });
  });

  test('entrega repetida nao credita duas vezes', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    const entregue = await pedidoEntregue(c.token);
    const repetida = await amb.chamar('PATCH', `/pedidos/${entregue.id}/status`, { token: await amb.login(EMAILS.atendenteCentro), corpo: { status: 'ENTREGUE' } });
    assert.equal(repetida.status, 409);
    assert.equal((await saldo(c.token)).saldoPontos, 51);
    // chamar o credito direto de novo tambem nao duplica
    assert.equal(amb.servicos.fidelidade.creditarEntrega(entregue.id, { ator: null, requestId: 'teste' }), 0);
    assert.throws(() => amb.db.prepare(`INSERT INTO fidelidade_lancamentos (usuario_id, pedido_id, tipo, pontos, saldo_apos, descricao, criado_em)
      VALUES (?, ?, 'CREDITO', 1, 1, 'dup', 'x')`).run(c.id, entregue.id), /UNIQUE/);
    assert.equal((await saldo(c.token)).saldoPontos, 51);
  });

  test('sem consentimento nao ganha pontos', async () => {
    const c = await novoCliente();
    await pedidoEntregue(c.token);
    assert.equal((await saldo(c.token)).saldoPontos, 0);
  });

  test('depois de revogar nao ganha pontos novos e o saldo fica congelado', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    await pedidoEntregue(c.token);
    await amb.chamar('DELETE', '/fidelidade/consentimento', { token: c.token });
    await pedidoEntregue(c.token);
    assert.equal((await saldo(c.token)).saldoPontos, 51);
    const r = await criarPedido(c.token, { pontosResgatar: 10 });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'CONSENTIMENTO_FIDELIDADE_AUSENTE');
  });

  test('pedido anonimo de balcao nao gera pontos', async () => {
    const token = await amb.login(EMAILS.atendenteCentro);
    const r = await amb.chamar('POST', '/pedidos', {
      token, cabecalhos: { 'idempotency-key': chave() },
      corpo: { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] },
    });
    await pagar(token, r.corpo.id);
    await entregar(r.corpo.id);
    assert.equal(amb.db.prepare('SELECT COUNT(*) AS n FROM fidelidade_lancamentos WHERE pedido_id = ?').get(r.corpo.id).n, 0);
  });
});

describe('resgate de pontos', () => {
  test('resgate aplica desconto no total calculado pelo servidor e debita na criacao', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 75);
    const r = await criarPedido(c.token, { pontosResgatar: 30 });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.subtotalCentavos, 5180);
    assert.equal(r.corpo.descontoCentavos, 300);
    assert.equal(r.corpo.totalCentavos, 4880);
    assert.equal(r.corpo.pontosResgatados, 30);
    assert.equal(r.corpo.resgateStatus, 'RESERVADO');
    assert.equal((await saldo(c.token)).saldoPontos, 45);

    const pago = await pagar(c.token, r.corpo.id);
    assert.equal(pago.corpo.pagamento.valorCentavos, 4880);
    assert.equal(pago.corpo.pedido.resgateStatus, 'CONFIRMADO');
    // credito na entrega e sobre o valor pago: 48,80 -> 48 pontos
    await entregar(r.corpo.id);
    assert.equal((await saldo(c.token)).saldoPontos, 45 + 48);
  });

  test('cancelar devolve os pontos uma vez so', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 20);
    const pedido = (await criarPedido(c.token, { pontosResgatar: 20 })).corpo;
    assert.equal((await saldo(c.token)).saldoPontos, 0);
    await Promise.all([1, 2].map(() => amb.chamar('POST', `/pedidos/${pedido.id}/cancelamentos`, { token: c.token, corpo: {} })));
    assert.equal((await saldo(c.token)).saldoPontos, 20);
    const tipos = (await amb.chamar('GET', '/fidelidade/historico', { token: c.token })).corpo.dados.map((d) => d.tipo);
    assert.deepEqual(tipos, ['ESTORNO_RESGATE', 'RESGATE']);
  });

  test('pagamento recusado devolve os pontos', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 10);
    const pedido = (await criarPedido(c.token, { pontosResgatar: 10 })).corpo;
    const r = await pagar(c.token, pedido.id, 'RECUSAR');
    assert.equal(r.corpo.pedido.resgateStatus, 'LIBERADO');
    assert.equal((await saldo(c.token)).saldoPontos, 10);
  });

  test('pedido expirado devolve os pontos', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 10);
    const pedido = (await criarPedido(c.token, { pontosResgatar: 10 })).corpo;
    amb.db.prepare('UPDATE pedidos SET expira_em = ? WHERE id = ?').run('2000-01-01T00:00:00.000Z', pedido.id);
    amb.servicos.ciclo.expirarVencidos();
    assert.equal((await saldo(c.token)).saldoPontos, 10);
  });

  test('saldo insuficiente retorna 409 e nao cria pedido nem reserva estoque', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 10);
    const antes = amb.db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n;
    const reservadaAntes = amb.db.prepare('SELECT quantidade_reservada AS r FROM estoques WHERE unidade_id = ? AND produto_id = ?').get(centro, p['X-Burger']).r;
    const r = await criarPedido(c.token, { pontosResgatar: 20 });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'PONTOS_INSUFICIENTES');
    assert.equal(amb.db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n, antes);
    assert.equal(amb.db.prepare('SELECT quantidade_reservada AS r FROM estoques WHERE unidade_id = ? AND produto_id = ?').get(centro, p['X-Burger']).r, reservadaAntes);
    assert.equal((await saldo(c.token)).saldoPontos, 10);
  });

  test('resgate fora do multiplo de 10 ou acima do subtotal retorna 422', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 1000);
    const multiplo = await criarPedido(c.token, { pontosResgatar: 15 });
    assert.equal(multiplo.status, 422);
    assert.deepEqual(multiplo.corpo.details, [{ field: 'pontosResgatar', issue: 'Deve ser multiplo de 10.' }]);
    // subtotal de 1 x-burger = 25,90 -> no maximo 250 pontos
    const acima = await criarPedido(c.token, { itens: [{ produtoId: p['X-Burger'], quantidade: 1 }], pontosResgatar: 260 });
    assert.equal(acima.status, 422);
    assert.equal(acima.corpo.error, 'RESGATE_ACIMA_DO_SUBTOTAL');
    const limite = await criarPedido(c.token, { itens: [{ produtoId: p['X-Burger'], quantidade: 1 }], pontosResgatar: 250 });
    assert.equal(limite.status, 201);
    assert.equal(limite.corpo.totalCentavos, 90);
  });

  test('dois pedidos simultaneos nao gastam o mesmo saldo', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 30);
    const respostas = await Promise.all([1, 2, 3].map(() => criarPedido(c.token, { pontosResgatar: 20 })));
    assert.deepEqual(respostas.map((r) => r.status).sort(), [201, 409, 409]);
    assert.equal((await saldo(c.token)).saldoPontos, 10);
  });

  test('atendente nao resgata pontos pelo cliente', async () => {
    const c = await novoCliente();
    await consentir(c.token);
    darPontos(c.id, 50);
    const token = await amb.login(EMAILS.atendenteCentro);
    const r = await amb.chamar('POST', '/pedidos', {
      token, cabecalhos: { 'idempotency-key': chave() },
      corpo: { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', clienteId: c.id, pontosResgatar: 10, itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] },
    });
    assert.equal(r.status, 403);
    assert.equal((await saldo(c.token)).saldoPontos, 50);
  });
});
