import fs from 'node:fs';
import path from 'node:path';

// gera a colecao e o environment do postman em postman/. a colecao e escrita
// por aqui pra ficar revisavel e nao depender de exportar na mao pelo app.
// rode `npm run postman:gerar` depois de mudar alguma requisicao.

const raiz = path.resolve(import.meta.dirname, '..');
const pasta = path.join(raiz, 'postman');

const js = (...linhas) => linhas.flat();

// "#nome" dentro do corpo vira {{nome}} sem aspas, pra ids numericos
function corpoJson(corpo) {
  return JSON.stringify(corpo, null, 2).replace(/"#(\w+)"/g, '{{$1}}');
}

function requisicao(nome, metodo, caminho, { token, corpo, corpoBruto, cabecalhos = {}, antes = [], testes = [], descricao } = {}) {
  const header = Object.entries(cabecalhos).map(([key, value]) => ({ key, value }));
  if (corpo !== undefined || corpoBruto !== undefined) header.unshift({ key: 'Content-Type', value: 'application/json' });
  const event = [];
  if (antes.length) event.push({ listen: 'prerequest', script: { type: 'text/javascript', exec: antes } });
  event.push({ listen: 'test', script: { type: 'text/javascript', exec: testes } });
  const request = {
    method: metodo,
    header,
    url: `{{baseUrl}}${caminho}`,
    auth: token ? { type: 'bearer', bearer: [{ key: 'token', value: `{{${token}}}`, type: 'string' }] } : { type: 'noauth' },
  };
  if (descricao) request.description = descricao;
  if (corpo !== undefined || corpoBruto !== undefined) {
    request.body = { mode: 'raw', raw: corpoBruto ?? corpoJson(corpo), options: { raw: { language: 'json' } } };
  }
  return { name: nome, event, request };
}

const status = (s) => `pm.test('status ${s}', () => pm.response.to.have.status(${s}));`;
const salvar = (variavel, expressao) => `pm.collectionVariables.set('${variavel}', ${expressao});`;
const novaChave = (variavel) => `pm.collectionVariables.set('${variavel}', pm.variables.replaceIn('{{$guid}}'));`;

// confere o envelope padrao de erro e o codigo
const erro = (s, codigo) => js(
  status(s),
  `pm.test('envelope de erro ${codigo}', () => {`,
  '  const b = pm.response.json();',
  `  pm.expect(b.error).to.eql('${codigo}');`,
  "  pm.expect(b).to.have.all.keys('error', 'message', 'details', 'timestamp', 'path', 'requestId');",
  "  pm.expect(b.details).to.be.an('array');",
  "  pm.expect(b.requestId).to.eql(pm.response.headers.get('X-Request-Id'));",
  '});',
);

const login = (nome, email, variavel) => requisicao(nome, 'POST', '/auth/login', {
  corpo: { email: `{{${email}}}`, senha: '{{senhaDemo}}' },
  testes: js(status(200), "pm.test('token bearer', () => pm.expect(pm.response.json().tokenType).to.eql('Bearer'));", salvar(variavel, 'pm.response.json().accessToken')),
});

const pedidoCentro = (itens, extra = {}) => ({ unidadeId: '#unidadeCentroId', canalPedido: 'APP', formaPagamento: 'MOCK', ...extra, itens });

