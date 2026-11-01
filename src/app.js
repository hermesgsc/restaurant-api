import express from 'express';
import { abrirBanco, migrar } from './infrastructure/banco.js';
import { criarServicoSenhas } from './infrastructure/seguranca/senhas.js';
import { criarServicoTokens } from './infrastructure/seguranca/tokens.js';
import { criarLimitadorLogin } from './infrastructure/seguranca/limitador-login.js';
import { criarAuditoria } from './application/auditoria.js';
import { criarServicoUsuarios } from './application/usuarios.js';
import { criarServicoUnidades } from './application/unidades.js';
import { criarServicoProdutos } from './application/produtos.js';
import { criarServicoCardapio } from './application/cardapio.js';
import { criarServicoEstoque } from './application/estoque.js';
import { criarServicoIdempotencia } from './application/idempotencia.js';
import { criarServicoPedidos } from './application/pedidos.js';
import { criarCicloPedido } from './application/ciclo-pedido.js';
import { criarServicoFidelidade } from './application/fidelidade.js';
import { criarServicoPagamentos } from './application/pagamentos.js';
import { criarGatewayMock } from './infrastructure/pagamento/gateway-mock.js';
import { autenticar } from './api/middlewares/autenticacao.js';
import { cabecalhosSeguranca, cors, criarLogger, logRequisicoes, requestId, rotaNaoEncontrada } from './api/middlewares/basicos.js';
import { tratadorErros } from './api/http-erros.js';
import { rotasIdentidade } from './api/rotas/identidade.js';
import { rotasCatalogo } from './api/rotas/catalogo.js';
import { rotasAuditorias } from './api/rotas/auditorias.js';
import { rotasEstoque } from './api/rotas/estoque.js';
import { rotasPedidos } from './api/rotas/pedidos.js';
import { rotasPagamentos } from './api/rotas/pagamentos.js';
import { rotasFidelidade } from './api/rotas/fidelidade.js';

// monta os servicos da aplicacao em cima de um banco ja aberto.
// e o mesmo ponto de entrada pro servidor, pros comandos e pros testes
export function criarServicos(config, db, { gateway = criarGatewayMock(config.mockPagamento) } = {}) {
  const auditoria = criarAuditoria(db);
  const senhas = criarServicoSenhas(config.bcryptCusto);
  const tokens = criarServicoTokens(config.jwt);
  const limitador = criarLimitadorLogin(config.login);
  const usuarios = criarServicoUsuarios({ db, senhas, tokens, limitador, auditoria });
  const unidades = criarServicoUnidades({ db, auditoria });
  const produtos = criarServicoProdutos({ db, auditoria });
  const cardapio = criarServicoCardapio({ db, auditoria, unidades, produtos });
  const estoque = criarServicoEstoque({ db, auditoria, unidades, produtos });
  const idempotencia = criarServicoIdempotencia({ db });
  const fidelidade = criarServicoFidelidade({ db, config, auditoria });
  const pedidos = criarServicoPedidos({ db, config, auditoria, estoque, idempotencia, fidelidade });
  const ciclo = criarCicloPedido({ db, auditoria, estoque, pedidos, fidelidade });
  const pagamentos = criarServicoPagamentos({ db, config, auditoria, pedidos, ciclo, idempotencia, gateway });
  return {
    db, auditoria, senhas, tokens, usuarios, unidades, produtos, cardapio, estoque, idempotencia, pedidos, ciclo, pagamentos, fidelidade,
  };
}

export function criarApp(config, { db = abrirBanco(config.arquivoBanco), logger = criarLogger(config.ambiente), gateway } = {}) {
  migrar(db);
  const servicos = criarServicos(config, db, { gateway });
  const deps = {
    config,
    servicos,
    autenticar: autenticar(servicos),
    autenticarOpcional: autenticar(servicos, { opcional: true }),
  };

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', false);
  app.set('query parser', 'simple');

  app.use(requestId());
  app.use(logRequisicoes(logger));
  app.use(cabecalhosSeguranca());
  app.use(cors(config.corsOrigens));
  app.use(express.json({ limit: '32kb', strict: true }));

  app.get('/health', (_req, res) => res.json({ status: 'ok' }));
  app.use(rotasIdentidade(deps));
  app.use(rotasCatalogo(deps));
  app.use(rotasEstoque(deps));
  app.use(rotasPedidos(deps));
  app.use(rotasPagamentos(deps));
  app.use(rotasFidelidade(deps));
  app.use(rotasAuditorias(deps));

  app.use(rotaNaoEncontrada());
  app.use(tratadorErros(logger));
  return { app, servicos, db };
}
