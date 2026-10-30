import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { criarAmbiente, EMAILS } from '../apoio/ambiente.js';

let amb;
let centro;
let shopping;
let desativada;
let p;
before(async () => {
  amb = await criarAmbiente();
  centro = amb.ids.unidadeId['Unidade Centro'];
  shopping = amb.ids.unidadeId['Unidade Shopping'];
  desativada = amb.ids.unidadeId['Unidade Desativada'];
  p = amb.ids.produtoId;
});
after(() => amb.fechar());

const chave = () => `teste-${crypto.randomUUID()}`;

function criarPedido(token, corpo, k = chave()) {
  return amb.chamar('POST', '/pedidos', { token, corpo, cabecalhos: { 'idempotency-key': k } });
}

function saldo(unidadeId, produtoId) {
  return { ...amb.db.prepare('SELECT quantidade_total AS total, quantidade_reservada AS reservada FROM estoques WHERE unidade_id = ? AND produto_id = ?').get(unidadeId, produtoId) };
}

const contarPedidos = () => amb.db.prepare('SELECT COUNT(*) AS n FROM pedidos').get().n;

describe('criacao de pedido', () => {
  test('cliente cria pedido com total do servidor, preco historico e reserva', async () => {
    const token = await amb.login(EMAILS.ana);
    const antes = saldo(centro, p['X-Burger']);
    const r = await criarPedido(token, {
      unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK',
      itens: [{ produtoId: p['X-Burger'], quantidade: 2 }, { produtoId: p['Refrigerante Lata'], quantidade: 3 }],
    });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.canalPedido, 'APP');
    assert.equal(r.corpo.status, 'AGUARDANDO_PAGAMENTO');
    assert.equal(r.corpo.subtotalCentavos, 2 * 2590 + 3 * 690);
    assert.equal(r.corpo.totalCentavos, 7250);
    assert.equal(r.corpo.reservaEstoque, 'ATIVA');
    assert.equal(r.corpo.clienteId, (await amb.chamar('GET', '/usuarios/me', { token })).corpo.id);
    assert.deepEqual(r.corpo.itens[0], { produtoId: p['X-Burger'], nomeProduto: 'X-Burger', quantidade: 2, precoUnitarioCentavos: 2590, totalCentavos: 5180 });
    assert.deepEqual(saldo(centro, p['X-Burger']), { total: antes.total, reservada: antes.reservada + 2 });
    const movimentos = amb.db.prepare("SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE pedido_id = ? AND tipo = 'RESERVA'").get(r.corpo.id).n;
    assert.equal(movimentos, 2);
  });

  test('preco salvo no pedido nao muda quando o cardapio muda', async () => {
    const token = await amb.login(EMAILS.ana);
    const r = await criarPedido(token, { unidadeId: centro, canalPedido: 'WEB', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Salada'], quantidade: 1 }] });
    await amb.chamar('PUT', `/unidades/${centro}/cardapio/${p['X-Salada']}`, { token: await amb.login(EMAILS.admin), corpo: { precoCentavos: 9999 } });
    const depois = await amb.chamar('GET', `/pedidos/${r.corpo.id}`, { token });
    assert.equal(depois.corpo.itens[0].precoUnitarioCentavos, 2790);
    await amb.chamar('PUT', `/unidades/${centro}/cardapio/${p['X-Salada']}`, { token: await amb.login(EMAILS.admin), corpo: { precoCentavos: 2790 } });
  });

  test('preco, total ou status enviados pelo cliente sao rejeitados', async () => {
    const token = await amb.login(EMAILS.ana);
    const antes = contarPedidos();
    const r = await criarPedido(token, {
      unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', totalCentavos: 1,
      itens: [{ produtoId: p['X-Burger'], quantidade: 1, precoUnitarioCentavos: 1 }],
    });
    assert.equal(r.status, 422);
    const campos = r.corpo.details.map((d) => d.field).sort();
    assert.deepEqual(campos, ['itens[0].precoUnitarioCentavos', 'totalCentavos']);
    assert.equal(contarPedidos(), antes);
  });

  test('canalPedido ausente ou invalido retorna 422 e nada e criado', async () => {
    const token = await amb.login(EMAILS.ana);
    const antes = contarPedidos();
    const reservadoAntes = saldo(centro, p['X-Burger']).reservada;
    const sem = await criarPedido(token, { unidadeId: centro, formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(sem.status, 422);
    assert.equal(sem.corpo.error, 'VALIDACAO');
    assert.deepEqual(sem.corpo.details, [{ field: 'canalPedido', issue: 'Campo obrigatorio.' }]);
    const invalido = await criarPedido(token, { unidadeId: centro, canalPedido: 'DRIVE_THRU', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(invalido.status, 422);
    assert.match(invalido.corpo.details[0].issue, /APP, TOTEM, BALCAO, PICKUP, WEB/);
    assert.equal(contarPedidos(), antes);
    assert.equal(saldo(centro, p['X-Burger']).reservada, reservadoAntes);
  });

  test('itens vazios e quantidade zero, negativa ou fracionada sao rejeitados', async () => {
    const token = await amb.login(EMAILS.ana);
    const base = { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK' };
    const vazio = await criarPedido(token, { ...base, itens: [] });
    assert.equal(vazio.status, 422);
    assert.equal(vazio.corpo.details[0].field, 'itens');
    for (const quantidade of [0, -1, 1.5, '2']) {
      const r = await criarPedido(token, { ...base, itens: [{ produtoId: p['X-Burger'], quantidade }] });
      assert.equal(r.status, 422, `quantidade ${quantidade}`);
      assert.equal(r.corpo.details[0].field, 'itens[0].quantidade');
    }
  });

  test('formaPagamento diferente de MOCK e rejeitada', async () => {
    const r = await criarPedido(await amb.login(EMAILS.ana), { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'CARTAO', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.details[0].field, 'formaPagamento');
  });

  test('produto repetido em duas linhas e rejeitado (nao e somado)', async () => {
    const r = await criarPedido(await amb.login(EMAILS.ana), {
      unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK',
      itens: [{ produtoId: p['X-Burger'], quantidade: 1 }, { produtoId: p['X-Burger'], quantidade: 2 }],
    });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.error, 'PRODUTO_REPETIDO');
    assert.equal(r.corpo.details[0].field, 'itens[1].produtoId');
  });

  test('unidade ou produto inexistente retorna 404', async () => {
    const token = await amb.login(EMAILS.ana);
    const u = await criarPedido(token, { unidadeId: 9999, canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(u.status, 404);
    assert.equal(u.corpo.error, 'UNIDADE_NAO_ENCONTRADA');
    const pr = await criarPedido(token, { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: 9999, quantidade: 1 }] });
    assert.equal(pr.status, 404);
    assert.equal(pr.corpo.error, 'PRODUTO_NAO_ENCONTRADO');
  });

  test('produto fora do cardapio, indisponivel, inativo e unidade inativa retornam 409', async () => {
    const token = await amb.login(EMAILS.ana);
    const base = { canalPedido: 'APP', formaPagamento: 'MOCK' };
    const casos = [
      [{ ...base, unidadeId: shopping, itens: [{ produtoId: p['Milkshake'], quantidade: 1 }] }, 'PRODUTO_FORA_DO_CARDAPIO'],
      [{ ...base, unidadeId: centro, itens: [{ produtoId: p['Combo Classico'], quantidade: 1 }] }, 'PRODUTO_INDISPONIVEL'],
      [{ ...base, unidadeId: centro, itens: [{ produtoId: p['Milkshake'], quantidade: 1 }] }, 'PRODUTO_INDISPONIVEL'],
      [{ ...base, unidadeId: desativada, itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] }, 'UNIDADE_INATIVA'],
    ];
    for (const [corpo, codigo] of casos) {
      const r = await criarPedido(token, corpo);
      assert.equal(r.status, 409, codigo);
      assert.equal(r.corpo.error, codigo);
    }
  });

  test('estoque insuficiente retorna 409 e desfaz reservas dos outros itens', async () => {
    const token = await amb.login(EMAILS.bruno);
    const antesXb = saldo(shopping, p['X-Burger']);
    const r = await criarPedido(token, {
      unidadeId: shopping, canalPedido: 'TOTEM', formaPagamento: 'MOCK',
      itens: [{ produtoId: p['X-Burger'], quantidade: 2 }, { produtoId: p['Refrigerante Lata'], quantidade: 1 }],
    });
    assert.equal(r.status, 409);
    assert.equal(r.corpo.error, 'ESTOQUE_INSUFICIENTE');
    assert.deepEqual(r.corpo.details, [{ field: 'itens[1].quantidade', issue: 'Disponivel: 0' }]);
    assert.deepEqual(saldo(shopping, p['X-Burger']), antesXb);
  });
});

describe('identidade e escopo no pedido', () => {
  test('cliente nao cria pedido em nome de outro cliente', async () => {
    const bruno = (await amb.chamar('GET', '/usuarios/me', { token: await amb.login(EMAILS.bruno) })).corpo.id;
    const r = await criarPedido(await amb.login(EMAILS.ana), {
      unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', clienteId: bruno, itens: [{ produtoId: p['X-Burger'], quantidade: 1 }],
    });
    assert.equal(r.status, 403);
  });

  test('cliente nao usa o canal BALCAO', async () => {
    const r = await criarPedido(await amb.login(EMAILS.ana), { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(r.status, 403);
  });

  test('atendente vende no balcao sem cliente e tambem vinculando cliente', async () => {
    const token = await amb.login(EMAILS.atendenteCentro);
    const anonimo = await criarPedido(token, { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(anonimo.status, 201);
    assert.equal(anonimo.corpo.clienteId, null);
    const ana = (await amb.chamar('GET', '/usuarios/me', { token: await amb.login(EMAILS.ana) })).corpo.id;
    const vinculado = await criarPedido(token, { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', clienteId: ana, itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(vinculado.status, 201);
    assert.equal(vinculado.corpo.clienteId, ana);
    const naoCliente = await criarPedido(token, { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', clienteId: 1, itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(naoCliente.status, 404);
    assert.equal(naoCliente.corpo.error, 'CLIENTE_NAO_ENCONTRADO');
  });

  test('atendente nao vende em outra unidade e cozinha nao cria pedido', async () => {
    const atendente = await criarPedido(await amb.login(EMAILS.atendenteCentro), { unidadeId: shopping, canalPedido: 'BALCAO', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(atendente.status, 403);
    const cozinha = await criarPedido(await amb.login(EMAILS.cozinhaCentro), { unidadeId: centro, canalPedido: 'BALCAO', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    assert.equal(cozinha.status, 403);
  });

  test('cliente nao ve pedido de outro e gerente nao ve pedido de outra unidade', async () => {
    const pedido = await criarPedido(await amb.login(EMAILS.ana), { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });
    const outro = await amb.chamar('GET', `/pedidos/${pedido.corpo.id}`, { token: await amb.login(EMAILS.bruno) });
    assert.equal(outro.status, 403);
    assert.equal(outro.corpo.itens, undefined);
    const gerente = await amb.chamar('GET', `/pedidos/${pedido.corpo.id}`, { token: await amb.login(EMAILS.gerenteShopping) });
    assert.equal(gerente.status, 403);
    const negados = amb.db.prepare("SELECT COUNT(*) AS n FROM auditorias WHERE acao = 'PEDIDO_ACESSO_NEGADO' AND recurso_id = ?").get(String(pedido.corpo.id)).n;
    assert.equal(negados, 2);
    const inexistente = await amb.chamar('GET', '/pedidos/99999', { token: await amb.login(EMAILS.ana) });
    assert.equal(inexistente.status, 404);
  });
});

describe('listagem com filtros', () => {
  test('filtra por canal, status e unidade, respeitando o escopo', async () => {
    const atendente = await amb.login(EMAILS.atendenteCentro);
    const bruno = await amb.login(EMAILS.bruno);
    await criarPedido(bruno, { unidadeId: shopping, canalPedido: 'PICKUP', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Salada'], quantidade: 1 }] });
    await criarPedido(atendente, { unidadeId: centro, canalPedido: 'TOTEM', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] });

    const admin = await amb.login(EMAILS.admin);
    const pickup = await amb.chamar('GET', '/pedidos?canalPedido=PICKUP', { token: admin });
    assert.equal(pickup.status, 200);
    assert.ok(pickup.corpo.dados.length >= 1);
    assert.ok(pickup.corpo.dados.every((d) => d.canalPedido === 'PICKUP'));

    const gerenteCentro = await amb.login(EMAILS.gerenteCentro);
    const doCentro = await amb.chamar('GET', '/pedidos?canalPedido=PICKUP', { token: gerenteCentro });
    assert.equal(doCentro.corpo.dados.length, 0, 'gerente do centro nao ve pickup da shopping');

    const filtrado = await amb.chamar('GET', `/pedidos?unidadeId=${centro}&status=AGUARDANDO_PAGAMENTO&canalPedido=APP&limit=2&page=1`, { token: gerenteCentro });
    assert.equal(filtrado.corpo.paginacao.limite, 2);
    assert.ok(filtrado.corpo.dados.length <= 2);
    assert.ok(filtrado.corpo.paginacao.total >= filtrado.corpo.dados.length);
    assert.ok(filtrado.corpo.dados.every((d) => d.unidadeId === centro && d.canalPedido === 'APP' && d.status === 'AGUARDANDO_PAGAMENTO'));

    const cruzado = await amb.chamar('GET', `/pedidos?unidadeId=${shopping}`, { token: gerenteCentro });
    assert.equal(cruzado.status, 403);

    const doBruno = await amb.chamar('GET', '/pedidos', { token: bruno });
    const brunoId = (await amb.chamar('GET', '/usuarios/me', { token: bruno })).corpo.id;
    assert.ok(doBruno.corpo.dados.every((d) => d.clienteId === brunoId));
  });

  test('canal invalido no filtro retorna 422', async () => {
    const r = await amb.chamar('GET', '/pedidos?canalPedido=FAX', { token: await amb.login(EMAILS.admin) });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.details[0].field, 'canalPedido');
  });

  test('sem token retorna 401', async () => {
    const r = await amb.chamar('GET', '/pedidos');
    assert.equal(r.status, 401);
  });
});

describe('idempotencia na criacao', () => {
  const corpo = () => ({ unidadeId: shopping, canalPedido: 'WEB', formaPagamento: 'MOCK', itens: [{ produtoId: p['Batata Frita'], quantidade: 1 }] });

  test('retry com a mesma chave devolve o mesmo pedido sem reservar de novo', async () => {
    const token = await amb.login(EMAILS.bruno);
    const k = chave();
    const antes = saldo(shopping, p['Batata Frita']);
    const primeiro = await criarPedido(token, corpo(), k);
    const segundo = await criarPedido(token, corpo(), k);
    assert.equal(primeiro.status, 201);
    assert.equal(segundo.status, 201);
    assert.equal(segundo.headers.get('idempotent-replayed'), 'true');
    assert.deepEqual(segundo.corpo, primeiro.corpo);
    assert.equal(saldo(shopping, p['Batata Frita']).reservada, antes.reservada + 1);
  });

  test('mesma chave com outro corpo retorna 409', async () => {
    const token = await amb.login(EMAILS.bruno);
    const k = chave();
    await criarPedido(token, corpo(), k);
    const alterado = await criarPedido(token, { ...corpo(), itens: [{ produtoId: p['Batata Frita'], quantidade: 2 }] }, k);
    assert.equal(alterado.status, 409);
    assert.equal(alterado.corpo.error, 'IDEMPOTENCY_KEY_REUTILIZADA');
  });

  test('a chave e separada por usuario', async () => {
    const k = chave();
    const a = await criarPedido(await amb.login(EMAILS.ana), corpo(), k);
    const b = await criarPedido(await amb.login(EMAILS.bruno), corpo(), k);
    assert.equal(a.status, 201);
    assert.equal(b.status, 201);
    assert.notEqual(a.corpo.id, b.corpo.id);
  });

  test('retries simultaneos com a mesma chave criam um pedido so', async () => {
    const token = await amb.login(EMAILS.ana);
    const k = chave();
    const antes = contarPedidos();
    const respostas = await Promise.all(Array.from({ length: 6 }, () => criarPedido(token, corpo(), k)));
    assert.ok(respostas.every((r) => r.status === 201));
    assert.equal(new Set(respostas.map((r) => r.corpo.id)).size, 1);
    assert.equal(contarPedidos(), antes + 1);
  });

  test('sem Idempotency-Key retorna 422', async () => {
    const r = await amb.chamar('POST', '/pedidos', { token: await amb.login(EMAILS.ana), corpo: corpo() });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.error, 'IDEMPOTENCY_KEY_INVALIDA');
  });
});

describe('concorrencia entre compradores', () => {
  test('dois clientes pedindo a ultima unidade: um 201, um 409 e saldo nunca negativo', async () => {
    const batata = p['Batata Frita'];
    assert.deepEqual(saldo(centro, batata), { total: 1, reservada: 0 });
    const corpo = { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: batata, quantidade: 1 }] };
    const [ana, bruno] = await Promise.all([amb.login(EMAILS.ana), amb.login(EMAILS.bruno)]);
    const respostas = await Promise.all([criarPedido(ana, corpo), criarPedido(bruno, corpo), criarPedido(ana, corpo), criarPedido(bruno, corpo)]);
    const status = respostas.map((r) => r.status).sort();
    assert.deepEqual(status, [201, 409, 409, 409]);
    assert.deepEqual(saldo(centro, batata), { total: 1, reservada: 1 });
  });
});
