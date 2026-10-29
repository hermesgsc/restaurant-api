import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente, EMAILS } from '../apoio/ambiente.js';

let amb;
let centro;
let shopping;
let desativada;
before(async () => {
  amb = await criarAmbiente();
  centro = amb.ids.unidadeId['Unidade Centro'];
  shopping = amb.ids.unidadeId['Unidade Shopping'];
  desativada = amb.ids.unidadeId['Unidade Desativada'];
});
after(() => amb.fechar());

describe('unidades', () => {
  test('lista publica mostra so unidades ativas, admin ve todas', async () => {
    const publica = await amb.chamar('GET', '/unidades');
    assert.equal(publica.status, 200);
    assert.deepEqual(publica.corpo.dados.map((u) => u.id), [centro, shopping]);
    const admin = await amb.chamar('GET', '/unidades', { token: await amb.login(EMAILS.admin) });
    assert.equal(admin.corpo.paginacao.total, 3);
  });

  test('paginacao valida limite maximo', async () => {
    const r = await amb.chamar('GET', '/unidades?limit=101');
    assert.equal(r.status, 422);
    assert.equal(r.corpo.details[0].field, 'limit');
  });

  test('cliente nao cria unidade (403) e admin cria (201)', async () => {
    const negado = await amb.chamar('POST', '/unidades', { token: await amb.login(EMAILS.ana), corpo: { nome: 'Nova', cidade: 'Maringa' } });
    assert.equal(negado.status, 403);
    const ok = await amb.chamar('POST', '/unidades', { token: await amb.login(EMAILS.admin), corpo: { nome: 'Unidade Nova', cidade: 'Maringa' } });
    assert.equal(ok.status, 201);
    assert.equal(ok.corpo.ativa, true);
  });

  test('gerente edita a propria unidade mas nao a de outra (403)', async () => {
    const token = await amb.login(EMAILS.gerenteCentro);
    const propria = await amb.chamar('PATCH', `/unidades/${centro}`, { token, corpo: { cidade: 'Curitiba - PR' } });
    assert.equal(propria.status, 200);
    const outra = await amb.chamar('PATCH', `/unidades/${shopping}`, { token, corpo: { cidade: 'Outra' } });
    assert.equal(outra.status, 403);
  });

  test('gerente nao pode desativar unidade, so admin', async () => {
    const r = await amb.chamar('PATCH', `/unidades/${centro}`, { token: await amb.login(EMAILS.gerenteCentro), corpo: { ativa: false } });
    assert.equal(r.status, 403);
  });

  test('unidade inexistente retorna 404', async () => {
    const r = await amb.chamar('PATCH', '/unidades/9999', { token: await amb.login(EMAILS.admin), corpo: { cidade: 'Qualquer' } });
    assert.equal(r.status, 404);
    assert.equal(r.corpo.error, 'UNIDADE_NAO_ENCONTRADA');
  });
});