const auth = {
  name: 'Auth',
  item: [
    requisicao('Health', 'GET', '/health', { testes: js(status(200), "pm.test('status ok', () => pm.expect(pm.response.json().status).to.eql('ok'));") }),
    requisicao('Cadastrar cliente', 'POST', '/usuarios', {
      antes: [salvar('emailCliente', "'postman-' + pm.variables.replaceIn('{{$guid}}').slice(0, 8) + '@teste.local'")],
      corpo: { nome: 'Cliente Postman', email: '{{emailCliente}}', senha: '{{senhaCliente}}' },
      testes: js(
        status(201),
        "pm.test('papel e sempre CLIENTE e a senha nao volta', () => { const b = pm.response.json(); pm.expect(b.papel).to.eql('CLIENTE'); pm.expect(b).to.not.have.any.keys('senha', 'senhaHash', 'senha_hash'); });",
        salvar('clienteId', 'pm.response.json().id'),
      ),
    }),
    requisicao('Cadastro com e-mail repetido (409)', 'POST', '/usuarios', {
      corpo: { nome: 'Cliente Postman', email: '{{emailCliente}}', senha: '{{senhaCliente}}' },
      testes: erro(409, 'EMAIL_JA_CADASTRADO'),
    }),
    requisicao('Login do cliente', 'POST', '/auth/login', {
      corpo: { email: '{{emailCliente}}', senha: '{{senhaCliente}}' },
      testes: js(status(200), salvar('tokenCliente', 'pm.response.json().accessToken')),
    }),
    login('Login admin', 'emailAdmin', 'tokenAdmin'),
    login('Login gerente centro', 'emailGerenteCentro', 'tokenGerenteCentro'),
    login('Login gerente shopping', 'emailGerenteShopping', 'tokenGerenteShopping'),
    login('Login atendente centro', 'emailAtendenteCentro', 'tokenAtendenteCentro'),
    login('Login cozinha centro', 'emailCozinhaCentro', 'tokenCozinhaCentro'),
    requisicao('Login com senha errada (401)', 'POST', '/auth/login', {
      corpo: { email: '{{emailCliente}}', senha: 'SenhaErrada@1' },
      testes: js(erro(401, 'NAO_AUTENTICADO'), "pm.test('mensagem generica', () => pm.expect(pm.response.json().message).to.eql('Credenciais invalidas.'));"),
    }),
    requisicao('Meu perfil', 'GET', '/usuarios/me', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('perfil do cliente logado', () => pm.expect(pm.response.json().id).to.eql(Number(pm.collectionVariables.get('clienteId'))));"),
    }),
  ],
};

const unidades = {
  name: 'Units/Menu',
  item: [
    requisicao('Listar unidades (publico)', 'GET', '/unidades', {
      testes: js(
        status(200),
        "const dados = pm.response.json().dados;",
        "pm.test('so unidades ativas para o publico', () => pm.expect(dados.every((u) => u.ativa)).to.be.true);",
        salvar('unidadeCentroId', "dados.find((u) => u.nome === 'Unidade Centro').id"),
        salvar('unidadeShoppingId', "dados.find((u) => u.nome === 'Unidade Shopping').id"),
      ),
    }),
    requisicao('Cardapio da Unidade Centro', 'GET', '/unidades/{{unidadeCentroId}}/cardapio', {
      testes: js(
        status(200),
        'const dados = pm.response.json().dados;',
        "const item = (nome) => dados.find((i) => i.nome === nome);",
        "pm.test('preco em centavos inteiros', () => pm.expect(Number.isInteger(item('X-Burger').precoCentavos)).to.be.true);",
        "pm.test('item indisponivel nao aparece', () => pm.expect(item('Combo Classico')).to.be.undefined);",
        salvar('produtoXBurgerId', "item('X-Burger').produtoId"),
        salvar('produtoRefriId', "item('Refrigerante Lata').produtoId"),
        salvar('precoXBurgerCentro', "item('X-Burger').precoCentavos"),
        salvar('precoRefriCentro', "item('Refrigerante Lata').precoCentavos"),
      ),
    }),
    requisicao('Cardapio da Unidade Shopping (preco diferente)', 'GET', '/unidades/{{unidadeShoppingId}}/cardapio', {
      testes: js(
        status(200),
        "const xburger = pm.response.json().dados.find((i) => i.nome === 'X-Burger');",
        "pm.test('cada unidade tem o proprio preco', () => pm.expect(xburger.precoCentavos).to.not.eql(Number(pm.collectionVariables.get('precoXBurgerCentro'))));",
      ),
    }),
    requisicao('Listar produtos', 'GET', '/produtos?limit=50', { testes: js(status(200), "pm.test('paginacao', () => pm.expect(pm.response.json().paginacao.limite).to.eql(50));") }),
    requisicao('Criar unidade (admin)', 'POST', '/unidades', {
      token: 'tokenAdmin',
      antes: [salvar('nomeNovaUnidade', "'Unidade Postman ' + pm.variables.replaceIn('{{$guid}}').slice(0, 6)")],
      corpo: { nome: '{{nomeNovaUnidade}}', cidade: 'Maringa' },
      testes: js(status(201), "pm.test('Location', () => pm.expect(pm.response.headers.get('Location')).to.match(/^\\/unidades\\/\\d+$/));", salvar('novaUnidadeId', 'pm.response.json().id')),
    }),
    requisicao('Alterar unidade (admin)', 'PATCH', '/unidades/{{novaUnidadeId}}', {
      token: 'tokenAdmin', corpo: { cidade: 'Cascavel' },
      testes: js(status(200), "pm.test('cidade alterada', () => pm.expect(pm.response.json().cidade).to.eql('Cascavel'));"),
    }),
    requisicao('Gerente nao desativa unidade (403)', 'PATCH', '/unidades/{{unidadeCentroId}}', {
      token: 'tokenGerenteCentro', corpo: { ativa: false }, testes: erro(403, 'ACESSO_NEGADO'),
    }),
    requisicao('Criar produto (admin)', 'POST', '/produtos', {
      token: 'tokenAdmin',
      antes: [salvar('nomeNovoProduto', "'Wrap Postman ' + pm.variables.replaceIn('{{$guid}}').slice(0, 6)")],
      corpo: { nome: '{{nomeNovoProduto}}', categoria: 'LANCHE', descricao: 'Criado pela colecao.' },
      testes: js(status(201), salvar('novoProdutoId', 'pm.response.json().id')),
    }),
    requisicao('Alterar produto (admin)', 'PATCH', '/produtos/{{novoProdutoId}}', {
      token: 'tokenAdmin', corpo: { descricao: 'Wrap de frango.' },
      testes: js(status(200)),
    }),
    requisicao('Colocar produto no cardapio da unidade nova', 'PUT', '/unidades/{{novaUnidadeId}}/cardapio/{{novoProdutoId}}', {
      token: 'tokenAdmin', corpo: { precoCentavos: 1890, disponivel: true },
      testes: js(status(200), "pm.test('preco salvo', () => pm.expect(pm.response.json().precoCentavos).to.eql(1890));"),
    }),
    requisicao('Cliente nao cria produto (403)', 'POST', '/produtos', {
      token: 'tokenCliente', corpo: { nome: 'Produto Proibido', categoria: 'LANCHE' }, testes: erro(403, 'ACESSO_NEGADO'),
    }),
  ],
};

