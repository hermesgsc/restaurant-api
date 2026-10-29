import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { carregarConfig } from '../../src/config.js';
import { abrirBanco } from '../../src/infrastructure/banco.js';
import { criarApp } from '../../src/app.js';
import { popular, SENHA_DEMO } from '../../src/infrastructure/seed.js';

// cada arquivo de teste ganha um sqlite real e proprio numa pasta temporaria,
// com migracoes e seed, e um servidor http numa porta livre
export async function criarAmbiente(extras = {}) {
  const pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'rede-api-teste-'));
  const config = carregarConfig({
    NODE_ENV: 'test',
    JWT_SECRET: crypto.randomBytes(32).toString('hex'),
    DATABASE_FILE: path.join(pasta, 'teste.db'),
    BCRYPT_CUSTO: '4',
    MOCK_PAGAMENTO_LATENCIA_MS: '5',
    PAGAMENTO_TIMEOUT_MS: '200',
    PEDIDO_EXPIRACAO_INTERVALO_MS: '0',
    ...extras,
  }, { lerEnv: false });
  const db = abrirBanco(config.arquivoBanco);
  const { app, servicos } = criarApp(config, { db });
  const ids = await popular(db, servicos);
  const servidor = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const base = `http://127.0.0.1:${servidor.address().port}`;
  const tokens = {};

  async function chamar(metodo, rota, { token, corpo, cabecalhos = {}, corpoBruto } = {}) {
    const headers = { ...cabecalhos };
    if (token) headers.authorization = `Bearer ${token}`;
    if (corpo !== undefined || corpoBruto !== undefined) headers['content-type'] = 'application/json';
    const resposta = await fetch(base + rota, {
      method: metodo,
      headers,
      body: corpoBruto ?? (corpo !== undefined ? JSON.stringify(corpo) : undefined),
    });
    const texto = await resposta.text();
    return { status: resposta.status, corpo: texto ? JSON.parse(texto) : null, headers: resposta.headers };
  }

  async function login(email, senha = SENHA_DEMO) {
    if (tokens[email]) return tokens[email];
    const r = await chamar('POST', '/auth/login', { corpo: { email, senha } });
    if (r.status !== 200) throw new Error(`login falhou para ${email}: ${r.status}`);
    tokens[email] = r.corpo.accessToken;
    return tokens[email];
  }

  async function fechar() {
    await new Promise((resolve) => servidor.close(resolve));
    db.close();
    fs.rmSync(pasta, { recursive: true, force: true });
  }

  return { config, db, servicos, ids, base, chamar, login, fechar };
}

export const EMAILS = {
  admin: 'admin@demo.local',
  gerenteCentro: 'gerente.centro@demo.local',
  gerenteShopping: 'gerente.shopping@demo.local',
  atendenteCentro: 'atendente.centro@demo.local',
  cozinhaCentro: 'cozinha.centro@demo.local',
  cozinhaShopping: 'cozinha.shopping@demo.local',
  ana: 'cliente.ana@demo.local',
  bruno: 'cliente.bruno@demo.local',
};
