import crypto from 'node:crypto';
import { agora, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';

function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

function hashRequisicao(dados) {
  return crypto.createHash('sha256').update(canonico(dados)).digest('hex');
}

export function criarServicoIdempotencia({ db }) {
  const buscar = db.prepare('SELECT * FROM idempotencia_registros WHERE usuario_id = ? AND operacao = ? AND chave = ?');
  const inserir = db.prepare(`INSERT INTO idempotencia_registros
    (usuario_id, operacao, chave, hash_requisicao, estado, status_http, corpo_resposta, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 'CONCLUIDO', ?, ?, ?, ?)`);

  function conferirExistente(registro, hash) {
    if (registro.hash_requisicao !== hash) {
      throw erros.conflito('IDEMPOTENCY_KEY_REUTILIZADA', 'Esta Idempotency-Key ja foi usada com outros dados.', [
        { field: 'Idempotency-Key', issue: 'Use uma chave nova para uma requisicao diferente.' },
      ]);
    }
    if (registro.estado !== 'CONCLUIDO') {
      throw erros.conflito('IDEMPOTENCIA_EM_PROCESSAMENTO', 'Uma requisicao com esta Idempotency-Key ainda esta em processamento.');
    }
    return { status: registro.status_http, corpo: JSON.parse(registro.corpo_resposta), repetida: true };
  }

  function executarSincrono({ usuarioId, operacao, chave, dados, executar }) {
    const hash = hashRequisicao(dados);
    return transacao(db, () => {
      const registro = buscar.get(usuarioId, operacao, chave);
      if (registro) return conferirExistente(registro, hash);
      const { status, corpo } = executar();
      const instante = agora();
      inserir.run(usuarioId, operacao, chave, hash, status, JSON.stringify(corpo), instante, instante);
      return { status, corpo, repetida: false };
    });
  }

  const inserirPendente = db.prepare(`INSERT INTO idempotencia_registros
    (usuario_id, operacao, chave, hash_requisicao, estado, criado_em, atualizado_em)
    VALUES (?, ?, ?, ?, 'EM_PROCESSAMENTO', ?, ?)`);
  const marcarConcluido = db.prepare(`UPDATE idempotencia_registros
    SET estado = 'CONCLUIDO', status_http = ?, corpo_resposta = ?, atualizado_em = ? WHERE id = ? AND estado = 'EM_PROCESSAMENTO'`);

  function consultar({ usuarioId, operacao, chave, dados }) {
    const hash = hashRequisicao(dados);
    const registro = buscar.get(usuarioId, operacao, chave);
    if (!registro) return { hash, registro: null };
    if (registro.hash_requisicao !== hash) conferirExistente(registro, hash);
    return { hash, registro };
  }

  function iniciar({ usuarioId, operacao, chave, hash }) {
    const instante = agora();
    return Number(inserirPendente.run(usuarioId, operacao, chave, hash, instante, instante).lastInsertRowid);
  }

  function concluir(id, status, corpo) {
    marcarConcluido.run(status, JSON.stringify(corpo), agora(), id);
  }

  return { executarSincrono, consultar, iniciar, concluir };
}