const estoque = {
  name: 'Stock',
  item: [
    requisicao('Saldo de estoque da Unidade Centro', 'GET', '/estoque?unidadeId={{unidadeCentroId}}&produtoId={{produtoXBurgerId}}', {
      token: 'tokenGerenteCentro',
      testes: js(
        status(200),
        'const s = pm.response.json().dados[0];',
        "pm.test('disponivel = total - reservado', () => pm.expect(s.quantidadeDisponivel).to.eql(s.quantidadeTotal - s.quantidadeReservada));",
        salvar('estoqueXBurgerAntes', 's.quantidadeTotal'),
      ),
    }),
    requisicao('Entrada de estoque (gerente)', 'POST', '/estoque/movimentacoes', {
      token: 'tokenGerenteCentro',
      corpo: { unidadeId: '#unidadeCentroId', produtoId: '#produtoXBurgerId', tipo: 'ENTRADA', quantidade: 5, motivo: 'Reposicao pela colecao' },
      testes: js(status(201), "pm.test('total somou 5', () => pm.expect(pm.response.json().saldo.quantidadeTotal).to.eql(Number(pm.collectionVariables.get('estoqueXBurgerAntes')) + 5));"),
    }),
    requisicao('Ajuste sem motivo (422)', 'POST', '/estoque/movimentacoes', {
      token: 'tokenGerenteCentro',
      corpo: { unidadeId: '#unidadeCentroId', produtoId: '#produtoXBurgerId', tipo: 'AJUSTE', quantidade: -1 },
      testes: js(erro(422, 'VALIDACAO'), "pm.test('campo motivo', () => pm.expect(pm.response.json().details[0].field).to.eql('motivo'));"),
    }),
    requisicao('Historico de movimentacoes', 'GET', '/estoque/movimentacoes?unidadeId={{unidadeCentroId}}&tipo=ENTRADA&limit=5', {
      token: 'tokenGerenteCentro',
      testes: js(status(200), "pm.test('so entradas', () => pm.expect(pm.response.json().dados.every((m) => m.tipo === 'ENTRADA')).to.be.true);"),
    }),
    requisicao('Gerente de outra unidade nao ve o estoque (403)', 'GET', '/estoque?unidadeId={{unidadeCentroId}}', {
      token: 'tokenGerenteShopping', testes: erro(403, 'ACESSO_NEGADO'),
    }),
  ],
};

