import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente, EMAILS } from '../apoio/ambiente.js';

let amb;
before(async () => { amb = await criarAmbiente({ LOGIN_MAX_TENTATIVAS: '3' }); });
after(() => amb.fechar());

function conferirEnvelope(corpo, codigo, rota) {
  assert.equal(corpo.error, codigo);
  assert.equal(typeof corpo.message, 'string');
  assert.ok(Array.isArray(corpo.details));
  assert.equal(corpo.path, rota);
  assert.ok(corpo.requestId);
  assert.ok(!Number.isNaN(Date.parse(corpo.timestamp)));
}

describe('cadastro e login', () => {
  test('cadastro publico sempre cria CLIENTE e nao devolve hash', async () => {
    const r = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'Carla Teste', email: 'Carla@Teste.local', senha: 'Senha@123' } });
    assert.equal(r.status, 201);
    assert.equal(r.corpo.papel, 'CLIENTE');
    assert.equal(r.corpo.email, 'carla@teste.local');
    assert.equal(r.corpo.senha_hash, undefined);
    assert.equal(r.corpo.senhaHash, undefined);
  });

  test('papel enviado no cadastro e rejeitado como campo proibido', async () => {
    const r = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'Hacker', email: 'hacker@teste.local', senha: 'Senha@123', papel: 'ADMIN' } });
    assert.equal(r.status, 422);
    conferirEnvelope(r.corpo, 'VALIDACAO', '/usuarios');
    assert.deepEqual(r.corpo.details, [{ field: 'papel', issue: 'Campo nao permitido.' }]);
    const existe = amb.db.prepare('SELECT COUNT(*) AS n FROM usuarios WHERE email = ?').get('hacker@teste.local').n;
    assert.equal(existe, 0);
  });

  test('e-mail duplicado (ignorando maiusculas) retorna 409', async () => {
    const r = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'Ana Outra', email: 'CLIENTE.ANA@demo.local', senha: 'Senha@123' } });
    assert.equal(r.status, 409);
    conferirEnvelope(r.corpo, 'EMAIL_JA_CADASTRADO', '/usuarios');
  });

  test('e-mail invalido e senha curta retornam 422 com detalhes', async () => {
    const r = await amb.chamar('POST', '/usuarios', { corpo: { nome: 'X Y', email: 'nao-e-email', senha: '123' } });
    assert.equal(r.status, 422);
    const campos = r.corpo.details.map((d) => d.field).sort();
    assert.deepEqual(campos, ['email', 'senha']);
  });

  test('login valido devolve token que funciona em /usuarios/me', async () => {
    const login = await amb.chamar('POST', '/auth/login', { corpo: { email: EMAILS.gerenteCentro, senha: 'Demo@12345' } });
    assert.equal(login.status, 200);
    assert.equal(login.corpo.tokenType, 'Bearer');
    const me = await amb.chamar('GET', '/usuarios/me', { token: login.corpo.accessToken });
    assert.equal(me.status, 200);
    assert.equal(me.corpo.papel, 'GERENTE');
    assert.deepEqual(me.corpo.unidadeIds, [amb.ids.unidadeId['Unidade Centro']]);
  });

  test('senha errada e e-mail inexistente dao a mesma mensagem generica', async () => {
    const a = await amb.chamar('POST', '/auth/login', { corpo: { email: EMAILS.bruno, senha: 'errada' } });
    const b = await amb.chamar('POST', '/auth/login', { corpo: { email: 'ninguem@demo.local', senha: 'errada' } });
    assert.equal(a.status, 401);
    assert.equal(b.status, 401);
    assert.equal(a.corpo.message, b.corpo.message);
  });

  test('limitador de login bloqueia apos o maximo de falhas com 429', async () => {
    for (let i = 0; i < 3; i += 1) {
      await amb.chamar('POST', '/auth/login', { corpo: { email: 'alvo@demo.local', senha: 'errada' } });
    }
    const r = await amb.chamar('POST', '/auth/login', { corpo: { email: 'alvo@demo.local', senha: 'errada' } });
    assert.equal(r.status, 429);
    assert.ok(Number(r.headers.get('retry-after')) > 0);
  });
});

describe('token e erros padrao', () => {
  test('sem token retorna 401 no envelope padrao', async () => {
    const r = await amb.chamar('GET', '/usuarios/me');
    assert.equal(r.status, 401);
    conferirEnvelope(r.corpo, 'NAO_AUTENTICADO', '/usuarios/me');
  });

  test('token adulterado retorna 401', async () => {
    const token = await amb.login(EMAILS.ana);
    const [h, p, s] = token.split('.');
    const corpoFalso = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(p, 'base64url')), papel: 'ADMIN', sub: '1' })).toString('base64url');
    const r = await amb.chamar('GET', '/usuarios/me', { token: `${h}.${corpoFalso}.${s}` });
    assert.equal(r.status, 401);
  });

  test('JSON malformado usa o mesmo envelope', async () => {
    const r = await amb.chamar('POST', '/auth/login', { corpoBruto: '{"email": ' });
    assert.equal(r.status, 400);
    conferirEnvelope(r.corpo, 'JSON_MALFORMADO', '/auth/login');
  });

  test('corpo acima do limite retorna 413', async () => {
    const r = await amb.chamar('POST', '/usuarios', { corpoBruto: JSON.stringify({ nome: 'x'.repeat(40000) }) });
    assert.equal(r.status, 413);
    conferirEnvelope(r.corpo, 'CORPO_MUITO_GRANDE', '/usuarios');
  });

  test('X-Request-Id enviado volta na resposta e no erro', async () => {
    const r = await amb.chamar('GET', '/rota-que-nao-existe', { cabecalhos: { 'x-request-id': 'teste-correlacao-123' } });
    assert.equal(r.status, 404);
    assert.equal(r.corpo.requestId, 'teste-correlacao-123');
    assert.equal(r.headers.get('x-request-id'), 'teste-correlacao-123');
  });
});
