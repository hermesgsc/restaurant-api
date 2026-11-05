import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import newman from 'newman';
import { carregarConfig } from '../src/config.js';
import { abrirBanco } from '../src/infrastructure/banco.js';
import { criarApp } from '../src/app.js';
import { criarLogger } from '../src/api/middlewares/basicos.js';
import { popular } from '../src/infrastructure/seed.js';

const raiz = path.resolve(import.meta.dirname, '..');
const args = process.argv.slice(2);
const urlExterna = args.includes('--url') ? args[args.indexOf('--url') + 1] : null;
const gravarEvidencia = args.includes('--evidencia');

async function subirApiTemporaria() {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-api-postman-'));
  const config = carregarConfig({
    NODE_ENV: 'development',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    DATABASE_FILE: path.join(pasta, 'postman.db'),
    PEDIDO_EXPIRACAO_INTERVALO_MS: '0',
    PAGAMENTO_TIMEOUT_MS: '500',
    LOGIN_MAX_TENTATIVAS: '5',
    MOCK_PAGAMENTO_PERMITIR_CENARIO: 'true',
  }, { lerEnv: false });
  const db = abrirBanco(config.arquivoBanco);
  const { app, servicos } = criarApp(config, { db, logger: criarLogger('test') });
  await popular(db, servicos);
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  return {
    url: `http://127.0.0.1:${servidor.address().port}`,
    async encerrar() {
      await new Promise((resolve) => servidor.close(resolve));
      db.close();
      fs.rmSync(pasta, { recursive: true, force: true });
    },
  };
}

function rodarNewman(url) {
  return new Promise((resolve, reject) => {
    newman.run({
      collection: path.join(raiz, 'postman', 'rede-restaurantes.postman_collection.json'),
      environment: path.join(raiz, 'postman', 'rede-restaurantes.postman_environment.json'),
      envVar: [{ key: 'baseUrl', value: url }],
      reporters: ['cli'],
      timeoutRequest: 10000,
    }, (erro, resumo) => (erro ? reject(erro) : resolve(resumo)));
  });
}

function escreverEvidencia(resumo) {
  const { stats, executions, failures, timings } = resumo.run;
  const porItem = new Map();
  for (const ex of executions) porItem.set(ex.item.id, ex);
  const auxiliares = executions.length - porItem.size;
  const linhas = [
    '# Evidência: execução da coleção Postman com newman',
    '',
    `Gerado por \`npm run postman:executar -- --evidencia\` em ${new Date().toISOString()}, com a API num banco SQLite temporário com seed.`,
    '',
    '| Item | Total | Falhas |',
    '|---|---:|---:|',
    `| Requisições da coleção | ${porItem.size} | - |`,
    `| Requisições HTTP enviadas (inclui ${auxiliares} de pre-request) | ${stats.requests.total} | ${stats.requests.failed} |`,
    `| Asserções | ${stats.assertions.total} | ${stats.assertions.failed} |`,
    '',
    `Duração total: ${Math.round(timings.completed - timings.started)} ms.`,
    '',
    '| Pasta / requisição | Método | Status | Asserções |',
    '|---|---|---:|---|',
  ];
  for (const ex of porItem.values()) {
    const pasta = ex.item.parent()?.name ?? '';
    const asserts = ex.assertions ?? [];
    const falhas = asserts.filter((a) => a.error).length;
    linhas.push(`| ${pasta} / ${ex.item.name} | ${ex.request.method} | ${ex.response?.code ?? '-'} | ${asserts.length - falhas}/${asserts.length} ok |`);
  }
  if (failures.length) {
    linhas.push('', '## Falhas', '');
    for (const f of failures) linhas.push(`- ${f.source?.name}: ${f.error.message}`);
  }
  const destino = path.join(raiz, 'tmp', 'evidencia-newman.md');
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, `${linhas.join('\n')}\n`);
  console.log(`Evidencia gravada em ${path.relative(raiz, destino)}`);
}

const api = urlExterna ? { url: urlExterna, encerrar: async () => {} } : await subirApiTemporaria();
let falhou = true;
try {
  const resumo = await rodarNewman(api.url);
  falhou = resumo.run.failures.length > 0;
  if (gravarEvidencia) escreverEvidencia(resumo);
} finally {
  await api.encerrar();
}
process.exitCode = falhou ? 1 : 0;
