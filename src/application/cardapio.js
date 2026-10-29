import { agora, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel, temEscopoUnidade } from '../domain/papeis.js';

function paraItem(l) {
  return {
    produtoId: l.produto_id,
    nome: l.nome,
    descricao: l.descricao,
    categoria: l.categoria,
    precoCentavos: l.preco_centavos,
    disponivel: l.disponivel === 1 && l.produto_ativo === 1,
    atualizadoEm: l.atualizado_em,
  };
}

export function podeGerenciarUnidade(ator, unidadeId) {
  return (ator.papel === Papel.ADMIN || ator.papel === Papel.GERENTE) && temEscopoUnidade(ator, unidadeId);
}

export function criarServicoCardapio({ db, auditoria, unidades, produtos }) {
  const SELECT_ITENS = `SELECT c.produto_id, c.preco_centavos, c.disponivel, c.atualizado_em,
      p.nome, p.descricao, p.categoria, p.ativo AS produto_ativo
    FROM cardapio_itens c JOIN produtos p ON p.id = c.produto_id
    WHERE c.unidade_id = ?`;

  // cliente ve so o que pode pedir agora; quem gerencia a unidade ve tudo
  function listar(ator, unidadeId, { incluirIndisponiveis, pagina, limite }) {
    const unidade = unidades.obter(unidadeId);
    const gestor = ator && podeGerenciarUnidade(ator, unidadeId);
    if (unidade.ativa !== 1 && !gestor) throw erros.naoEncontrado('UNIDADE_NAO_ENCONTRADA', 'Unidade nao encontrada.');
    const filtro = incluirIndisponiveis && gestor ? '' : ' AND c.disponivel = 1 AND p.ativo = 1';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM (${SELECT_ITENS}${filtro})`).get(unidadeId).total;
    const linhas = db.prepare(`${SELECT_ITENS}${filtro} ORDER BY p.categoria, p.nome LIMIT ? OFFSET ?`)
      .all(unidadeId, limite, (pagina - 1) * limite);
    return {
      unidade: unidades.paraUnidade(unidade),
      dados: linhas.map(paraItem),
      paginacao: { pagina, limite, total },
    };
  }

  // upsert: coloca o produto no cardapio da unidade ou muda preco/disponibilidade
  function definirItem(ator, unidadeId, produtoId, { precoCentavos, disponivel }, requestId) {
    unidades.obter(unidadeId);
    if (!podeGerenciarUnidade(ator, unidadeId)) throw erros.proibido();
    produtos.obter(produtoId);
    const instante = agora();
    return transacao(db, () => {
      const existente = db.prepare('SELECT * FROM cardapio_itens WHERE unidade_id = ? AND produto_id = ?').get(unidadeId, produtoId);
      if (!existente && precoCentavos === undefined) {
        throw erros.validacao('VALIDACAO', 'Dados de entrada invalidos.', [{ field: 'precoCentavos', issue: 'Obrigatorio ao incluir o produto no cardapio.' }]);
      }
      if (existente) {
        db.prepare('UPDATE cardapio_itens SET preco_centavos = ?, disponivel = ?, atualizado_em = ? WHERE id = ?').run(
          precoCentavos ?? existente.preco_centavos,
          disponivel === undefined ? existente.disponivel : disponivel ? 1 : 0,
          instante,
          existente.id,
        );
      } else {
        db.prepare(`INSERT INTO cardapio_itens (unidade_id, produto_id, preco_centavos, disponivel, criado_em, atualizado_em)
          VALUES (?, ?, ?, ?, ?, ?)`).run(unidadeId, produtoId, precoCentavos, disponivel === false ? 0 : 1, instante, instante);
      }
      auditoria.registrar({
        ator,
        acao: existente ? 'CARDAPIO_ITEM_ATUALIZADO' : 'CARDAPIO_ITEM_INCLUIDO',
        recursoTipo: 'CARDAPIO_ITEM',
        recursoId: `${unidadeId}:${produtoId}`,
        unidadeId,
        requestId,
        detalhes: { precoAnteriorCentavos: existente?.preco_centavos ?? null, precoCentavos: precoCentavos ?? existente?.preco_centavos, disponivel },
      });
      return paraItem(db.prepare(`${SELECT_ITENS} AND c.produto_id = ?`).get(unidadeId, produtoId));
    });
  }

  return { listar, definirItem };
}
