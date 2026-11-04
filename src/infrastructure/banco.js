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

export function placeholders(lista) {
  return lista.map(() => '?').join(',') || 'NULL';
}

export function paginar(db, { colunas = '*', de, params = [], ordem, pagina, limite }) {
  const total = db.prepare(`SELECT COUNT(*) AS total ${de}`).get(...params).total;
  const linhas = db.prepare(`SELECT ${colunas} ${de} ORDER BY ${ordem} LIMIT ? OFFSET ?`).all(...params, limite, (pagina - 1) * limite);
  return { linhas, paginacao: { pagina, limite, total } };
}

export function traduzirUnico(erro, coluna, criarErro) {
  return String(erro?.message).includes(`UNIQUE constraint failed: ${coluna}`) ? criarErro() : erro;
}

export function agora() {
  return new Date().toISOString();
}
