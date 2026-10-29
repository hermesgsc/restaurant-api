import { agora, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel } from '../domain/papeis.js';

function paraProduto(l) {
  return {
    id: l.id,
    nome: l.nome,
    descricao: l.descricao,
    categoria: l.categoria,
    ativo: l.ativo === 1,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
  };
}

function traduzirConflito(erro) {
  if (String(erro.message).includes('UNIQUE constraint failed: produtos.nome')) {
    return erros.conflito('NOME_DUPLICADO', 'Ja existe um produto com este nome.', [{ field: 'nome', issue: 'Nome ja utilizado.' }]);
  }
  return erro;
}

// o catalogo e da rede toda, por isso so admin mexe. produto nunca e apagado,
// so desativado, pra nao quebrar pedido antigo que aponta pra ele
export function criarServicoProdutos({ db, auditoria }) {
  const buscar = db.prepare('SELECT * FROM produtos WHERE id = ?');

  function obter(id) {
    const linha = buscar.get(id);
    if (!linha) throw erros.naoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto nao encontrado.');
    return linha;
  }

  function listar(ator, { ativo, categoria, pagina, limite }) {
    const condicoes = [];
    const params = [];
    const veInativos = ator && ator.papel !== Papel.CLIENTE;
    if (!veInativos) condicoes.push('ativo = 1');
    else if (ativo !== undefined) { condicoes.push('ativo = ?'); params.push(ativo ? 1 : 0); }
    if (categoria) { condicoes.push('categoria = ?'); params.push(categoria); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM produtos ${where}`).get(...params).total;
    const linhas = db.prepare(`SELECT * FROM produtos ${where} ORDER BY id LIMIT ? OFFSET ?`).all(...params, limite, (pagina - 1) * limite);
    return { dados: linhas.map(paraProduto), paginacao: { pagina, limite, total } };
  }

  function criar(ator, { nome, descricao = null, categoria }, requestId) {
    if (ator.papel !== Papel.ADMIN) throw erros.proibido('Somente ADMIN gerencia o catalogo da rede.');
    const instante = agora();
    try {
      return transacao(db, () => {
        const id = Number(db.prepare('INSERT INTO produtos (nome, descricao, categoria, criado_em, atualizado_em) VALUES (?, ?, ?, ?, ?)')
          .run(nome, descricao, categoria, instante, instante).lastInsertRowid);
        auditoria.registrar({ ator, acao: 'PRODUTO_CRIADO', recursoTipo: 'PRODUTO', recursoId: id, requestId });
        return paraProduto(buscar.get(id));
      });
    } catch (erro) {
      throw traduzirConflito(erro);
    }
  }

  function atualizar(ator, id, dados, requestId) {
    if (ator.papel !== Papel.ADMIN) throw erros.proibido('Somente ADMIN gerencia o catalogo da rede.');
    obter(id);
    const mapa = { nome: 'nome', descricao: 'descricao', categoria: 'categoria', ativo: 'ativo' };
    const campos = [];
    const params = [];
    for (const [campo, coluna] of Object.entries(mapa)) {
      if (dados[campo] === undefined) continue;
      campos.push(`${coluna} = ?`);
      params.push(campo === 'ativo' ? (dados.ativo ? 1 : 0) : dados[campo]);
    }
    try {
      return transacao(db, () => {
        db.prepare(`UPDATE produtos SET ${campos.join(', ')}, atualizado_em = ? WHERE id = ?`).run(...params, agora(), id);
        auditoria.registrar({ ator, acao: 'PRODUTO_ATUALIZADO', recursoTipo: 'PRODUTO', recursoId: id, requestId, detalhes: { campos: Object.keys(dados) } });
        return paraProduto(buscar.get(id));
      });
    } catch (erro) {
      throw traduzirConflito(erro);
    }
  }

  return { obter, listar, criar, atualizar };
}