const pedidos = {
  name: 'Orders',
  item: [
    requisicao('Criar pedido pelo APP', 'POST', '/pedidos', {
      token: 'tokenCliente',
      antes: [novaChave('chavePedido')],
      cabecalhos: { 'Idempotency-Key': '{{chavePedido}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 2 }, { produtoId: '#produtoRefriId', quantidade: 1 }]),
      testes: js(
        status(201),
        'const b = pm.response.json();',
        "const esperado = 2 * Number(pm.collectionVariables.get('precoXBurgerCentro')) + Number(pm.collectionVariables.get('precoRefriCentro'));",
        "pm.test('total calculado pelo servidor', () => pm.expect(b.totalCentavos).to.eql(esperado));",
        "pm.test('aguardando pagamento e estoque reservado', () => { pm.expect(b.status).to.eql('AGUARDANDO_PAGAMENTO'); pm.expect(b.reservaEstoque).to.eql('ATIVA'); });",
        salvar('pedidoId', 'b.id'),
        salvar('totalPedido', 'b.totalCentavos'),
      ),
    }),
    requisicao('Repetir criacao com a mesma Idempotency-Key', 'POST', '/pedidos', {
      token: 'tokenCliente',
      cabecalhos: { 'Idempotency-Key': '{{chavePedido}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 2 }, { produtoId: '#produtoRefriId', quantidade: 1 }]),
      testes: js(
        status(201),
        "pm.test('replay marcado no cabecalho', () => pm.expect(pm.response.headers.get('Idempotent-Replayed')).to.eql('true'));",
        "pm.test('mesmo pedido, nada duplicado', () => pm.expect(pm.response.json().id).to.eql(Number(pm.collectionVariables.get('pedidoId'))));",
      ),
    }),
    requisicao('Mesma chave com outro corpo (409)', 'POST', '/pedidos', {
      token: 'tokenCliente',
      cabecalhos: { 'Idempotency-Key': '{{chavePedido}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1 }]),
      testes: erro(409, 'IDEMPOTENCY_KEY_REUTILIZADA'),
    }),
    requisicao('Cliente tenta mandar o preco (422)', 'POST', '/pedidos', {
      token: 'tokenCliente',
      antes: [novaChave('chaveTemp')],
      cabecalhos: { 'Idempotency-Key': '{{chaveTemp}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1, precoCentavos: 1 }]),
      testes: erro(422, 'VALIDACAO'),
    }),
    requisicao('Detalhar pedido', 'GET', '/pedidos/{{pedidoId}}', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('itens com preco historico', () => pm.expect(pm.response.json().itens[0]).to.have.property('precoUnitarioCentavos'));"),
    }),
    requisicao('Listar pedidos com filtros', 'GET', '/pedidos?canalPedido=APP&status=AGUARDANDO_PAGAMENTO&limit=10', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('filtro aplicado', () => pm.expect(pm.response.json().dados.every((p) => p.canalPedido === 'APP' && p.status === 'AGUARDANDO_PAGAMENTO')).to.be.true);"),
    }),
    requisicao('Atendente cria pedido de balcao', 'POST', '/pedidos', {
      token: 'tokenAtendenteCentro',
      antes: [novaChave('chaveTemp')],
      cabecalhos: { 'Idempotency-Key': '{{chaveTemp}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoRefriId', quantidade: 2 }], { canalPedido: 'BALCAO' }),
      testes: js(status(201), "pm.test('pedido anonimo', () => pm.expect(pm.response.json().clienteId).to.eql(null));", salvar('pedidoBalcaoId', 'pm.response.json().id')),
    }),
    requisicao('Cancelar pedido de balcao', 'POST', '/pedidos/{{pedidoBalcaoId}}/cancelamentos', {
      token: 'tokenAtendenteCentro', corpo: { motivo: 'Cliente desistiu' },
      testes: js(status(200), "pm.test('cancelado e reserva liberada', () => { const b = pm.response.json(); pm.expect(b.status).to.eql('CANCELADO'); pm.expect(b.reservaEstoque).to.eql('LIBERADA'); });"),
    }),
    requisicao('Cancelar de novo (409)', 'POST', '/pedidos/{{pedidoBalcaoId}}/cancelamentos', {
      token: 'tokenAtendenteCentro', corpo: {}, testes: erro(409, 'PEDIDO_JA_CANCELADO'),
    }),
  ],
};

