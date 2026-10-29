import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { criarAmbiente, EMAILS } from '../apoio/ambiente.js';

let amb;
let centro;
let shopping;
before(async () => {
  amb = await criarAmbiente();
  centro = amb.ids.unidadeId['Unidade Centro'];
  shopping = amb.ids.unidadeId['Unidade Shopping'];
});
after(() => amb.fechar());

function saldo(unidadeId, produtoId) {
  return amb.db.prepare('SELECT quantidade_total AS total, quantidade_reservada AS reservada FROM estoques WHERE unidade_id = ? AND produto_id = ?')
    .get(unidadeId, produtoId);
}

describe('consulta e movimentacao manual', () => {
  test('saldo e independente por unidade', async () => {
    const token = await amb.login(EMAILS.admin);
    const xb = amb.ids.produtoId['X-Burger'];
    const c = await amb.chamar('GET', `/estoque?unidadeId=${centro}&produtoId=${xb}`, { token });
    const s = await amb.chamar('GET', `/estoque?unidadeId=${shopping}&produtoId=${xb}`, { token });
    assert.equal(c.status, 200);
    assert.equal(c.corpo.dados[0].quantidadeDisponivel, 50);
    assert.equal(s.corpo.dados[0].quantidadeDisponivel, 20);
  });

  test('gerente registra entrada e o saldo e o movimento batem', async () => {
    const token = await amb.login(EMAILS.gerenteCentro);
    const suco = amb.ids.produtoId['Suco Natural'];
    const r = await amb.chamar('POST', '/estoque/movimentacoes', { token, corpo: { unidadeId: centro, produtoId: suco, tipo: 'ENTRADA', quantidade: 12 } });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.saldo.quantidadeTotal, 12);
    assert.equal(r.corpo.movimentacao.totalApos, 12);
    assert.equal(r.corpo.movimentacao.tipo, 'ENTRADA');
    const lista = await amb.chamar('GET', `/estoque/movimentacoes?unidadeId=${centro}&produtoId=${suco}`, { token });
    assert.equal(lista.corpo.dados.length, 1);
    const auditado = await amb.chamar('GET', `/auditorias?acao=ESTOQUE_ENTRADA&unidadeId=${centro}`, { token });
    assert.ok(auditado.corpo.dados.some((a) => a.recursoId === `${centro}:${suco}`));
  });

  test('ajuste exige motivo e nao deixa o saldo negativo', async () => {
    const token = await amb.login(EMAILS.gerenteCentro);
    const batata = amb.ids.produtoId['Batata Frita'];
    const semMotivo = await amb.chamar('POST', '/estoque/movimentacoes', { token, corpo: { unidadeId: centro, produtoId: batata, tipo: 'AJUSTE', quantidade: -1 } });
    assert.equal(semMotivo.status, 422);
    const negativo = await amb.chamar('POST', '/estoque/movimentacoes', {
      token, corpo: { unidadeId: centro, produtoId: batata, tipo: 'AJUSTE', quantidade: -5, motivo: 'quebra' },
    });
    assert.equal(negativo.status, 409);
    assert.equal(negativo.corpo.error, 'AJUSTE_INVALIDO');
    assert.equal(saldo(centro, batata).total, 1);
  });

  test('tipos do fluxo de pedido nao podem ser lancados a mao', async () => {
    const token = await amb.login(EMAILS.admin);
    const r = await amb.chamar('POST', '/estoque/movimentacoes', {
      token, corpo: { unidadeId: centro, produtoId: amb.ids.produtoId['X-Burger'], tipo: 'RESERVA', quantidade: 1 },
    });
    assert.equal(r.status, 422);
  });

  test('quantidade fracionada ou zero e rejeitada', async () => {
    const token = await amb.login(EMAILS.admin);
    for (const quantidade of [0, 1.5, '3']) {
      const r = await amb.chamar('POST', '/estoque/movimentacoes', {
        token, corpo: { unidadeId: centro, produtoId: amb.ids.produtoId['X-Burger'], tipo: 'ENTRADA', quantidade },
      });
      assert.equal(r.status, 422, `quantidade ${quantidade}`);
    }
  });

  test('gerente de outra unidade e cliente sao barrados', async () => {
    const gerenteShopping = await amb.login(EMAILS.gerenteShopping);
    const cruzado = await amb.chamar('GET', `/estoque?unidadeId=${centro}`, { token: gerenteShopping });
    assert.equal(cruzado.status, 403);
    const cliente = await amb.chamar('GET', `/estoque?unidadeId=${centro}`, { token: await amb.login(EMAILS.ana) });
    assert.equal(cliente.status, 403);
    const cozinha = await amb.chamar('POST', '/estoque/movimentacoes', {
      token: await amb.login(EMAILS.cozinhaCentro), corpo: { unidadeId: centro, produtoId: 1, tipo: 'ENTRADA', quantidade: 1 },
    });
    assert.equal(cozinha.status, 403);
  });

  test('unidade ou produto inexistente retorna 404', async () => {
    const token = await amb.login(EMAILS.admin);
    const u = await amb.chamar('GET', '/estoque?unidadeId=9999', { token });
    assert.equal(u.status, 404);
    const p = await amb.chamar('POST', '/estoque/movimentacoes', { token, corpo: { unidadeId: centro, produtoId: 9999, tipo: 'ENTRADA', quantidade: 1 } });
    assert.equal(p.status, 404);
    assert.equal(p.corpo.error, 'PRODUTO_NAO_ENCONTRADO');
  });

  test('unidadeId e obrigatorio na consulta', async () => {
    const r = await amb.chamar('GET', '/estoque', { token: await amb.login(EMAILS.admin) });
    assert.equal(r.status, 422);
    assert.equal(r.corpo.details[0].field, 'unidadeId');
  });
});

describe('concorrencia no ultimo item', () => {
  test('8 conexoes disputando 1 unidade: so uma reserva passa e nada fica negativo', async () => {
    const batata = amb.ids.produtoId['Batata Frita'];
    assert.deepEqual({ ...saldo(centro, batata) }, { total: 1, reservada: 0 });
    const sinal = new SharedArrayBuffer(4);
    const workers = Array.from({ length: 8 }, () => new Worker(new URL('../apoio/reservar-em-thread.js', import.meta.url), {
      workerData: { arquivo: amb.config.arquivoBanco, unidadeId: centro, produtoId: batata, sinal },
    }));
    const resultados = workers.map((w) => new Promise((resolve, reject) => {
      w.once('message', resolve);
      w.once('error', reject);
    }));
    await new Promise((r) => setTimeout(r, 300));
    Atomics.store(new Int32Array(sinal), 0, 1);
    Atomics.notify(new Int32Array(sinal), 0);
    const respostas = await Promise.all(resultados);
    assert.equal(respostas.filter((r) => r.ok).length, 1);
    assert.ok(respostas.filter((r) => !r.ok).every((r) => r.codigo === 'ESTOQUE_INSUFICIENTE'), JSON.stringify(respostas));
    assert.deepEqual({ ...saldo(centro, batata) }, { total: 1, reservada: 1 });
    const reservas = amb.db.prepare("SELECT COUNT(*) AS n FROM estoque_movimentacoes WHERE unidade_id = ? AND produto_id = ? AND tipo = 'RESERVA'")
      .get(centro, batata).n;
    assert.equal(reservas, 1);
  });
});
