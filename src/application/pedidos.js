import { agora } from '../infrastructure/banco.js';
import { erros, ErroNegocio } from '../domain/erros.js';
import { ehFuncionario, Papel, temEscopoUnidade } from '../domain/papeis.js';
import { multiplicar, somar } from '../domain/dinheiro.js';
import { TipoMovimento } from '../domain/estoque.js';
import { ReservaEstoque, StatusPedido } from '../domain/pedido.js';

const PAPEIS_QUE_VENDEM = [Papel.ADMIN, Papel.GERENTE, Papel.ATENDENTE];

export function paraPedido(l, itens) {
  const pedido = {
    id: l.id,
    unidadeId: l.unidade_id,
    clienteId: l.cliente_id,
    criadoPorId: l.criado_por_id,
    canalPedido: l.canal_pedido,
    status: l.status,
    formaPagamento: l.forma_pagamento,
    subtotalCentavos: l.subtotal_centavos,
    descontoCentavos: l.desconto_centavos,
    totalCentavos: l.total_centavos,
    reservaEstoque: l.reserva_estoque_status,
    motivoCancelamento: l.motivo_cancelamento,
    expiraEm: l.expira_em,
    criadoEm: l.criado_em,
    atualizadoEm: l.atualizado_em,
    pagoEm: l.pago_em,
    prontoEm: l.pronto_em,
    entregueEm: l.entregue_em,
    canceladoEm: l.cancelado_em,
  };
  if (itens) {
    pedido.itens = itens.map((i) => ({
      produtoId: i.produto_id,
      nomeProduto: i.nome_produto,
      quantidade: i.quantidade,
      precoUnitarioCentavos: i.preco_unitario_centavos,
      totalCentavos: i.total_centavos,
    }));
  }
  return pedido;
}

