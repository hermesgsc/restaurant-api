import { agora, paginar, transacao, traduzirUnico } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel, temEscopoUnidade } from '../domain/papeis.js';

function paraUnidade(l) {
  return { id: l.id, nome: l.nome, cidade: l.cidade, ativa: l.ativa === 1, criadoEm: l.criado_em, atualizadoEm: l.atualizado_em };
}

function conflitoNome(erro) {
  return traduzirUnico(erro, 'unidades.nome', () => erros.conflito('NOME_DUPLICADO', 'Ja existe um registro com este nome.', [{ field: 'nome', issue: 'Nome ja utilizado.' }]));
}

export function criarServicoUnidades({ db, auditoria }) {
  const buscar = db.prepare('SELECT * FROM unidades WHERE id = ?');

  function obter(id) {
    const linha = buscar.get(id);
    if (!linha) throw erros.naoEncontrado('UNIDADE_NAO_ENCONTRADA', 'Unidade nao encontrada.');
    return linha;
  }

  // a listagem e publica mas unidade inativa so aparece pra quem administra
  function listar(ator, { ativa, pagina, limite }) {
    const podeVerInativas = ator && (ator.papel === Papel.ADMIN || ator.papel === Papel.GERENTE);
    const condicoes = [];
    const params = [];
    if (!podeVerInativas) condicoes.push('ativa = 1');
    else if (ativa !== undefined) {
      condicoes.push('ativa = ?');
      params.push(ativa ? 1 : 0);
    }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const { linhas, paginacao } = paginar(db, { de: `FROM unidades ${where}`, params, ordem: 'id', pagina, limite });
    return { dados: linhas.map(paraUnidade), paginacao };
  }

  function criar(ator, { nome, cidade }, requestId) {
    if (ator.papel !== Papel.ADMIN) throw erros.proibido('Somente ADMIN cria unidades.');
    const instante = agora();
    try {
      return transacao(db, () => {
        const id = Number(db.prepare('INSERT INTO unidades (nome, cidade, criado_em, atualizado_em) VALUES (?, ?, ?, ?)')
          .run(nome, cidade, instante, instante).lastInsertRowid);
        auditoria.registrar({ ator, acao: 'UNIDADE_CRIADA', recursoTipo: 'UNIDADE', recursoId: id, unidadeId: id, requestId });
        return paraUnidade(buscar.get(id));
      });
    } catch (erro) {
      throw conflitoNome(erro);
    }
  }

  // gerente edita dados da propria unidade mas so admin ativa/desativa
  function atualizar(ator, id, dados, requestId) {
    obter(id);
    if (!temEscopoUnidade(ator, id) || (ator.papel !== Papel.ADMIN && ator.papel !== Papel.GERENTE)) throw erros.proibido();
    if (dados.ativa !== undefined && ator.papel !== Papel.ADMIN) throw erros.proibido('Somente ADMIN ativa ou desativa unidades.');
    const campos = [];
    const params = [];
    if (dados.nome !== undefined) { campos.push('nome = ?'); params.push(dados.nome); }
    if (dados.cidade !== undefined) { campos.push('cidade = ?'); params.push(dados.cidade); }
    if (dados.ativa !== undefined) { campos.push('ativa = ?'); params.push(dados.ativa ? 1 : 0); }
    try {
      return transacao(db, () => {
        db.prepare(`UPDATE unidades SET ${campos.join(', ')}, atualizado_em = ? WHERE id = ?`).run(...params, agora(), id);
        auditoria.registrar({ ator, acao: 'UNIDADE_ATUALIZADA', recursoTipo: 'UNIDADE', recursoId: id, unidadeId: id, requestId, detalhes: { campos: Object.keys(dados) } });
        return paraUnidade(buscar.get(id));
      });
    } catch (erro) {
      throw conflitoNome(erro);
    }
  }

  return { obter, listar, criar, atualizar, paraUnidade };
}
