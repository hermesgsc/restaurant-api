import { agora, paginar, placeholders } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel } from '../domain/papeis.js';

// grava so o necessario pra rastrear: quem, o que, em qual recurso/unidade,
// quando e o requestId. nunca senha, token, e-mail ou nome.
export function criarAuditoria(db) {
  const inserir = db.prepare(`INSERT INTO auditorias
    (ator_id, ator_papel, acao, recurso_tipo, recurso_id, unidade_id, resultado, request_id, detalhes, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  function registrar({ ator, acao, recursoTipo, recursoId = null, unidadeId = null, resultado = 'SUCESSO', requestId, detalhes = null }) {
    inserir.run(
      ator?.id ?? null,
      ator?.papel ?? null,
      acao,
      recursoTipo,
      recursoId === null ? null : String(recursoId),
      unidadeId,
      resultado,
      requestId ?? 'sem-request-id',
      detalhes ? JSON.stringify(detalhes) : null,
      agora(),
    );
  }

  // admin ve tudo; gerente so as unidades dele e nunca registros sem unidade
  function listar(ator, filtros, { pagina, limite }) {
    if (ator.papel !== Papel.ADMIN && ator.papel !== Papel.GERENTE) throw erros.proibido();
    const condicoes = [];
    const params = [];
    if (ator.papel === Papel.GERENTE) {
      if (filtros.unidadeId !== undefined && !ator.unidadeIds.includes(filtros.unidadeId)) throw erros.proibido();
      condicoes.push(`unidade_id IN (${placeholders(ator.unidadeIds)})`);
      params.push(...ator.unidadeIds);
    }
    for (const [campo, coluna] of [['unidadeId', 'unidade_id'], ['acao', 'acao'], ['recursoTipo', 'recurso_tipo'], ['recursoId', 'recurso_id'], ['requestId', 'request_id']]) {
      if (filtros[campo] !== undefined) {
        condicoes.push(`${coluna} = ?`);
        params.push(campo === 'recursoId' ? String(filtros[campo]) : filtros[campo]);
      }
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const { linhas, paginacao } = paginar(db, { de: `FROM auditorias ${where}`, params, ordem: 'id DESC', pagina, limite });
    return {
      dados: linhas.map((l) => ({
        id: l.id,
        atorId: l.ator_id,
        atorPapel: l.ator_papel,
        acao: l.acao,
        recursoTipo: l.recurso_tipo,
        recursoId: l.recurso_id,
        unidadeId: l.unidade_id,
        resultado: l.resultado,
        requestId: l.request_id,
        detalhes: l.detalhes ? JSON.parse(l.detalhes) : null,
        criadoEm: l.criado_em,
      })),
      paginacao,
    };
  }

  return { registrar, listar };
}
