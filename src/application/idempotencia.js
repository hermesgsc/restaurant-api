import crypto from 'node:crypto';
import { agora, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';

// json com chaves ordenadas, pra {a,b} e {b,a} darem o mesmo hash
function canonico(valor) {
  if (Array.isArray(valor)) return `[${valor.map(canonico).join(',')}]`;
  if (valor && typeof valor === 'object') {
    return `{${Object.keys(valor).sort().map((k) => `${JSON.stringify(k)}:${canonico(valor[k])}`).join(',')}}`;
  }
  return JSON.stringify(valor ?? null);
}

export function hashRequisicao(dados) {
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

  // a chave vale por usuario + operacao. se ja existe com o mesmo hash devolve
  // a resposta original; com hash diferente e 409. se nao existe, roda `executar`
  // e grava o resultado na mesma transacao, entao dois retries simultaneos
  // nunca criam dois pedidos. erro de negocio nao e gravado: o retry roda de novo.
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

  return { executarSincrono };
}
