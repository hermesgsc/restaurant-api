import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { criarAmbiente } from '../apoio/ambiente.js';
import { especificacaoOpenApi } from '../../src/api/openapi.js';

let amb;
before(async () => {
  amb = await criarAmbiente();
});
after(() => amb.fechar());

// percorre a pilha do express (inclusive os routers montados) e devolve "METODO /caminho"
function rotasDoExpress(app) {
  const rotas = [];
  const visitar = (pilha) => {
    for (const camada of pilha) {
      if (camada.route) {
        for (const metodo of Object.keys(camada.route.methods)) {
          rotas.push(`${metodo.toUpperCase()} ${camada.route.path}`);
        }
      } else if (camada.handle?.stack) {
        visitar(camada.handle.stack);
      }
    }
  };
  visitar(app.router.stack);
  return rotas;
}

const paraOpenApi = (caminho) => caminho.replace(/:(\w+)/g, '{$1}');
const FORA_DA_ESPECIFICACAO = new Set(['GET /openapi.json']);

describe('openapi', () => {
  test('toda rota do express esta documentada e nada documentado falta no express', () => {
    const doExpress = rotasDoExpress(amb.app).filter((r) => !FORA_DA_ESPECIFICACAO.has(r)).map((r) => {
      const [metodo, caminho] = r.split(' ');
      return `${metodo} ${paraOpenApi(caminho)}`;
    });
    const { paths } = especificacaoOpenApi();
    const documentadas = Object.entries(paths).flatMap(([caminho, ops]) => Object.keys(ops).map((m) => `${m.toUpperCase()} ${caminho}`));

    assert.ok(doExpress.length >= 25, `poucas rotas encontradas: ${doExpress.length}`);
    assert.deepEqual([...new Set(doExpress)].sort(), [...new Set(documentadas)].sort());
  });

  test('toda operacao tem resposta de sucesso, tag e referencias validas', () => {
    const spec = especificacaoOpenApi();
    const schemas = new Set(Object.keys(spec.components.schemas));
    const texto = JSON.stringify(spec);
    for (const [, nome] of texto.matchAll(/"#\/components\/schemas\/(\w+)"/g)) {
      assert.ok(schemas.has(nome), `schema inexistente: ${nome}`);
    }
    for (const [caminho, ops] of Object.entries(spec.paths)) {
      for (const [metodo, op] of Object.entries(ops)) {
        const nome = `${metodo.toUpperCase()} ${caminho}`;
        assert.ok(op.tags?.length, `${nome} sem tag`);
        assert.ok(Object.keys(op.responses).some((s) => s.startsWith('2')), `${nome} sem resposta 2xx`);
        if (op.security?.length) assert.ok(op.responses['401'], `${nome} protegida sem 401`);
      }
    }
  });

  test('GET /openapi.json devolve a especificacao', async () => {
    const r = await amb.chamar('GET', '/openapi.json');
    assert.equal(r.status, 200);
    assert.equal(r.corpo.openapi, '3.1.0');
    assert.ok(r.corpo.paths['/pedidos']);
  });

  test('GET /docs/ serve o swagger ui', async () => {
    const r = await fetch(`${amb.base}/docs/`);
    assert.equal(r.status, 200);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.match(await r.text(), /swagger-ui/);
  });
});
