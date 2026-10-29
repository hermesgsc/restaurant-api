import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const PASTA_MIGRACOES = path.resolve(import.meta.dirname, '../../migrations');

export function abrirBanco(arquivo) {
  if (arquivo !== ':memory:') fs.mkdirSync(path.dirname(arquivo), { recursive: true });
  const db = new DatabaseSync(arquivo);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec('PRAGMA busy_timeout = 5000');
  return db;
}

// aplica em ordem os .sql da pasta migrations que ainda nao rodaram.
// cada arquivo roda numa transacao propria, se falhar nada dele fica no banco.
export function migrar(db) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migracoes (
    versao TEXT PRIMARY KEY,
    aplicada_em TEXT NOT NULL
  )`);
  const aplicadas = new Set(db.prepare('SELECT versao FROM schema_migracoes').all().map((l) => l.versao));
  const arquivos = fs.readdirSync(PASTA_MIGRACOES).filter((a) => a.endsWith('.sql')).sort();
  const novas = [];
  for (const arquivo of arquivos) {
    if (aplicadas.has(arquivo)) continue;
    const sql = fs.readFileSync(path.join(PASTA_MIGRACOES, arquivo), 'utf8');
    transacao(db, () => {
      db.exec(sql);
      db.prepare('INSERT INTO schema_migracoes (versao, aplicada_em) VALUES (?, ?)').run(arquivo, agora());
    });
    novas.push(arquivo);
  }
  return novas;
}

// BEGIN IMMEDIATE pega o lock de escrita logo no inicio. junto com o fato do
// node:sqlite ser sincrono, duas requisicoes nunca intercalam dentro da mesma
// transacao, e outro processo (ex. o comando de expiracao) espera o busy_timeout.
// a funcao passada nao pode ser async: nada de await com transacao aberta.
export function transacao(db, fn) {
  if (db.isTransaction) return fn();
  db.exec('BEGIN IMMEDIATE');
  try {
    const resultado = fn();
    if (resultado instanceof Promise) throw new Error('transacao nao aceita funcao assincrona');
    db.exec('COMMIT');
    return resultado;
  } catch (erro) {
    if (db.isTransaction) db.exec('ROLLBACK');
    throw erro;
  }
}

export function agora() {
  return new Date().toISOString();
}