describe('cardapio por unidade', () => {
  test('cada unidade tem preco proprio e so mostra itens vendaveis', async () => {
    const c = await amb.chamar('GET', `/unidades/${centro}/cardapio`);
    const s = await amb.chamar('GET', `/unidades/${shopping}/cardapio`);
    assert.equal(c.status, 200);
    const precoCentro = c.corpo.dados.find((i) => i.nome === 'X-Burger').precoCentavos;
    const precoShopping = s.corpo.dados.find((i) => i.nome === 'X-Burger').precoCentavos;
    assert.equal(precoCentro, 2590);
    assert.equal(precoShopping, 2790);
    const nomesCentro = c.corpo.dados.map((i) => i.nome);
    assert.ok(!nomesCentro.includes('Combo Classico'), 'item indisponivel nao aparece');
    assert.ok(!nomesCentro.includes('Milkshake'), 'produto inativo nao aparece');
    assert.ok(!nomesCentro.includes('Suco Natural'), 'produto fora do cardapio nao aparece');
  });

  test('cardapio de unidade desativada some para o publico', async () => {
    const r = await amb.chamar('GET', `/unidades/${desativada}/cardapio`);
    assert.equal(r.status, 404);
  });

  test('gerente inclui produto e muda preco na propria unidade', async () => {
    const token = await amb.login(EMAILS.gerenteCentro);
    const suco = amb.ids.produtoId['Suco Natural'];
    const semPreco = await amb.chamar('PUT', `/unidades/${centro}/cardapio/${suco}`, { token, corpo: { disponivel: true } });
    assert.equal(semPreco.status, 422);
    const r = await amb.chamar('PUT', `/unidades/${centro}/cardapio/${suco}`, { token, corpo: { precoCentavos: 1090 } });
    assert.equal(r.status, 200);
    assert.equal(r.corpo.precoCentavos, 1090);
    const outra = await amb.chamar('PUT', `/unidades/${shopping}/cardapio/${suco}`, { token, corpo: { precoCentavos: 1 } });
    assert.equal(outra.status, 403);
  });

  test('preco fracionado ou zero e rejeitado', async () => {
    const token = await amb.login(EMAILS.admin);
    const xb = amb.ids.produtoId['X-Burger'];
    for (const precoCentavos of [10.5, 0, -1, '100']) {
      const r = await amb.chamar('PUT', `/unidades/${centro}/cardapio/${xb}`, { token, corpo: { precoCentavos } });
      assert.equal(r.status, 422, `preco ${precoCentavos}`);
    }
  });
});

describe('produtos', () => {
  test('somente admin cria e desativa; produto desativado some do cardapio', async () => {
    const admin = await amb.login(EMAILS.admin);
    const gerente = await amb.chamar('POST', '/produtos', { token: await amb.login(EMAILS.gerenteCentro), corpo: { nome: 'Wrap', categoria: 'LANCHE' } });
    assert.equal(gerente.status, 403);
    const novo = await amb.chamar('POST', '/produtos', { token: admin, corpo: { nome: 'Wrap', categoria: 'LANCHE' } });
    assert.equal(novo.status, 201);
    await amb.chamar('PUT', `/unidades/${centro}/cardapio/${novo.corpo.id}`, { token: admin, corpo: { precoCentavos: 2000 } });
    let menu = await amb.chamar('GET', `/unidades/${centro}/cardapio`);
    assert.ok(menu.corpo.dados.some((i) => i.produtoId === novo.corpo.id));
    const off = await amb.chamar('PATCH', `/produtos/${novo.corpo.id}`, { token: admin, corpo: { ativo: false } });
    assert.equal(off.status, 200);
    menu = await amb.chamar('GET', `/unidades/${centro}/cardapio`);
    assert.ok(!menu.corpo.dados.some((i) => i.produtoId === novo.corpo.id));
  });

  test('nome de produto duplicado retorna 409', async () => {
    const r = await amb.chamar('POST', '/produtos', { token: await amb.login(EMAILS.admin), corpo: { nome: 'X-Burger', categoria: 'LANCHE' } });
    assert.equal(r.status, 409);
  });
});

describe('auditoria', () => {
  test('alteracao sensivel gera registro sem dados pessoais e gerente so ve a propria unidade', async () => {
    const admin = await amb.login(EMAILS.admin);
    const r = await amb.chamar('GET', `/auditorias?acao=CARDAPIO_ITEM_INCLUIDO&unidadeId=${centro}`, { token: admin });
    assert.equal(r.status, 200);
    assert.ok(r.corpo.dados.length >= 1);
    const texto = JSON.stringify(r.corpo);
    assert.ok(!texto.includes('@demo.local'));
    assert.ok(!texto.includes('Demo@12345'));
    const gerente = await amb.login(EMAILS.gerenteCentro);
    const negado = await amb.chamar('GET', `/auditorias?unidadeId=${shopping}`, { token: gerente });
    assert.equal(negado.status, 403);
    const cliente = await amb.chamar('GET', '/auditorias', { token: await amb.login(EMAILS.ana) });
    assert.equal(cliente.status, 403);
  });
});
