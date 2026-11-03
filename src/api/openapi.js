import { CANAIS_PEDIDO, LIMITES_PEDIDO, STATUS_PEDIDO } from '../domain/pedido.js';
import { PAPEIS } from '../domain/papeis.js';

// especificacao openapi 3.1 da api. fica em codigo pra reaproveitar as
// constantes do dominio (canais, status, limites) e nao desatualizar.
// o teste test/integracao/openapi.test.js confere que toda rota do express esta aqui.

const ref = (nome) => ({ $ref: `#/components/schemas/${nome}` });
const json = (schema, exemplo) => ({ 'application/json': { schema, ...(exemplo ? { example: exemplo } : {}) } });
const ok = (descricao, schema, exemplo) => ({ description: descricao, content: json(schema, exemplo) });
const erro = (descricao, exemplo) => ({ description: descricao, content: json(ref('Erro'), exemplo) });
const paginado = (item) => ({
  type: 'object',
  required: ['dados', 'paginacao'],
  properties: { dados: { type: 'array', items: item }, paginacao: ref('Paginacao') },
});

const exemploErro = (error, message, details = [], caminho = '/pedidos') => ({
  error, message, details, timestamp: '2026-10-28T15:00:00.000Z', path: caminho, requestId: '6f1c2a9e-3b7d-4c51-9a0e-2d8f4b6c1e73',
});

const E = {
  400: erro('JSON malformado.', exemploErro('JSON_MALFORMADO', 'O corpo da requisicao nao e um JSON valido.')),
  401: erro('Token ausente, invalido ou expirado.', exemploErro('NAO_AUTENTICADO', 'Token de acesso ausente.')),
  403: erro('Papel ou unidade sem permissao.', exemploErro('ACESSO_NEGADO', 'Voce nao tem permissao para esta operacao.')),
  404: erro('Recurso nao encontrado.', exemploErro('PEDIDO_NAO_ENCONTRADO', 'Pedido nao encontrado.')),
  409: erro('Conflito com o estado atual.', exemploErro('TRANSICAO_INVALIDA', 'Transicao de EM_PREPARO para ENTREGUE nao permitida.', [{ field: 'status', issue: 'Proximo status valido: PRONTO' }])),
  413: erro('Corpo acima de 32 kB.', exemploErro('CORPO_MUITO_GRANDE', 'O corpo da requisicao excede o limite permitido.')),
  422: erro('Dados de entrada invalidos.', exemploErro('VALIDACAO', 'Dados de entrada invalidos.', [{ field: 'canalPedido', issue: 'Campo obrigatorio.' }])),
  429: erro('Muitas tentativas de login (ver Retry-After).', exemploErro('MUITAS_TENTATIVAS', 'Muitas tentativas de login. Tente novamente mais tarde.', [], '/auth/login')),
};
const erros = (...codigos) => Object.fromEntries(codigos.map((c) => [String(c), E[c]]));