export function criarServicoPedidos({ db, config, auditoria, estoque, idempotencia }) {
  const buscarPedido = db.prepare('SELECT * FROM pedidos WHERE id = ?');
  const buscarItens = db.prepare('SELECT * FROM pedido_itens WHERE pedido_id = ? ORDER BY id');
  const buscarUnidade = db.prepare('SELECT * FROM unidades WHERE id = ?');
  const buscarItemCardapio = db.prepare(`SELECT p.id, p.nome, p.ativo, c.preco_centavos, c.disponivel
    FROM produtos p LEFT JOIN cardapio_itens c ON c.produto_id = p.id AND c.unidade_id = ?
    WHERE p.id = ?`);
  const buscarCliente = db.prepare('SELECT id, papel, ativo FROM usuarios WHERE id = ?');

  function detalhar(id) {
    return paraPedido(buscarPedido.get(id), buscarItens.all(id));
  }

  // quem e o cliente do pedido sai do token, nunca do corpo. funcionario pode
  // vincular um cliente existente ou vender sem cliente no balcao.
  function resolverCliente(ator, clienteId) {
    if (ator.papel === Papel.CLIENTE) {
      if (clienteId !== undefined && clienteId !== ator.id) throw erros.proibido('Cliente nao pode criar pedido em nome de outra pessoa.');
      return ator.id;
    }
    if (clienteId === undefined || clienteId === null) return null;
    const cliente = buscarCliente.get(clienteId);
    if (!cliente || cliente.papel !== Papel.CLIENTE || cliente.ativo !== 1) {
      throw erros.naoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente nao encontrado.', [{ field: 'clienteId', issue: 'Informe um cliente ativo.' }]);
    }
    return cliente.id;
  }

  function validarPermissaoCriacao(ator, unidadeId, canalPedido) {
    if (ator.papel === Papel.CLIENTE) {
      if (canalPedido === 'BALCAO') throw erros.proibido('Pedido no canal BALCAO e registrado por um atendente.');
      return;
    }
    if (!PAPEIS_QUE_VENDEM.includes(ator.papel) || !temEscopoUnidade(ator, unidadeId)) throw erros.proibido();
  }

  // monta os itens com preco do banco. o cliente manda so produto e quantidade,
  // qualquer preco ou total no corpo ja foi barrado pelo schema da rota
  function precificar(unidadeId, itens) {
    const vistos = new Set();
    return itens.map((item, i) => {
      if (vistos.has(item.produtoId)) {
        throw erros.validacao('PRODUTO_REPETIDO', 'Cada produto deve aparecer uma unica vez no pedido; some as quantidades na mesma linha.', [
          { field: `itens[${i}].produtoId`, issue: 'Produto repetido.' },
        ]);
      }
      vistos.add(item.produtoId);
      const linha = buscarItemCardapio.get(unidadeId, item.produtoId);
      const campo = `itens[${i}].produtoId`;
      if (!linha) throw erros.naoEncontrado('PRODUTO_NAO_ENCONTRADO', 'Produto nao encontrado.', [{ field: campo, issue: 'Produto inexistente.' }]);
      if (linha.preco_centavos === null) {
        throw erros.conflito('PRODUTO_FORA_DO_CARDAPIO', 'Produto nao faz parte do cardapio desta unidade.', [{ field: campo, issue: 'Fora do cardapio.' }]);
      }
      if (linha.ativo !== 1 || linha.disponivel !== 1) {
        throw erros.conflito('PRODUTO_INDISPONIVEL', 'Produto indisponivel nesta unidade.', [{ field: campo, issue: 'Indisponivel.' }]);
      }
      return {
        produtoId: linha.id,
        nome: linha.nome,
        quantidade: item.quantidade,
        precoUnitario: linha.preco_centavos,
        total: multiplicar(linha.preco_centavos, item.quantidade),
      };
    });
  }

  // tudo numa transacao so: pedido, itens e reserva de estoque. se um item
  // nao tem saldo, o rollback desfaz as reservas dos itens anteriores.
  function inserirPedido(ator, dados) {
    const { unidadeId, canalPedido, itens, formaPagamento } = dados;
    const unidade = buscarUnidade.get(unidadeId);
    if (!unidade) throw erros.naoEncontrado('UNIDADE_NAO_ENCONTRADA', 'Unidade nao encontrada.', [{ field: 'unidadeId', issue: 'Unidade inexistente.' }]);
    validarPermissaoCriacao(ator, unidadeId, canalPedido);
    if (unidade.ativa !== 1) throw erros.conflito('UNIDADE_INATIVA', 'A unidade nao esta recebendo pedidos.', [{ field: 'unidadeId', issue: 'Unidade inativa.' }]);
    const clienteId = resolverCliente(ator, dados.clienteId);
    const linhas = precificar(unidadeId, itens);
    const subtotal = somar(linhas.map((l) => l.total));
    const instante = agora();
    const expiraEm = new Date(Date.parse(instante) + config.pedidoExpiracaoMinutos * 60000).toISOString();

    const pedidoId = Number(db.prepare(`INSERT INTO pedidos
      (unidade_id, cliente_id, criado_por_id, canal_pedido, status, forma_pagamento, subtotal_centavos, desconto_centavos,
       total_centavos, reserva_estoque_status, expira_em, criado_em, atualizado_em)
      VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?)`).run(
      unidadeId, clienteId, ator.id, canalPedido, StatusPedido.AGUARDANDO_PAGAMENTO, formaPagamento,
      subtotal, subtotal, ReservaEstoque.ATIVA, expiraEm, instante, instante,
    ).lastInsertRowid);

    const inserirItem = db.prepare(`INSERT INTO pedido_itens
      (pedido_id, produto_id, nome_produto, quantidade, preco_unitario_centavos, total_centavos) VALUES (?, ?, ?, ?, ?, ?)`);
    linhas.forEach((l, i) => {
      inserirItem.run(pedidoId, l.produtoId, l.nome, l.quantidade, l.precoUnitario, l.total);
      try {
        estoque.movimentar({ unidadeId, produtoId: l.produtoId, tipo: TipoMovimento.RESERVA, quantidade: l.quantidade, pedidoId, usuarioId: ator.id });
      } catch (erro) {
        if (erro instanceof ErroNegocio && erro.codigo === 'ESTOQUE_INSUFICIENTE') {
          erro.detalhes = erro.detalhes.map((d) => ({ ...d, field: `itens[${i}].quantidade` }));
        }
        throw erro;
      }
    });
    return pedidoId;
  }

  function criar(ator, dados, { chave, requestId }) {
    return idempotencia.executarSincrono({
      usuarioId: ator.id,
      operacao: 'CRIAR_PEDIDO',
      chave,
      dados,
      executar: () => {
        const pedidoId = inserirPedido(ator, dados);
        const pedido = detalhar(pedidoId);
        auditoria.registrar({
          ator, acao: 'PEDIDO_CRIADO', recursoTipo: 'PEDIDO', recursoId: pedidoId, unidadeId: pedido.unidadeId, requestId,
          detalhes: { canalPedido: pedido.canalPedido, totalCentavos: pedido.totalCentavos, itens: pedido.itens.length },
        });
        return { status: 201, corpo: pedido };
      },
    });
  }

  // cliente so ve os proprios pedidos; funcionario so os das suas unidades
  function exigirAcesso(ator, pedido, requestId) {
    const permitido = ator.papel === Papel.ADMIN
      || (ator.papel === Papel.CLIENTE && pedido.cliente_id === ator.id)
      || (ehFuncionario(ator) && ator.unidadeIds.includes(pedido.unidade_id));
    if (!permitido) {
      auditoria.registrar({ ator, acao: 'PEDIDO_ACESSO_NEGADO', recursoTipo: 'PEDIDO', recursoId: pedido.id, unidadeId: pedido.unidade_id, resultado: 'NEGADO', requestId });
      throw erros.proibido('Voce nao tem acesso a este pedido.');
    }
  }

  function obterLinha(id) {
    const linha = buscarPedido.get(id);
    if (!linha) throw erros.naoEncontrado('PEDIDO_NAO_ENCONTRADO', 'Pedido nao encontrado.');
    return linha;
  }

  function obter(ator, id, requestId) {
    exigirAcesso(ator, obterLinha(id), requestId);
    return detalhar(id);
  }

  function listar(ator, { unidadeId, status, canalPedido, pagina, limite }) {
    const condicoes = [];
    const params = [];
    if (ator.papel === Papel.CLIENTE) {
      condicoes.push('cliente_id = ?');
      params.push(ator.id);
    } else if (ator.papel !== Papel.ADMIN) {
      if (unidadeId !== undefined && !ator.unidadeIds.includes(unidadeId)) throw erros.proibido('Voce nao tem acesso a esta unidade.');
      condicoes.push(`unidade_id IN (${ator.unidadeIds.map(() => '?').join(',') || 'NULL'})`);
      params.push(...ator.unidadeIds);
    }
    if (unidadeId !== undefined) { condicoes.push('unidade_id = ?'); params.push(unidadeId); }
    if (status !== undefined) { condicoes.push('status = ?'); params.push(status); }
    if (canalPedido !== undefined) { condicoes.push('canal_pedido = ?'); params.push(canalPedido); }
    const where = condicoes.length ? `WHERE ${condicoes.join(' AND ')}` : '';
    const total = db.prepare(`SELECT COUNT(*) AS total FROM pedidos ${where}`).get(...params).total;
    const linhas = db.prepare(`SELECT * FROM pedidos ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...params, limite, (pagina - 1) * limite);
    return { dados: linhas.map((l) => paraPedido(l)), paginacao: { pagina, limite, total } };
  }

  return { criar, obter, listar, obterLinha, exigirAcesso, detalhar };
}