const pagarPedido = (nome, pedidoVar, chaveVar, cenario, testes, { gerarChave = true, token = 'tokenCliente' } = {}) => requisicao(nome, 'POST', `/pedidos/{{${pedidoVar}}}/pagamentos`, {
  token,
  antes: gerarChave ? [novaChave(chaveVar)] : [],
  cabecalhos: { 'Idempotency-Key': `{{${chaveVar}}}`, ...(cenario ? { 'X-Mock-Cenario': cenario } : {}) },
  testes,
});

const criarPedidoCliente = (nome, variavel, extra) => requisicao(nome, 'POST', '/pedidos', {
  token: 'tokenCliente',
  antes: [novaChave('chaveTemp')],
  cabecalhos: { 'Idempotency-Key': '{{chaveTemp}}' },
  corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1 }], extra),
  testes: js(status(201), salvar(variavel, 'pm.response.json().id')),
});

const pagamento = {
  name: 'Payment',
  item: [
    pagarPedido('Pagar pedido (aprovado)', 'pedidoId', 'chavePagamento', 'APROVAR', js(
      status(201),
      'const b = pm.response.json();',
      "pm.test('aprovado e pedido em preparo', () => { pm.expect(b.pagamento.status).to.eql('APROVADO'); pm.expect(b.pedido.status).to.eql('EM_PREPARO'); pm.expect(b.pedido.reservaEstoque).to.eql('CONSUMIDA'); });",
      "pm.test('valor vem do pedido', () => pm.expect(b.pagamento.valorCentavos).to.eql(Number(pm.collectionVariables.get('totalPedido'))));",
      salvar('pagamentoId', 'b.pagamento.id'),
    )),
    pagarPedido('Repetir pagamento com a mesma chave', 'pedidoId', 'chavePagamento', 'APROVAR', js(
      status(201),
      "pm.test('replay, sem nova cobranca', () => { pm.expect(pm.response.headers.get('Idempotent-Replayed')).to.eql('true'); pm.expect(pm.response.json().pagamento.id).to.eql(Number(pm.collectionVariables.get('pagamentoId'))); });",
    ), { gerarChave: false }),
    pagarPedido('Pagar de novo com outra chave (409)', 'pedidoId', 'chaveTemp', 'APROVAR', erro(409, 'PEDIDO_JA_PAGO')),
    requisicao('Consultar pagamento', 'GET', '/pagamentos/{{pagamentoId}}', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('tentativa registrada', () => pm.expect(pm.response.json().tentativas.length).to.eql(1));"),
    }),
    requisicao('Pagamentos do pedido', 'GET', '/pedidos/{{pedidoId}}/pagamentos', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('um pagamento so', () => pm.expect(pm.response.json().dados.length).to.eql(1));"),
    }),
    criarPedidoCliente('Criar pedido para recusa', 'pedidoRecusaId'),
    pagarPedido('Pagar pedido (recusado)', 'pedidoRecusaId', 'chaveTemp', 'RECUSAR', js(
      status(201),
      "pm.test('recusado cancela o pedido e libera o estoque', () => { const b = pm.response.json(); pm.expect(b.pagamento.status).to.eql('RECUSADO'); pm.expect(b.pedido.status).to.eql('CANCELADO'); pm.expect(b.pedido.reservaEstoque).to.eql('LIBERADA'); });",
    )),
    criarPedidoCliente('Criar pedido para timeout', 'pedidoTimeoutId'),
    pagarPedido('Pagar pedido (timeout do gateway)', 'pedidoTimeoutId', 'chaveTimeout', 'TIMEOUT', js(
      status(202),
      "pm.test('indefinido, pedido continua aguardando', () => { const b = pm.response.json(); pm.expect(b.pagamento.status).to.eql('INDEFINIDO'); pm.expect(b.pedido.status).to.eql('AGUARDANDO_PAGAMENTO'); });",
    )),
    pagarPedido('Retry do timeout com a mesma chave (202)', 'pedidoTimeoutId', 'chaveTimeout', 'TIMEOUT', js(
      status(202),
      "pm.test('replay sem chamar o gateway de novo', () => pm.expect(pm.response.headers.get('Idempotent-Replayed')).to.eql('true'));",
    ), { gerarChave: false }),
    pagarPedido('Nova cobranca com pagamento indefinido (409)', 'pedidoTimeoutId', 'chaveTemp', 'APROVAR', erro(409, 'PAGAMENTO_INDEFINIDO')),
    pagarPedido('Cenario de mock invalido (422)', 'pedidoTimeoutId', 'chaveTemp', 'QUALQUER', erro(422, 'CENARIO_MOCK_INVALIDO')),
  ],
};