const p = {
  id: { name: 'id', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
  produtoId: { name: 'produtoId', in: 'path', required: true, schema: { type: 'integer', minimum: 1 } },
  page: { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
  limit: { name: 'limit', in: 'query', description: 'Itens por pagina (maximo 100).', schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 } },
  idempotencia: {
    name: 'Idempotency-Key', in: 'header', required: true,
    description: 'Chave unica por tentativa logica (8 a 100 caracteres: letras, numeros, . _ : -). Repetir a mesma chave com o mesmo corpo devolve a resposta original com Idempotent-Replayed: true; com outro corpo retorna 409.',
    schema: { type: 'string', pattern: '^[A-Za-z0-9._:-]{8,100}$' }, example: 'pedido-2026-10-28-0001',
  },
  cenarioMock: {
    name: 'X-Mock-Cenario', in: 'header', required: false,
    description: 'Somente desenvolvimento e teste (MOCK_PAGAMENTO_PERMITIR_CENARIO=true). Em producao o cabecalho e rejeitado com 422.',
    schema: { type: 'string', enum: ['APROVAR', 'RECUSAR', 'TIMEOUT'] },
  },
};
const paginas = [p.page, p.limit];
const query = (name, schema, extras = {}) => ({ name, in: 'query', schema, ...extras });
const replay = { 'Idempotent-Replayed': { description: 'Presente com valor true quando a resposta veio de uma requisicao anterior com a mesma chave.', schema: { type: 'string', enum: ['true'] } } };
const seguro = [{ bearerAuth: [] }];
const publicoOuToken = [{}, { bearerAuth: [] }];

const schemas = {
  Erro: {
    type: 'object',
    required: ['error', 'message', 'details', 'timestamp', 'path', 'requestId'],
    properties: {
      error: { type: 'string', description: 'Codigo estavel do erro.' },
      message: { type: 'string' },
      details: { type: 'array', items: { type: 'object', required: ['field', 'issue'], properties: { field: { type: 'string' }, issue: { type: 'string' } } } },
      timestamp: { type: 'string', format: 'date-time' },
      path: { type: 'string' },
      requestId: { type: 'string', description: 'Tambem enviado no cabecalho X-Request-Id.' },
    },
  },
  Paginacao: {
    type: 'object',
    properties: { pagina: { type: 'integer' }, limite: { type: 'integer', maximum: 100 }, total: { type: 'integer' } },
  },
  Centavos: { type: 'integer', minimum: 0, description: 'Valor monetario em centavos de real (inteiro). 2590 = R$ 25,90.' },
  Usuario: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, nome: { type: 'string' }, email: { type: 'string', format: 'email' },
      papel: { type: 'string', enum: PAPEIS }, unidadeIds: { type: 'array', items: { type: 'integer' } },
      ativo: { type: 'boolean' }, criadoEm: { type: 'string', format: 'date-time' },
    },
  },
  Cadastro: {
    type: 'object', additionalProperties: false, required: ['nome', 'email', 'senha'],
    properties: { nome: { type: 'string', minLength: 2, maxLength: 100 }, email: { type: 'string', format: 'email' }, senha: { type: 'string', minLength: 8, maxLength: 72, writeOnly: true } },
  },
  Login: {
    type: 'object', additionalProperties: false, required: ['email', 'senha'],
    properties: { email: { type: 'string', format: 'email' }, senha: { type: 'string', writeOnly: true } },
  },
  Sessao: {
    type: 'object',
    properties: { accessToken: { type: 'string' }, tokenType: { type: 'string', enum: ['Bearer'] }, usuario: ref('Usuario') },
  },
  Unidade: {
    type: 'object',
    properties: { id: { type: 'integer' }, nome: { type: 'string' }, cidade: { type: 'string' }, ativa: { type: 'boolean' }, criadoEm: { type: 'string' }, atualizadoEm: { type: 'string' } },
  },
  UnidadeNova: {
    type: 'object', additionalProperties: false, required: ['nome', 'cidade'],
    properties: { nome: { type: 'string', minLength: 2, maxLength: 100 }, cidade: { type: 'string', minLength: 2, maxLength: 100 } },
  },
  UnidadeAlteracao: {
    type: 'object', additionalProperties: false, minProperties: 1,
    description: 'GERENTE altera nome/cidade das proprias unidades; so ADMIN ativa ou desativa.',
    properties: { nome: { type: 'string' }, cidade: { type: 'string' }, ativa: { type: 'boolean' } },
  },
  Produto: {
    type: 'object',
    properties: { id: { type: 'integer' }, nome: { type: 'string' }, descricao: { type: ['string', 'null'] }, categoria: { type: 'string' }, ativo: { type: 'boolean' }, criadoEm: { type: 'string' }, atualizadoEm: { type: 'string' } },
  },
  ProdutoNovo: {
    type: 'object', additionalProperties: false, required: ['nome', 'categoria'],
    properties: { nome: { type: 'string', minLength: 2, maxLength: 100 }, descricao: { type: 'string', maxLength: 500 }, categoria: { type: 'string', minLength: 2, maxLength: 50 } },
  },
  ProdutoAlteracao: {
    type: 'object', additionalProperties: false, minProperties: 1,
    description: 'Produto nao e apagado: desative com ativo=false.',
    properties: { nome: { type: 'string' }, descricao: { type: ['string', 'null'] }, categoria: { type: 'string' }, ativo: { type: 'boolean' } },
  },
  ItemCardapio: {
    type: 'object',
    properties: { produtoId: { type: 'integer' }, nome: { type: 'string' }, descricao: { type: ['string', 'null'] }, categoria: { type: 'string' }, precoCentavos: ref('Centavos'), disponivel: { type: 'boolean' }, atualizadoEm: { type: 'string' } },
  },
  ItemCardapioAlteracao: {
    type: 'object', additionalProperties: false, minProperties: 1,
    description: 'Para incluir um produto no cardapio da unidade, precoCentavos e obrigatorio.',
    properties: { precoCentavos: { type: 'integer', minimum: 1, maximum: 10000000 }, disponivel: { type: 'boolean' } },
  },
  Saldo: {
    type: 'object',
    properties: {
      unidadeId: { type: 'integer' }, produtoId: { type: 'integer' }, produtoNome: { type: 'string' },
      quantidadeTotal: { type: 'integer' }, quantidadeReservada: { type: 'integer' }, quantidadeDisponivel: { type: 'integer' }, atualizadoEm: { type: 'string' },
    },
  },
  Movimentacao: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, unidadeId: { type: 'integer' }, produtoId: { type: 'integer' },
      tipo: { type: 'string', enum: ['ENTRADA', 'AJUSTE', 'RESERVA', 'CONSUMO', 'LIBERACAO'] },
      quantidade: { type: 'integer' }, totalApos: { type: 'integer' }, reservadaApos: { type: 'integer' },
      pedidoId: { type: ['integer', 'null'] }, usuarioId: { type: ['integer', 'null'] }, motivo: { type: ['string', 'null'] }, criadoEm: { type: 'string' },
    },
  },
  MovimentacaoNova: {
    type: 'object', additionalProperties: false, required: ['unidadeId', 'produtoId', 'tipo', 'quantidade'],
    description: 'ENTRADA soma ao total (quantidade positiva). AJUSTE corrige o total (positivo ou negativo) e exige motivo. Nenhum dos dois deixa o total abaixo do reservado.',
    properties: {
      unidadeId: { type: 'integer' }, produtoId: { type: 'integer' }, tipo: { type: 'string', enum: ['ENTRADA', 'AJUSTE'] },
      quantidade: { type: 'integer', minimum: -100000, maximum: 100000, not: { const: 0 } }, motivo: { type: 'string', minLength: 3, maxLength: 200 },
    },
  },
  PedidoNovo: {
    type: 'object', additionalProperties: false, required: ['unidadeId', 'canalPedido', 'formaPagamento', 'itens'],
    description: 'Preco, subtotal, desconto, total e status sao calculados pelo servidor; envia-los no corpo retorna 422.',
    properties: {
      unidadeId: { type: 'integer' },
      canalPedido: { type: 'string', enum: CANAIS_PEDIDO, description: 'BALCAO e registrado por funcionario.' },
      formaPagamento: { type: 'string', enum: ['MOCK'] },
      clienteId: { type: 'integer', description: 'So para funcionario vincular um cliente. Cliente nunca informa: o id vem do token.' },
      pontosResgatar: { type: 'integer', minimum: 10, multipleOf: 10, description: 'Resgate de pontos pelo proprio cliente. 10 pontos = R$ 1,00; o desconto nao passa do subtotal.' },
      itens: {
        type: 'array', minItems: 1, maxItems: LIMITES_PEDIDO.maxLinhas,
        description: 'Cada produto aparece uma vez (produto repetido retorna 422).',
        items: {
          type: 'object', additionalProperties: false, required: ['produtoId', 'quantidade'],
          properties: { produtoId: { type: 'integer' }, quantidade: { type: 'integer', minimum: 1, maximum: LIMITES_PEDIDO.maxQuantidade } },
        },
      },
    },
  },
  Pedido: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, unidadeId: { type: 'integer' }, clienteId: { type: ['integer', 'null'] }, criadoPorId: { type: 'integer' },
      canalPedido: { type: 'string', enum: CANAIS_PEDIDO }, status: { type: 'string', enum: STATUS_PEDIDO }, formaPagamento: { type: 'string' },
      subtotalCentavos: ref('Centavos'), descontoCentavos: ref('Centavos'), totalCentavos: ref('Centavos'),
      reservaEstoque: { type: 'string', enum: ['ATIVA', 'CONSUMIDA', 'LIBERADA'] },
      motivoCancelamento: { type: ['string', 'null'] }, expiraEm: { type: 'string' }, criadoEm: { type: 'string' }, atualizadoEm: { type: 'string' },
      pagoEm: { type: ['string', 'null'] }, prontoEm: { type: ['string', 'null'] }, entregueEm: { type: ['string', 'null'] }, canceladoEm: { type: ['string', 'null'] },
      pontosResgatados: { type: 'integer' }, resgateStatus: { type: ['string', 'null'], enum: ['RESERVADO', 'CONFIRMADO', 'LIBERADO', null] },
      itens: {
        type: 'array',
        items: {
          type: 'object',
          properties: { produtoId: { type: 'integer' }, nomeProduto: { type: 'string' }, quantidade: { type: 'integer' }, precoUnitarioCentavos: ref('Centavos'), totalCentavos: ref('Centavos') },
        },
      },
    },
  },
  Pagamento: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, pedidoId: { type: 'integer' }, forma: { type: 'string', enum: ['MOCK'] }, valorCentavos: ref('Centavos'),
      status: {
        type: 'string', enum: ['PROCESSANDO', 'APROVADO', 'RECUSADO', 'INDEFINIDO', 'APROVADO_TARDIO'],
        description: 'INDEFINIDO: gateway nao respondeu no prazo; nao e aprovacao nem recusa. APROVADO_TARDIO: aprovado depois de o pedido ter sido cancelado; fica com estorno manual pendente.',
      },
      motivoRecusa: { type: ['string', 'null'] }, referenciaGateway: { type: 'string' }, codigoAutorizacao: { type: ['string', 'null'] },
      reconciliacao: { type: ['string', 'null'], enum: ['ESTORNO_MANUAL_PENDENTE', null] },
      criadoEm: { type: 'string' }, atualizadoEm: { type: 'string' }, finalizadoEm: { type: ['string', 'null'] },
      tentativas: {
        type: 'array', description: 'So no GET /pagamentos/{id}.',
        items: {
          type: 'object',
          properties: {
            id: { type: 'integer' }, operacao: { type: 'string', enum: ['AUTORIZACAO', 'CONSULTA'] }, resultado: { type: ['string', 'null'], enum: ['APROVADO', 'RECUSADO', 'TIMEOUT', 'ERRO', null] },
            payloadRequisicao: { type: 'object' }, payloadResposta: { type: ['object', 'null'] }, iniciadoEm: { type: 'string' }, finalizadoEm: { type: ['string', 'null'] },
          },
        },
      },
    },
  },
  ResultadoPagamento: { type: 'object', properties: { pagamento: ref('Pagamento'), pedido: ref('Pedido') } },
  Consentimento: {
    type: 'object',
    properties: { finalidade: { type: 'string', enum: ['PROGRAMA_FIDELIDADE'] }, ativo: { type: 'boolean' }, versaoTermo: { type: ['string', 'null'] }, atualizadoEm: { type: ['string', 'null'] } },
  },
  SaldoFidelidade: {
    type: 'object',
    properties: {
      saldoPontos: { type: 'integer' }, valorResgatavelCentavos: ref('Centavos'), consentimento: ref('Consentimento'),
      regra: { type: 'object', properties: { pontosPorReal: { type: 'integer' }, multiploResgate: { type: 'integer' }, centavosPorMultiplo: { type: 'integer' }, creditoQuando: { type: 'string' } } },
    },
  },
  Lancamento: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, tipo: { type: 'string', enum: ['CREDITO', 'RESGATE', 'ESTORNO_RESGATE', 'BAIXA_ANONIMIZACAO'] },
      pontos: { type: 'integer' }, saldoApos: { type: 'integer' }, pedidoId: { type: ['integer', 'null'] }, descricao: { type: 'string' }, criadoEm: { type: 'string' },
    },
  },
  Auditoria: {
    type: 'object',
    properties: {
      id: { type: 'integer' }, atorId: { type: ['integer', 'null'] }, atorPapel: { type: ['string', 'null'] }, acao: { type: 'string' },
      recursoTipo: { type: 'string' }, recursoId: { type: ['string', 'null'] }, unidadeId: { type: ['integer', 'null'] },
      resultado: { type: 'string', enum: ['SUCESSO', 'NEGADO', 'FALHA'] }, requestId: { type: 'string' }, detalhes: { type: ['object', 'null'] }, criadoEm: { type: 'string' },
    },
  },
};

