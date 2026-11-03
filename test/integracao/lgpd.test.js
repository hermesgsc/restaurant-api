import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
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

async function clienteComHistorico() {
  const email = `titular-${crypto.randomUUID().slice(0, 8)}@teste.local`;
  const cadastro = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'Maria Titular', email, senha: 'Senha@12345' } });
  const token = await amb.login(email, 'Senha@12345');
  await amb.chamar('PUT', '/fidelidade/consentimento', { token });
  const pedido = (await amb.chamar('POST', '/pedidos', {
    token, cabecalhos: { 'idempotency-key': chave() },
    corpo: { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] },
  })).corpo;
  await amb.chamar('POST', `/pedidos/${pedido.id}/pagamentos`, { token, cabecalhos: { 'idempotency-key': chave() } });
  await amb.chamar('PATCH', `/pedidos/${pedido.id}/status`, { token: await amb.login(EMAILS.cozinhaCentro), corpo: { status: 'PRONTO' } });
  await amb.chamar('PATCH', `/pedidos/${pedido.id}/status`, { token: await amb.login(EMAILS.atendenteCentro), corpo: { status: 'ENTREGUE' } });
  return { id: cadastro.corpo.id, email, token, pedido };
}

describe('anonimizacao', () => {
  test('remove nome, e-mail e senha, zera pontos e mantem o pedido sem identificar a pessoa', async () => {
    const c = await clienteComHistorico();
    assert.equal(amb.db.prepare('SELECT saldo_pontos FROM fidelidade_contas WHERE usuario_id = ?').get(c.id).saldo_pontos, 25);

    const r = amb.servicos.lgpd.anonimizar(c.id, { requestId: 'teste-lgpd' });
    assert.equal(r.pontosBaixados, 25);

    const u = amb.db.prepare('SELECT * FROM usuarios WHERE id = ?').get(c.id);
    assert.equal(u.nome, 'Titular anonimizado');
    assert.equal(u.email, `anonimizado-${c.id}@anonimizado.invalid`);
    assert.match(u.senha_hash, /^anonimizado:/);
    assert.equal(u.ativo, 0);
    assert.ok(u.anonimizado_em);

    // pedido e pagamento continuam (registro fiscal), sem dado pessoal
    const pedido = amb.db.prepare('SELECT * FROM pedidos WHERE id = ?').get(c.pedido.id);
    assert.equal(pedido.status, 'ENTREGUE');
    assert.equal(pedido.total_centavos, 2590);
    assert.equal(amb.db.prepare("SELECT COUNT(*) AS n FROM pagamentos WHERE pedido_id = ? AND status = 'APROVADO'").get(c.pedido.id).n, 1);

    const consentimentos = amb.db.prepare('SELECT acao, origem FROM consentimentos WHERE usuario_id = ? ORDER BY id').all(c.id).map((l) => ({ ...l }));
    assert.deepEqual(consentimentos, [{ acao: 'CONCEDIDO', origem: 'TITULAR' }, { acao: 'REVOGADO', origem: 'ANONIMIZACAO' }]);
    assert.equal(amb.db.prepare('SELECT saldo_pontos FROM fidelidade_contas WHERE usuario_id = ?').get(c.id).saldo_pontos, 0);

    // nada no banco guarda mais o nome ou o e-mail antigo
    const tabelas = amb.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map((t) => t.name);
    for (const tabela of tabelas) {
      const linhas = amb.db.prepare(`SELECT * FROM "${tabela}"`).all();
      const texto = JSON.stringify(linhas);
      assert.ok(!texto.includes(c.email), `e-mail encontrado em ${tabela}`);
      assert.ok(!texto.includes('Maria Titular'), `nome encontrado em ${tabela}`);
    }
    assert.ok(amb.db.prepare("SELECT 1 FROM auditorias WHERE acao = 'USUARIO_ANONIMIZADO' AND recurso_id = ?").get(String(c.id)));
  });

  test('titular anonimizado nao faz login e o token antigo deixa de valer', async () => {
    const c = await clienteComHistorico();
    amb.servicos.lgpd.anonimizar(c.id);
    const login = await amb.chamar('POST', '/auth/login', { corpo: { email: c.email, senha: 'Senha@12345' } });
    assert.equal(login.status, 401);
    const me = await amb.chamar('GET', '/usuarios/me', { token: c.token });
    assert.equal(me.status, 401);
  });

  test('o e-mail fica livre para um novo cadastro', async () => {
    const c = await clienteComHistorico();
    amb.servicos.lgpd.anonimizar(c.id);
    const r = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'Nova Conta', email: c.email, senha: 'Senha@12345' } });
    assert.equal(r.status, 201);
    assert.notEqual(r.corpo.id, c.id);
  });

  test('anonimizar de novo, funcionario ou usuario inexistente sao recusados', async () => {
    const c = await clienteComHistorico();
    amb.servicos.lgpd.anonimizar(c.id);
    assert.throws(() => amb.servicos.lgpd.anonimizar(c.id), { codigo: 'USUARIO_JA_ANONIMIZADO' });
    const atendente = amb.db.prepare('SELECT id FROM usuarios WHERE email = ?').get(EMAILS.atendenteCentro).id;
    assert.throws(() => amb.servicos.lgpd.anonimizar(atendente), { codigo: 'ANONIMIZACAO_SO_CLIENTE' });
    assert.throws(() => amb.servicos.lgpd.anonimizar(999999), { codigo: 'USUARIO_NAO_ENCONTRADO' });
  });

  test('cliente com pedido em andamento nao e anonimizado', async () => {
    const email = `andamento-${crypto.randomUUID().slice(0, 8)}@teste.local`;
    const cadastro = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'Joao Andamento', email, senha: 'Senha@12345' } });
    const token = await amb.login(email, 'Senha@12345');
    await amb.chamar('POST', '/pedidos', {
      token, cabecalhos: { 'idempotency-key': chave() },
      corpo: { unidadeId: centro, canalPedido: 'APP', formaPagamento: 'MOCK', itens: [{ produtoId: p['X-Burger'], quantidade: 1 }] },
    });
    assert.throws(() => amb.servicos.lgpd.anonimizar(cadastro.corpo.id), { codigo: 'PEDIDOS_EM_ANDAMENTO' });
    assert.equal(amb.db.prepare('SELECT nome FROM usuarios WHERE id = ?').get(cadastro.corpo.id).nome, 'Joao Andamento');
  });
});

describe('comando npm run lgpd:anonimizar', () => {
  test('anonimiza pelo terminal e falha com codigo de saida 1 no erro', async () => {
    const c = await clienteComHistorico();
    const raiz = path.resolve(import.meta.dirname, '..', '..');
    const env = { ...process.env, NODE_ENV: 'test', JWT_SECRET: amb.config.jwt.segredo, DATABASE_FILE: amb.config.arquivoBanco };
    const saida = execFileSync(process.execPath, [path.join(raiz, 'scripts', 'anonimizar-usuario.js'), String(c.id)], { env, encoding: 'utf8' });
    assert.match(saida, new RegExp(`Usuario ${c.id} anonimizado`));
    assert.equal(amb.db.prepare('SELECT ativo FROM usuarios WHERE id = ?').get(c.id).ativo, 0);

    assert.throws(
      () => execFileSync(process.execPath, [path.join(raiz, 'scripts', 'anonimizar-usuario.js'), String(c.id)], { env, encoding: 'utf8', stdio: 'pipe' }),
      (e) => e.status === 1 && /USUARIO_JA_ANONIMIZADO/.test(e.stderr),
    );
  });
});