const fidelidade = {
  name: 'Loyalty',
  item: [
    requisicao('Saldo sem consentimento', 'GET', '/fidelidade/saldo', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('sem consentimento e sem pontos', () => { const b = pm.response.json(); pm.expect(b.consentimento.ativo).to.be.false; pm.expect(b.saldoPontos).to.eql(0); });"),
    }),
    requisicao('Conceder consentimento', 'PUT', '/fidelidade/consentimento', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('ativo', () => pm.expect(pm.response.json().ativo).to.be.true);"),
    }),
    requisicao('Cozinha marca PRONTO', 'PATCH', '/pedidos/{{pedidoId}}/status', {
      token: 'tokenCozinhaCentro', corpo: { status: 'PRONTO' },
      testes: js(status(200), "pm.test('pronto', () => pm.expect(pm.response.json().status).to.eql('PRONTO'));"),
    }),
    requisicao('Cozinha nao entrega (403)', 'PATCH', '/pedidos/{{pedidoId}}/status', {
      token: 'tokenCozinhaCentro', corpo: { status: 'ENTREGUE' }, testes: erro(403, 'ACESSO_NEGADO'),
    }),
    requisicao('Atendente marca ENTREGUE', 'PATCH', '/pedidos/{{pedidoId}}/status', {
      token: 'tokenAtendenteCentro', corpo: { status: 'ENTREGUE' },
      testes: js(status(200), "pm.test('entregue', () => pm.expect(pm.response.json().status).to.eql('ENTREGUE'));"),
    }),
    requisicao('Saldo depois da entrega', 'GET', '/fidelidade/saldo', {
      token: 'tokenCliente',
      testes: js(
        status(200),
        "const pontos = Math.floor(Number(pm.collectionVariables.get('totalPedido')) / 100);",
        "pm.test('1 ponto por real inteiro', () => pm.expect(pm.response.json().saldoPontos).to.eql(pontos));",
        salvar('pontosCliente', 'pm.response.json().saldoPontos'),
      ),
    }),
    requisicao('Entregar de novo (409, sem credito duplicado)', 'PATCH', '/pedidos/{{pedidoId}}/status', {
      token: 'tokenAtendenteCentro', corpo: { status: 'ENTREGUE' }, testes: erro(409, 'TRANSICAO_INVALIDA'),
    }),
    requisicao('Historico de pontos', 'GET', '/fidelidade/historico', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('um credito so para o pedido', () => { const d = pm.response.json().dados; pm.expect(d.filter((l) => l.tipo === 'CREDITO' && l.pedidoId === Number(pm.collectionVariables.get('pedidoId'))).length).to.eql(1); });"),
    }),
    requisicao('Resgate fora do multiplo de 10 (422)', 'POST', '/pedidos', {
      token: 'tokenCliente',
      antes: [novaChave('chaveTemp')],
      cabecalhos: { 'Idempotency-Key': '{{chaveTemp}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1 }], { pontosResgatar: 15 }),
      testes: erro(422, 'VALIDACAO'),
    }),
    requisicao('Pedido com resgate de 50 pontos', 'POST', '/pedidos', {
      token: 'tokenCliente',
      antes: [novaChave('chaveTemp')],
      cabecalhos: { 'Idempotency-Key': '{{chaveTemp}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1 }], { pontosResgatar: 50 }),
      testes: js(
        status(201),
        'const b = pm.response.json();',
        "pm.test('R$ 5,00 de desconto e pontos reservados', () => { pm.expect(b.descontoCentavos).to.eql(500); pm.expect(b.totalCentavos).to.eql(b.subtotalCentavos - 500); pm.expect(b.resgateStatus).to.eql('RESERVADO'); });",
        salvar('pedidoResgateId', 'b.id'),
      ),
    }),
    requisicao('Saldo com pontos reservados', 'GET', '/fidelidade/saldo', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('50 pontos debitados', () => pm.expect(pm.response.json().saldoPontos).to.eql(Number(pm.collectionVariables.get('pontosCliente')) - 50));"),
    }),
    requisicao('Cancelar pedido com resgate', 'POST', '/pedidos/{{pedidoResgateId}}/cancelamentos', {
      token: 'tokenCliente', corpo: {},
      testes: js(status(200), "pm.test('pontos liberados', () => pm.expect(pm.response.json().resgateStatus).to.eql('LIBERADO'));"),
    }),
    requisicao('Saldo depois do cancelamento', 'GET', '/fidelidade/saldo', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('pontos devolvidos', () => pm.expect(pm.response.json().saldoPontos).to.eql(Number(pm.collectionVariables.get('pontosCliente'))));"),
    }),
    requisicao('Revogar consentimento', 'DELETE', '/fidelidade/consentimento', {
      token: 'tokenCliente',
      testes: js(status(200), "pm.test('inativo', () => pm.expect(pm.response.json().ativo).to.be.false);"),
    }),
    requisicao('Resgate sem consentimento (409)', 'POST', '/pedidos', {
      token: 'tokenCliente',
      antes: [novaChave('chaveTemp')],
      cabecalhos: { 'Idempotency-Key': '{{chaveTemp}}' },
      corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1 }], { pontosResgatar: 10 }),
      testes: erro(409, 'CONSENTIMENTO_FIDELIDADE_AUSENTE'),
    }),
    requisicao('Funcionario nao participa (403)', 'GET', '/fidelidade/saldo', { token: 'tokenAtendenteCentro', testes: erro(403, 'ACESSO_NEGADO') }),
  ],
};