const exemploPedido = {
  unidadeId: 1, canalPedido: 'APP', formaPagamento: 'MOCK',
  itens: [{ produtoId: 1, quantidade: 2 }, { produtoId: 4, quantidade: 1 }],
};

const paths = {
  '/health': {
    get: { tags: ['Sistema'], summary: 'Verifica se a API esta no ar', security: [], responses: { 200: ok('API no ar.', { type: 'object', properties: { status: { type: 'string' } } }, { status: 'ok' }) } },
  },
  '/usuarios': {
    post: {
      tags: ['Autenticacao'], summary: 'Cadastro publico de cliente', security: [],
      description: 'O papel e sempre CLIENTE. Campos como papel ou unidadeIds sao rejeitados.',
      requestBody: { required: true, content: json(ref('Cadastro'), { nome: 'Carla Souza', email: 'carla@exemplo.com', senha: 'Senha@12345' }) },
      responses: { 201: ok('Cliente criado.', ref('Usuario')), ...erros(400, 422), 409: erro('E-mail ja cadastrado.', exemploErro('EMAIL_JA_CADASTRADO', 'Ja existe uma conta com este e-mail.', [{ field: 'email', issue: 'E-mail ja cadastrado.' }], '/usuarios')) },
    },
  },
  '/auth/login': {
    post: {
      tags: ['Autenticacao'], summary: 'Login com e-mail e senha', security: [],
      description: 'Retorna um JWT (Bearer). A mensagem de erro nao diz se o e-mail existe. Apos varias falhas por IP + e-mail, responde 429 com Retry-After.',
      requestBody: { required: true, content: json(ref('Login'), { email: 'cliente.ana@demo.local', senha: 'Demo@12345' }) },
      responses: { 200: ok('Autenticado.', ref('Sessao')), ...erros(400, 401, 422, 429) },
    },
  },
  '/usuarios/me': {
    get: { tags: ['Autenticacao'], summary: 'Dados do usuario autenticado', security: seguro, responses: { 200: ok('Perfil.', ref('Usuario')), ...erros(401) } },
  },
  '/unidades': {
    get: {
      tags: ['Unidades e cardapio'], summary: 'Lista unidades', security: publicoOuToken,
      description: 'Publico ve so unidades ativas. ADMIN pode filtrar por ativa=false.',
      parameters: [...paginas, query('ativa', { type: 'string', enum: ['true', 'false'] })],
      responses: { 200: ok('Unidades.', paginado(ref('Unidade'))), ...erros(401, 422) },
    },
    post: {
      tags: ['Unidades e cardapio'], summary: 'Cria unidade (ADMIN)', security: seguro,
      requestBody: { required: true, content: json(ref('UnidadeNova'), { nome: 'Unidade Aeroporto', cidade: 'Curitiba' }) },
      responses: { 201: ok('Unidade criada.', ref('Unidade')), ...erros(401, 403, 409, 422) },
    },
  },
  '/unidades/{id}': {
    patch: {
      tags: ['Unidades e cardapio'], summary: 'Altera unidade (ADMIN; GERENTE nas proprias unidades)', security: seguro, parameters: [p.id],
      requestBody: { required: true, content: json(ref('UnidadeAlteracao')) },
      responses: { 200: ok('Unidade alterada.', ref('Unidade')), ...erros(401, 403, 404, 409, 422) },
    },
  },
  '/unidades/{id}/cardapio': {
    get: {
      tags: ['Unidades e cardapio'], summary: 'Cardapio da unidade com precos', security: publicoOuToken,
      description: 'O preco e por unidade. incluirIndisponiveis so vale para ADMIN ou GERENTE da unidade.',
      parameters: [p.id, ...paginas, query('incluirIndisponiveis', { type: 'string', enum: ['true', 'false'] })],
      responses: {
        200: ok('Cardapio.', { type: 'object', properties: { unidade: ref('Unidade'), dados: { type: 'array', items: ref('ItemCardapio') }, paginacao: ref('Paginacao') } }),
        ...erros(401, 404, 422),
      },
    },
  },
  '/unidades/{id}/cardapio/{produtoId}': {
    put: {
      tags: ['Unidades e cardapio'], summary: 'Inclui ou altera produto no cardapio da unidade (ADMIN; GERENTE da unidade)', security: seguro,
      parameters: [p.id, p.produtoId],
      requestBody: { required: true, content: json(ref('ItemCardapioAlteracao'), { precoCentavos: 2690, disponivel: true }) },
      responses: { 200: ok('Item do cardapio.', ref('ItemCardapio')), ...erros(401, 403, 404, 422) },
    },
  },
  '/produtos': {
    get: {
      tags: ['Unidades e cardapio'], summary: 'Catalogo da rede', security: publicoOuToken,
      parameters: [...paginas, query('ativo', { type: 'string', enum: ['true', 'false'] }), query('categoria', { type: 'string' })],
      responses: { 200: ok('Produtos.', paginado(ref('Produto'))), ...erros(401, 422) },
    },
    post: {
      tags: ['Unidades e cardapio'], summary: 'Cria produto (ADMIN)', security: seguro,
      requestBody: { required: true, content: json(ref('ProdutoNovo'), { nome: 'Wrap de Frango', categoria: 'LANCHE' }) },
      responses: { 201: ok('Produto criado.', ref('Produto')), ...erros(401, 403, 409, 422) },
    },
  },
  '/produtos/{id}': {
    patch: {
      tags: ['Unidades e cardapio'], summary: 'Altera ou desativa produto (ADMIN)', security: seguro, parameters: [p.id],
      requestBody: { required: true, content: json(ref('ProdutoAlteracao'), { ativo: false }) },
      responses: { 200: ok('Produto alterado.', ref('Produto')), ...erros(401, 403, 404, 409, 422) },
    },
  },
  '/estoque': {
    get: {
      tags: ['Estoque'], summary: 'Saldos de estoque da unidade (funcionarios da unidade)', security: seguro,
      parameters: [query('unidadeId', { type: 'integer' }, { required: true }), query('produtoId', { type: 'integer' }), ...paginas],
      responses: { 200: ok('Saldos.', paginado(ref('Saldo'))), ...erros(401, 403, 404, 422) },
    },
  },
  '/estoque/movimentacoes': {
    get: {
      tags: ['Estoque'], summary: 'Historico de movimentacoes (ADMIN; GERENTE da unidade)', security: seguro,
      parameters: [
        query('unidadeId', { type: 'integer' }, { required: true }), query('produtoId', { type: 'integer' }),
        query('tipo', { type: 'string', enum: ['ENTRADA', 'AJUSTE', 'RESERVA', 'CONSUMO', 'LIBERACAO'] }), ...paginas,
      ],
      responses: { 200: ok('Movimentacoes.', paginado(ref('Movimentacao'))), ...erros(401, 403, 404, 422) },
    },
    post: {
      tags: ['Estoque'], summary: 'Registra entrada ou ajuste manual (ADMIN; GERENTE da unidade)', security: seguro,
      description: 'Reserva, consumo e liberacao nao sao manuais: vem do fluxo de pedido e pagamento.',
      requestBody: { required: true, content: json(ref('MovimentacaoNova'), { unidadeId: 1, produtoId: 3, tipo: 'ENTRADA', quantidade: 20, motivo: 'Nota fiscal 1234' }) },
      responses: {
        201: ok('Movimentacao registrada.', { type: 'object', properties: { movimentacao: ref('Movimentacao'), saldo: ref('Saldo') } }),
        ...erros(401, 403, 404, 422),
        409: erro('O ajuste deixaria o total abaixo do reservado.', exemploErro('ESTOQUE_INSUFICIENTE', 'Estoque insuficiente.', [], '/estoque/movimentacoes')),
      },
    },
  },
  '/pedidos': {
    post: {
      tags: ['Pedidos'], summary: 'Cria pedido e reserva estoque', security: seguro, parameters: [p.idempotencia],
      description: 'Precos vem do cardapio da unidade. O pedido nasce AGUARDANDO_PAGAMENTO, reserva o estoque e expira se nao for pago no prazo (PEDIDO_EXPIRACAO_MINUTOS).',
      requestBody: { required: true, content: json(ref('PedidoNovo'), exemploPedido) },
      responses: {
        201: { description: 'Pedido criado (ou repeticao com a mesma chave).', headers: replay, content: json(ref('Pedido')) },
        ...erros(400, 401, 403, 404, 413, 422),
        409: erro('Estoque insuficiente, produto indisponivel, unidade inativa, saldo de pontos insuficiente ou chave reutilizada.', exemploErro('ESTOQUE_INSUFICIENTE', 'Estoque insuficiente.', [{ field: 'itens[0].quantidade', issue: 'Disponivel: 1' }])),
      },
    },
    get: {
      tags: ['Pedidos'], summary: 'Lista pedidos com filtros', security: seguro,
      description: 'CLIENTE ve os proprios; funcionario ve os das suas unidades; ADMIN ve todos.',
      parameters: [
        ...paginas, query('unidadeId', { type: 'integer' }), query('status', { type: 'string', enum: STATUS_PEDIDO }),
        query('canalPedido', { type: 'string', enum: CANAIS_PEDIDO }),
      ],
      responses: { 200: ok('Pedidos.', paginado(ref('Pedido'))), ...erros(401, 403, 422) },
    },
  },
  '/pedidos/{id}': {
    get: { tags: ['Pedidos'], summary: 'Detalha pedido', security: seguro, parameters: [p.id], responses: { 200: ok('Pedido.', ref('Pedido')), ...erros(401, 403, 404, 422) } },
  },
  '/pedidos/{id}/status': {
    patch: {
      tags: ['Pedidos'], summary: 'Avanca o preparo: EM_PREPARO -> PRONTO (cozinha) -> ENTREGUE (atendente)', security: seguro, parameters: [p.id],
      description: 'GERENTE e ADMIN podem fazer as duas etapas. Pular etapa, voltar ou repetir retorna 409. Na entrega o cliente com consentimento ganha os pontos (uma vez por pedido).',
      requestBody: { required: true, content: json({ type: 'object', additionalProperties: false, required: ['status'], properties: { status: { type: 'string', enum: ['PRONTO', 'ENTREGUE'] } } }, { status: 'PRONTO' }) },
      responses: { 200: ok('Pedido atualizado.', ref('Pedido')), ...erros(401, 403, 404, 409, 422) },
    },
  },
  '/pedidos/{id}/cancelamentos': {
    post: {
      tags: ['Pedidos'], summary: 'Cancela pedido ainda nao pago', security: seguro, parameters: [p.id],
      description: 'Devolve a reserva de estoque e os pontos resgatados. Pedido pago nao e cancelado por aqui (estorno fora do escopo do MVP). COZINHA nao cancela.',
      requestBody: { required: false, content: json({ type: 'object', additionalProperties: false, properties: { motivo: { type: 'string', minLength: 3, maxLength: 200 } } }, { motivo: 'Cliente desistiu' }) },
      responses: { 200: ok('Pedido cancelado.', ref('Pedido')), ...erros(401, 403, 404, 422), 409: erro('Ja cancelado, ja pago ou pagamento em processamento.', exemploErro('CANCELAMENTO_APOS_PAGAMENTO', 'Pedido com pagamento confirmado nao pode ser cancelado por aqui.')) },
    },
  },
  '/pedidos/{id}/pagamentos': {
    post: {
      tags: ['Pagamento'], summary: 'Paga o pedido no gateway simulado', security: seguro, parameters: [p.id, p.idempotencia, p.cenarioMock],
      description: [
        'O valor e o total do pedido no servidor; o corpo e vazio. Status de resposta:',
        '- 201 APROVADO: pedido vai para EM_PREPARO e o estoque reservado e consumido.',
        '- 201 RECUSADO: motivo gravado, pedido cancelado, estoque e pontos devolvidos.',
        '- 202 INDEFINIDO: o gateway nao respondeu no prazo. Nao e aprovacao nem recusa; nova cobranca fica bloqueada ate a reconciliacao (npm run pagamentos:reconciliar).',
        'Repetir com a mesma Idempotency-Key devolve o mesmo pagamento sem cobrar de novo.',
      ].join('\n'),
      requestBody: { required: false, content: json({ type: 'object', additionalProperties: false, maxProperties: 0 }) },
      responses: {
        201: { description: 'Pagamento finalizado (APROVADO, RECUSADO ou APROVADO_TARDIO).', headers: replay, content: json(ref('ResultadoPagamento')) },
        202: { description: 'Pagamento INDEFINIDO (timeout do gateway), aguardando reconciliacao.', headers: replay, content: json(ref('ResultadoPagamento')) },
        ...erros(401, 403, 404, 422),
        409: erro('Pedido ja pago, cancelado, pagamento em andamento/indefinido ou chave reutilizada.', exemploErro('PEDIDO_JA_PAGO', 'O pedido ja tem pagamento confirmado.', [], '/pedidos/1/pagamentos')),
      },
    },
    get: {
      tags: ['Pagamento'], summary: 'Pagamentos do pedido', security: seguro, parameters: [p.id],
      responses: { 200: ok('Pagamentos.', { type: 'object', properties: { dados: { type: 'array', items: ref('Pagamento') } } }), ...erros(401, 403, 404, 422) },
    },
  },
  '/pagamentos/{id}': {
    get: {
      tags: ['Pagamento'], summary: 'Detalha pagamento com as tentativas no gateway', security: seguro, parameters: [p.id],
      responses: { 200: ok('Pagamento.', ref('Pagamento')), ...erros(401, 403, 404, 422) },
    },
  },
  '/fidelidade/saldo': {
    get: { tags: ['Fidelidade'], summary: 'Saldo de pontos e estado do consentimento (CLIENTE)', security: seguro, responses: { 200: ok('Saldo.', ref('SaldoFidelidade')), ...erros(401, 403) } },
  },
  '/fidelidade/historico': {
    get: { tags: ['Fidelidade'], summary: 'Extrato de pontos (CLIENTE)', security: seguro, parameters: paginas, responses: { 200: ok('Extrato.', paginado(ref('Lancamento'))), ...erros(401, 403, 422) } },
  },
  '/fidelidade/consentimento': {
    put: {
      tags: ['Fidelidade'], summary: 'Aceita o termo do programa de fidelidade (CLIENTE)', security: seguro,
      description: 'Idempotente. O historico de consentimentos e so de insercao.',
      responses: { 200: ok('Consentimento atual.', ref('Consentimento')), ...erros(401, 403) },
    },
    delete: {
      tags: ['Fidelidade'], summary: 'Revoga o consentimento (CLIENTE)', security: seguro,
      description: 'Idempotente. Sem consentimento o cliente nao ganha nem resgata pontos; o saldo fica congelado.',
      responses: { 200: ok('Consentimento atual.', ref('Consentimento')), ...erros(401, 403) },
    },
  },
  '/auditorias': {
    get: {
      tags: ['Auditoria'], summary: 'Consulta trilha de auditoria (ADMIN; GERENTE so das suas unidades)', security: seguro,
      parameters: [
        ...paginas, query('unidadeId', { type: 'integer' }), query('acao', { type: 'string', pattern: '^[A-Z_]{3,60}$' }),
        query('recursoTipo', { type: 'string' }), query('recursoId', { type: 'string' }), query('requestId', { type: 'string' }),
      ],
      responses: { 200: ok('Registros.', paginado(ref('Auditoria'))), ...erros(401, 403, 422) },
    },
  },
};

export function especificacaoOpenApi() {
  return {
    openapi: '3.1.0',
    info: {
      title: 'API da rede de restaurantes',
      version: '1.0.0',
      description: [
        'MVP academico: matriz e unidades, cardapio com preco por unidade, estoque por unidade, pedidos multicanal, pagamento simulado, fidelidade e auditoria.',
        '',
        'Valores monetarios sao inteiros em centavos. Toda resposta de erro usa o mesmo envelope (schema Erro). Listas aceitam page e limit (maximo 100).',
        'O pagamento e um gateway simulado (MOCK): nenhum dado de cartao e recebido ou guardado.',
      ].join('\n'),
    },
    servers: [{ url: 'http://localhost:3000', description: 'Local' }],
    tags: [
      { name: 'Sistema' }, { name: 'Autenticacao' }, { name: 'Unidades e cardapio' }, { name: 'Estoque' },
      { name: 'Pedidos' }, { name: 'Pagamento' }, { name: 'Fidelidade' }, { name: 'Auditoria' },
    ],
    security: seguro,
    components: {
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', description: 'Token de POST /auth/login.' } },
      schemas,
    },
    paths,
  };
}
