import { agora, transacao } from '../infrastructure/banco.js';
import { erros } from '../domain/erros.js';
import { Papel, temEscopoUnidade } from '../domain/papeis.js';
import { aplicarMovimento, disponivel, TipoMovimento } from '../domain/estoque.js';

const TIPOS_MANUAIS = [TipoMovimento.ENTRADA, TipoMovimento.AJUSTE];

function paraSaldo(l) {
  return {
    unidadeId: l.unidade_id,
    produtoId: l.produto_id,
    produtoNome: l.produto_nome,
    quantidadeTotal: l.quantidade_total,
    quantidadeReservada: l.quantidade_reservada,
    quantidadeDisponivel: l.quantidade_total - l.quantidade_reservada,
    atualizadoEm: l.atualizado_em,
  };
}

function paraMovimento(l) {
  return {
    id: l.id,
    unidadeId: l.unidade_id,
    produtoId: l.produto_id,
    tipo: l.tipo,
    quantidade: l.quantidade,
    totalApos: l.total_apos,
    reservadaApos: l.reservada_apos,
    usuarioId: l.usuario_id,
    motivo: l.motivo,
    criadoEm: l.criado_em,
  };
}

export function criarServicoEstoque({ db, auditoria, unidades, produtos }) {
  const buscarSaldo = db.prepare('SELECT * FROM estoques WHERE unidade_id = ? AND produto_id = ?');
  const criarSaldo = db.prepare(`INSERT INTO estoques (unidade_id, produto_id, quantidade_total, quantidade_reservada, atualizado_em)
    VALUES (?, ?, 0, 0, ?)`);
  // o WHERE repete o saldo lido: se outro processo mudou a linha no meio, nada e atualizado
  const gravarSaldo = db.prepare(`UPDATE estoques SET quantidade_total = ?, quantidade_reservada = ?, atualizado_em = ?
    WHERE unidade_id = ? AND produto_id = ? AND quantidade_total = ? AND quantidade_reservada = ?`);

  const inserirMovimento = db.prepare(`INSERT INTO estoque_movimentacoes
    (unidade_id, produto_id, tipo, quantidade, total_apos, reservada_apos, usuario_id, motivo, criado_em)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`);

  // unico caminho que muda saldo de estoque. roda dentro de transacao
  // (BEGIN IMMEDIATE) e grava o movimento junto, entao saldo e historico
  // nunca ficam diferentes. a regra de negativo fica no dominio e o banco
  // confere de novo pelos CHECK.
  function movimentar({ unidadeId, produtoId, tipo, quantidade, usuarioId = null, motivo = null }) {
    return transacao(db, () => {
      const instante = agora();
      let linha = buscarSaldo.get(unidadeId, produtoId);
      if (!linha) {
        criarSaldo.run(unidadeId, produtoId, instante);
        linha = buscarSaldo.get(unidadeId, produtoId);
      }
      const atual = { total: linha.quantidade_total, reservada: linha.quantidade_reservada };
      const novo = aplicarMovimento(atual, tipo, quantidade);
      const r = gravarSaldo.run(novo.total, novo.reservada, instante, unidadeId, produtoId, atual.total, atual.reservada);
      if (r.changes !== 1) throw erros.conflito('ESTOQUE_CONCORRENTE', 'O estoque mudou durante a operacao. Tente novamente.');
      const movimento = inserirMovimento.run(unidadeId, produtoId, tipo, quantidade, novo.total, novo.reservada, usuarioId, motivo, instante);
      return { id: Number(movimento.lastInsertRowid), saldo: novo, disponivel: disponivel(novo) };
    });
  }

  function exigirEscopo(ator, unidadeId, papeis) {
    if (!papeis.includes(ator.papel) || !temEscopoUnidade(ator, unidadeId)) throw erros.proibido();
  }

  function listarSaldos(ator, { unidadeId, produtoId, pagina, limite }) {
    unidades.obter(unidadeId);
    exigirEscopo(ator, unidadeId, [Papel.ADMIN, Papel.GERENTE, Papel.ATENDENTE, Papel.COZINHA]);
    const params = [unidadeId];
    let filtro = '';
    if (produtoId !== undefined) { filtro = ' AND e.produto_id = ?'; params.push(produtoId); }
    const sql = `FROM estoques e JOIN produtos p ON p.id = e.produto_id WHERE e.unidade_id = ?${filtro}`;
    const total = db.prepare(`SELECT COUNT(*) AS total ${sql}`).get(...params).total;
    const linhas = db.prepare(`SELECT e.*, p.nome AS produto_nome ${sql} ORDER BY p.nome LIMIT ? OFFSET ?`)
      .all(...params, limite, (pagina - 1) * limite);
    return { dados: linhas.map(paraSaldo), paginacao: { pagina, limite, total } };
  }

  // entrada e ajuste manual (inventario, perda, quebra). reserva, consumo e
  // liberacao so acontecem pelo fluxo do pedido, nunca por esta rota
  function registrarMovimentacao(ator, { unidadeId, produtoId, tipo, quantidade, motivo }, requestId) {
    if (!TIPOS_MANUAIS.includes(tipo)) throw erros.validacao('VALIDACAO', 'Dados de entrada invalidos.', [{ field: 'tipo', issue: 'Use ENTRADA ou AJUSTE.' }]);
    unidades.obter(unidadeId);
    produtos.obter(produtoId);
    exigirEscopo(ator, unidadeId, [Papel.ADMIN, Papel.GERENTE]);
    return transacao(db, () => {
      const resultado = movimentar({ unidadeId, produtoId, tipo, quantidade, usuarioId: ator.id, motivo: motivo ?? null });
      auditoria.registrar({
        ator,
        acao: tipo === TipoMovimento.ENTRADA ? 'ESTOQUE_ENTRADA' : 'ESTOQUE_AJUSTE',
        recursoTipo: 'ESTOQUE',
        recursoId: `${unidadeId}:${produtoId}`,
        unidadeId,
        requestId,
        detalhes: { quantidade, movimentoId: resultado.id },
      });
      const linha = db.prepare(`SELECT e.*, p.nome AS produto_nome FROM estoques e JOIN produtos p ON p.id = e.produto_id
        WHERE e.unidade_id = ? AND e.produto_id = ?`).get(unidadeId, produtoId);
      const movimento = db.prepare('SELECT * FROM estoque_movimentacoes WHERE id = ?').get(resultado.id);
      return { movimentacao: paraMovimento(movimento), saldo: paraSaldo(linha) };
    });
  }

  function listarMovimentacoes(ator, { unidadeId, produtoId, tipo, pagina, limite }) {
    unidades.obter(unidadeId);
    exigirEscopo(ator, unidadeId, [Papel.ADMIN, Papel.GERENTE]);
    const condicoes = ['unidade_id = ?'];
    const params = [unidadeId];
    if (produtoId !== undefined) { condicoes.push('produto_id = ?'); params.push(produtoId); }
    if (tipo !== undefined) { condicoes.push('tipo = ?'); params.push(tipo); }
    const where = `WHERE ${condicoes.join(' AND ')}`;
    const total = db.prepare(`SELECT COUNT(*) AS total FROM estoque_movimentacoes ${where}`).get(...params).total;
    const linhas = db.prepare(`SELECT * FROM estoque_movimentacoes ${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, limite, (pagina - 1) * limite);
    return { dados: linhas.map(paraMovimento), paginacao: { pagina, limite, total } };
  }

  return { movimentar, listarSaldos, registrarMovimentacao, listarMovimentacoes };
}