// dispara as tentativas erradas antes da requisicao principal, uma depois da outra
const tentativasErradas = js(
  "const email = 'bloqueio-' + pm.variables.replaceIn('{{$guid}}').slice(0, 8) + '@teste.local';",
  "pm.collectionVariables.set('emailBloqueio', email);",
  "const total = Number(pm.environment.get('loginMaxTentativas') || 5);",
  'const tentar = (n) => {',
  '  if (n >= total) return;',
  "  pm.sendRequest({ url: pm.variables.replaceIn('{{baseUrl}}') + '/auth/login', method: 'POST', header: { 'Content-Type': 'application/json' },",
  "    body: { mode: 'raw', raw: JSON.stringify({ email, senha: 'Errada@123' }) } }, () => tentar(n + 1));",
  '};',
  'tentar(0);',
);

const errosAuditoria = {
  name: 'Errors/Audit',
  item: [
    requisicao('Sem token (401)', 'GET', '/usuarios/me', { testes: erro(401, 'NAO_AUTENTICADO') }),
    requisicao('Token invalido (401)', 'GET', '/usuarios/me', {
      cabecalhos: { Authorization: 'Bearer token.invalido.aqui' }, testes: erro(401, 'NAO_AUTENTICADO'),
    }),
    requisicao('JSON malformado (400)', 'POST', '/auth/login', { corpoBruto: '{"email": "a@b.c", ', testes: erro(400, 'JSON_MALFORMADO') }),
    requisicao('Rota inexistente (404)', 'GET', '/rota-que-nao-existe', { testes: erro(404, 'ROTA_NAO_ENCONTRADA') }),
    requisicao('Pedido inexistente (404)', 'GET', '/pedidos/999999', { token: 'tokenAdmin', testes: erro(404, 'PEDIDO_NAO_ENCONTRADO') }),
    requisicao('Pedido sem Idempotency-Key (422)', 'POST', '/pedidos', {
      token: 'tokenCliente', corpo: pedidoCentro([{ produtoId: '#produtoXBurgerId', quantidade: 1 }]),
      testes: js(erro(422, 'IDEMPOTENCY_KEY_INVALIDA'), "pm.test('campo do cabecalho', () => pm.expect(pm.response.json().details[0].field).to.eql('Idempotency-Key'));"),
    }),
    requisicao('Limit acima de 100 (422)', 'GET', '/pedidos?limit=101', { token: 'tokenCliente', testes: erro(422, 'VALIDACAO') }),
    requisicao('Gerente de outra unidade nao ve o pedido (403)', 'GET', '/pedidos/{{pedidoId}}', { token: 'tokenGerenteShopping', testes: erro(403, 'ACESSO_NEGADO') }),
    requisicao('Cliente nao acessa auditoria (403)', 'GET', '/auditorias', { token: 'tokenCliente', testes: erro(403, 'ACESSO_NEGADO') }),
    requisicao('Muitas tentativas de login (429)', 'POST', '/auth/login', {
      antes: tentativasErradas,
      corpo: { email: '{{emailBloqueio}}', senha: 'Errada@123' },
      testes: js(erro(429, 'MUITAS_TENTATIVAS'), "pm.test('Retry-After', () => pm.expect(Number(pm.response.headers.get('Retry-After'))).to.be.above(0));"),
    }),
    requisicao('Auditoria do pagamento aprovado', 'GET', '/auditorias?acao=PAGAMENTO_APROVADO&recursoId={{pagamentoId}}', {
      token: 'tokenAdmin',
      testes: js(status(200), "pm.test('evento registrado uma vez', () => pm.expect(pm.response.json().dados.length).to.eql(1));"),
    }),
    requisicao('Auditoria do pedido (gerente da unidade)', 'GET', '/auditorias?recursoTipo=PEDIDO&recursoId={{pedidoId}}&limit=50', {
      token: 'tokenGerenteCentro',
      testes: js(
        status(200),
        'const acoes = pm.response.json().dados.map((a) => a.acao);',
        "pm.test('criacao, mudancas de status e credito', () => pm.expect(acoes).to.include.members(['PEDIDO_CRIADO', 'PEDIDO_STATUS_ALTERADO', 'FIDELIDADE_CREDITO']));",
        "pm.test('acesso negado tambem fica registrado', () => pm.expect(acoes).to.include('PEDIDO_ACESSO_NEGADO'));",
      ),
    }),
    requisicao('Auditoria de logins que falharam', 'GET', '/auditorias?acao=LOGIN_FALHOU&limit=5', {
      token: 'tokenAdmin',
      testes: js(status(200), "pm.test('sem senha nos detalhes', () => pm.expect(JSON.stringify(pm.response.json())).to.not.include('Errada@123'));"),
    }),
  ],
};

const colecao = {
  info: {
    name: 'Rede de Restaurantes API',
    description: 'Fluxo completo da API (cadastro, cardapio, estoque, pedido, pagamento simulado, fidelidade, erros e auditoria). '
      + 'As pastas rodam em ordem e passam ids e tokens por variaveis da colecao. Gerada por scripts/gerar-colecao-postman.js.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  event: [{
    listen: 'test',
    script: {
      type: 'text/javascript',
      exec: [
        "pm.test('responde com X-Request-Id', () => pm.expect(pm.response.headers.has('X-Request-Id')).to.be.true);",
        "pm.test('nao expoe X-Powered-By', () => pm.expect(pm.response.headers.has('X-Powered-By')).to.be.false);",
      ],
    },
  }],
  variable: [{ key: 'senhaCliente', value: 'Senha@12345' }],
  item: [auth, unidades, estoque, pedidos, pagamento, fidelidade, errosAuditoria],
};

// sem token nem segredo: os tokens sao preenchidos durante a execucao
const ambiente = {
  name: 'Rede de Restaurantes - local',
  values: [
    ['baseUrl', 'http://localhost:3000'],
    ['senhaDemo', 'Demo@12345'],
    ['emailAdmin', 'admin@demo.local'],
    ['emailGerenteCentro', 'gerente.centro@demo.local'],
    ['emailGerenteShopping', 'gerente.shopping@demo.local'],
    ['emailAtendenteCentro', 'atendente.centro@demo.local'],
    ['emailCozinhaCentro', 'cozinha.centro@demo.local'],
    ['loginMaxTentativas', '5'],
  ].map(([key, value]) => ({ key, value, type: 'default', enabled: true })),
};

fs.mkdirSync(pasta, { recursive: true });
fs.writeFileSync(path.join(pasta, 'rede-restaurantes.postman_collection.json'), `${JSON.stringify(colecao, null, 2)}\n`);
fs.writeFileSync(path.join(pasta, 'rede-restaurantes.postman_environment.json'), `${JSON.stringify(ambiente, null, 2)}\n`);
const total = colecao.item.reduce((n, pastaItem) => n + pastaItem.item.length, 0);
console.log(`Colecao gerada em postman/ com ${colecao.item.length} pastas e ${total} requisicoes.`);
